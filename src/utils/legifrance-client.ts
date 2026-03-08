/**
 * T63 — LegifranceClient
 * Client OAuth2 pour l'API PISTE Legifrance (api.piste.gouv.fr).
 * Remplace le proxy openlegi.fr (legifrance-mcp.ts) par des appels directs
 * a l'API officielle DILA, plus robuste et sans dependance tierce.
 *
 * Pourquoi token en memoire module-level :
 *   - Cloudflare Workers reutilise les isolates a chaud (hot path)
 *   - Token valide 3600s — le cache evite un round-trip OAuth par requete
 *   - En cas de cold start, le token est redemande automatiquement
 */

const PISTE_TOKEN_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const PISTE_API_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";
const TIMEOUT_MS = 15_000;
const TOKEN_MARGIN_S = 60; // renouvelle 60s avant expiration

// Cache module-level (partage entre requetes dans le meme isolate)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// -----------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "openid",
  });

  const res = await fetchWithTimeout(PISTE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new LegifranceClientError(`OAuth2 PISTE echec (${res.status}) : ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in - TOKEN_MARGIN_S;
  return cachedToken;
}

// -----------------------------------------------------------------------
// Core search
// -----------------------------------------------------------------------

interface PisteSearchBody {
  fond: string;
  recherche: {
    champs: Array<{
      typeChamp: string;
      operateur: string;
      criteres: Array<{
        typeRecherche: string;
        valeur: string;
        operateur: string;
      }>;
    }>;
    filtres?: Array<{ facette: string; valeur?: string; valeurs?: string[] }>;
    sort: string;
    pageNumber: number;
    pageSize: number;
    operateur: string;
    typePagination: string;
    // Filtres date (JORF/LODA) : format "YYYY-MM-DD"
    dateDebut?: string;
    dateFin?: string;
  };
}

interface PisteResult {
  id?: string;
  titre?: string;
  nature?: string;
  dateTexte?: string;
  datePublicationJO?: string;
  numero?: string;
  // NOR (identifiant normalise des textes JORF)
  nor?: string;
  // Codes : numero d'article
  num?: string;
  // Jurisprudence
  solution?: string;
  formation?: string;
  numDecision?: string;
  dateDecision?: string;
  juridiction?: string;
  // Texte extrait
  extraits?: string[];
  sections?: Array<{ id: string; title: string }>;
  // Lien
  cid?: string;
  texteHtmlRef?: string;
}

interface PisteSearchResponse {
  results?: PisteResult[];
  totalResultNumber?: number;
  executionTime?: number;
}

async function pisteSearch(
  clientId: string,
  clientSecret: string,
  body: PisteSearchBody,
): Promise<PisteSearchResponse> {
  const token = await getAccessToken(clientId, clientSecret);

  const bodyStr = JSON.stringify(body);
  const res = await fetchWithTimeout(`${PISTE_API_BASE}/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: bodyStr,
  });

  if (res.status === 401) {
    // Token expire — force renouvellement et reessai
    cachedToken = null;
    tokenExpiresAt = 0;
    const newToken = await getAccessToken(clientId, clientSecret);
    const retry = await fetchWithTimeout(`${PISTE_API_BASE}/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${newToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!retry.ok) throw new LegifranceClientError(`PISTE API erreur ${retry.status}`);
    return retry.json() as Promise<PisteSearchResponse>;
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`[legifrance-client] PISTE HTTP ${res.status} — body: ${bodyStr} — resp: ${text.slice(0, 300)}`);
    throw new LegifranceClientError(`PISTE API erreur ${res.status} : ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<PisteSearchResponse>;
}

// -----------------------------------------------------------------------
// Fonctions publiques (une par fond)
// -----------------------------------------------------------------------

export interface LegifranceSearchOptions {
  query: string;
  champ?: "ALL" | "TITLE" | "ARTICLE" | "NUM_ARTICLE";
  typeRecherche?: "TOUS_LES_MOTS_DANS_UN_CHAMP" | "EXACTE" | "UN_DES_MOTS";
  pageSize?: number;
  /** Tri des resultats — non utilise actuellement (retrait temporaire pour compatibilite PISTE) */
  sort?: "PERTINENCE" | "DATE_ASC" | "DATE_DESC";
  /** Filtre par nom de code (fond CODE uniquement) */
  codeName?: string;
  /** Filtre par juridiction : CASS, CAPP */
  juridiction?: string;
  /** Filtre publication bulletin Cour de cassation : "T" | "F" */
  publicationBulletin?: "T" | "F";
  /** Filtre par nature de texte — JORF : "LOI", "DECRET", "ARRETE", "ORDONNANCE", "CIRCULAIRE" */
  nature?: string;
  /** Date de debut de recherche (format "YYYY-MM-DD") */
  dateDebut?: string;
  /** Date de fin de recherche (format "YYYY-MM-DD") */
  dateFin?: string;
}

/** Recherche dans les textes legislatifs et reglementaires (lois, decrets, arretes) */
export async function searchLoda(
  clientId: string,
  clientSecret: string,
  opts: LegifranceSearchOptions,
): Promise<string> {
  // LODA_ETAT = textes en vigueur ; LODA_DATE = version historique
  const data = await pisteSearch(clientId, clientSecret, buildBody("LODA_ETAT", opts));
  return formatResults(data, "texte_legal");
}

/** Recherche dans les codes juridiques */
export async function searchCode(
  clientId: string,
  clientSecret: string,
  opts: LegifranceSearchOptions,
): Promise<string> {
  // CODE_ETAT = articles en vigueur ; CODE_DATE = version historique.
  // On utilise CODE_ETAT par defaut (articles actuellement en vigueur).
  const data = await pisteSearch(clientId, clientSecret, buildBody("CODE_ETAT", opts));
  return formatResults(data, "code");
}

/** Recherche dans la jurisprudence judiciaire (Cour de cassation + cours d'appel) */
export async function searchJuri(
  clientId: string,
  clientSecret: string,
  opts: LegifranceSearchOptions,
): Promise<string> {
  // JURI = Cour de cassation ; CAPP = Cours d'appel
  const fond = opts.juridiction === "CAPP" ? "CAPP" : "JURI";
  const data = await pisteSearch(clientId, clientSecret, buildBody(fond, opts));
  return formatResults(data, "jurisprudence");
}

/** Recherche dans le Journal Officiel de la Republique Francaise (JORF) */
export async function searchJorf(
  clientId: string,
  clientSecret: string,
  opts: LegifranceSearchOptions,
): Promise<string> {
  const data = await pisteSearch(clientId, clientSecret, buildBody("JORF", opts));
  return formatResults(data, "jorf");
}

// -----------------------------------------------------------------------
// Construction du body de recherche PISTE
// -----------------------------------------------------------------------

function buildBody(fond: string, opts: LegifranceSearchOptions): PisteSearchBody {
  const {
    query,
    champ = "ALL",
    typeRecherche = "TOUS_LES_MOTS_DANS_UN_CHAMP",
    pageSize = 10,
    codeName,
    publicationBulletin,
    nature,
    dateDebut,
    dateFin,
  } = opts;

  const filtres: Array<{ facette: string; valeur?: string; valeurs?: string[] }> = [];

  // Filtre nom de code — utilise "valeurs" (tableau) comme l'API PISTE l'attend
  // CODE_ETAT utilise TEXT_NOM_CODE ; CODE_DATE et autres fonds utilisent NOM_CODE
  if (codeName) {
    const facetteCode = fond === "CODE_ETAT" ? "TEXT_NOM_CODE" : "NOM_CODE";
    filtres.push({ facette: facetteCode, valeurs: [codeName] });
  }

  // Filtre publication bulletin (fond JURI uniquement)
  if (publicationBulletin && fond === "JURI") {
    filtres.push({ facette: "PUBLICATION_BULLETIN", valeur: publicationBulletin });
  }

  // Filtre nature de texte (JORF/LODA) : LOI, DECRET, ARRETE, ORDONNANCE...
  if (nature && (fond === "JORF" || fond === "LODA_ETAT" || fond === "LODA_DATE")) {
    filtres.push({ facette: "NATURE", valeur: nature.toUpperCase() });
  }

  return {
    fond,
    recherche: {
      champs: [{
        typeChamp: champ,
        operateur: "ET",
        criteres: [{
          typeRecherche,
          valeur: query,
          operateur: "ET",
        }],
      }],
      ...(filtres.length > 0 ? { filtres } : {}),
      ...(dateDebut ? { dateDebut } : {}),
      ...(dateFin ? { dateFin } : {}),
      sort: "PERTINENCE",
      pageNumber: 1,
      pageSize: Math.min(pageSize, 20),
      operateur: "ET",
      typePagination: "DEFAUT",
    },
  };
}

// -----------------------------------------------------------------------
// Formatters de sortie
// -----------------------------------------------------------------------

type ResultKind = "texte_legal" | "code" | "jurisprudence" | "jorf";

function formatResults(data: PisteSearchResponse, kind: ResultKind): string {
  const results = data.results ?? [];
  if (!results.length) return "Aucun resultat trouve.";

  const total = data.totalResultNumber ?? results.length;
  const lines: string[] = [`RESULTATS (${results.length} sur ${total} total) :\n`];

  for (let i = 0; i < results.length; i++) {
    lines.push(`=== ${i + 1} ===`);
    lines.push(formatOneResult(results[i], kind));
    lines.push("");
  }

  return lines.join("\n");
}

function formatOneResult(r: PisteResult, kind: ResultKind): string {
  const lines: string[] = [];

  if (r.titre) lines.push(`Titre : ${r.titre}`);
  if (r.nature) lines.push(`Nature : ${r.nature}`);

  if (kind === "texte_legal") {
    if (r.numero) lines.push(`Numero : ${r.numero}`);
    if (r.dateTexte) lines.push(`Date : ${r.dateTexte}`);
    if (r.datePublicationJO) lines.push(`Publication JO : ${r.datePublicationJO}`);
  }

  if (kind === "code") {
    if (r.num) lines.push(`Article : ${r.num}`);
  }

  if (kind === "jurisprudence") {
    if (r.juridiction) lines.push(`Juridiction : ${r.juridiction}`);
    if (r.formation) lines.push(`Formation : ${r.formation}`);
    if (r.numDecision) lines.push(`Numero : ${r.numDecision}`);
    if (r.dateDecision) lines.push(`Date : ${r.dateDecision}`);
    if (r.solution) lines.push(`Solution : ${r.solution}`);
  }

  if (kind === "jorf") {
    if (r.numero) lines.push(`Numero : ${r.numero}`);
    if (r.nor) lines.push(`NOR : ${r.nor}`);
    if (r.dateTexte) lines.push(`Date : ${r.dateTexte}`);
    if (r.datePublicationJO) lines.push(`Publication JO : ${r.datePublicationJO}`);
  }

  // Extraits de texte
  if (r.extraits?.length) {
    lines.push("Extrait :");
    lines.push(r.extraits.slice(0, 2).join(" [...] "));
  }

  // Lien Legifrance
  const legiLink = buildLegiLink(r, kind);
  if (legiLink) lines.push(`Lien : ${legiLink}`);

  return lines.join("\n");
}

function buildLegiLink(r: PisteResult, kind: ResultKind): string | null {
  if (!r.id && !r.cid) return null;
  const id = r.cid ?? r.id;
  if (!id) return null;

  switch (kind) {
    case "texte_legal": return `https://www.legifrance.gouv.fr/loda/id/${id}`;
    case "code": return `https://www.legifrance.gouv.fr/codes/article_lc/${id}`;
    case "jurisprudence": return `https://www.legifrance.gouv.fr/juri/id/${id}`;
    case "jorf": return `https://www.legifrance.gouv.fr/jorf/id/${id}`;
    default: return null;
  }
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erreur reseau";
    throw new LegifranceClientError(`Legifrance PISTE inaccessible : ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

export class LegifranceClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegifranceClientError";
  }
}
