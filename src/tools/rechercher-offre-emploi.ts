/**
 * T85c — rechercher_offre_emploi
 * Recherche d'offres d'emploi actives via l'API France Travail (OAuth2 client credentials).
 * Credentials requis : FT_CLIENT_ID + FT_CLIENT_SECRET (francetravail.io/inscription).
 * Source : API Offres d'emploi v2 — https://api.francetravail.io/partenaire/offresdemploi/v2/
 */

import type { ToolResult } from "../types.js";
import type { Env } from "../types.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

const FT_AUTH_URL =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const FT_OFFRES_URL =
  "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

// Cache token en memoire (valide 1499 s par defaut, renouvel auto)
let cachedToken: { value: string; expiresAt: number } | null = null;

interface RechercherOffreEmploiArgs {
  mots_cles?: string;           // mots-cles dans le titre/description
  commune?: string;             // nom de commune (resolu en code INSEE via geo.api)
  code_postal?: string;         // code postal (resolu en code INSEE)
  departement?: string;         // code departement (ex: "75", "69")
  type_contrat?: string;        // CDI, CDD, MIS, SAI, LIB, REP, CUI, PRO...
  qualification?: "non-cadre" | "cadre";
  limit?: number;
}

interface OffreEmploi {
  id: string;
  intitule: string;
  description?: string;
  dateCreation: string;
  lieuTravail?: { libelle: string; codePostal?: string };
  entreprise?: { nom?: string; secteurActiviteLibelle?: string };
  typeContrat: string;
  typeContratLibelle: string;
  natureContrat?: string;
  experienceLibelle?: string;
  competences?: Array<{ libelle: string }>;
  formations?: Array<{ niveauLibelle?: string; domaineLibelle?: string }>;
  salaire?: { libelle?: string };
  appellationlibelle?: string;
  romeLibelle?: string;
  dureeTravailLibelleConverti?: string;
  origineOffre?: { urlOrigine?: string };
}

interface FtSearchResponse {
  resultats?: OffreEmploi[];
  Content_Range?: string;
}

/** Obtient un token OAuth2 France Travail (avec cache memoire) */
async function getFtToken(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "api_offresdemploiv2 o2dsoffre",
  });

  const resp = await fetch(FT_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`France Travail auth failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const json = await resp.json() as { access_token: string; expires_in: number };
  // Expire 60s avant la vraie expiration pour marge de securite
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

/** Resout un nom de commune ou code postal en code commune FT (ex: "69123") */
async function resolveCommune(commune?: string, codePostal?: string): Promise<string | null> {
  const query = commune ?? codePostal;
  if (!query) return null;

  const params = new URLSearchParams(
    codePostal ? { codePostal: codePostal } : { nom: query, limit: "1" },
  );

  try {
    const resp = await fetch(`https://geo.api.gouv.fr/communes?${params}&fields=code`);
    if (!resp.ok) return null;
    const communes = await resp.json() as Array<{ code: string }>;
    return communes[0]?.code ?? null;
  } catch {
    return null;
  }
}

export async function rechercherOffreEmploi(
  args: RechercherOffreEmploiArgs,
  env?: Env,
): Promise<ToolResult> {
  if (!env?.FT_CLIENT_ID || !env?.FT_CLIENT_SECRET) {
    return {
      content: [
        {
          type: "text",
          text:
            "L'outil rechercher_offre_emploi necessite des credentials France Travail (FT_CLIENT_ID / FT_CLIENT_SECRET).\n" +
            "Inscription gratuite sur https://francetravail.io/inscription pour obtenir vos cles API." +
            suggestAlternative("rechercher_offre_emploi"),
        },
      ],
      isError: true,
    };
  }

  const { mots_cles, commune, code_postal, departement, type_contrat, qualification, limit = 10 } = args;

  if (!mots_cles && !commune && !code_postal && !departement) {
    return {
      content: [
        {
          type: "text",
          text: "Veuillez fournir au moins un critere : mots_cles, commune, code_postal ou departement." +
            suggestAlternative("rechercher_offre_emploi"),
        },
      ],
      isError: true,
    };
  }

  try {
    const token = await getFtToken(env.FT_CLIENT_ID, env.FT_CLIENT_SECRET);

    const params = new URLSearchParams({
      range: `0-${Math.min(limit, 30) - 1}`,
    });

    if (mots_cles) params.set("motsCles", mots_cles);

    // Priorite : code commune > code postal > departement
    if (commune || code_postal) {
      const codeCommune = await resolveCommune(commune, code_postal);
      if (codeCommune) {
        params.set("commune", codeCommune);
      } else if (code_postal) {
        // Fallback : les 2 premiers chiffres = departement
        params.set("departement", code_postal.slice(0, 2));
      }
    } else if (departement) {
      params.set("departement", sanitize(departement));
    }

    if (type_contrat) params.set("typeContrat", sanitize(type_contrat.toUpperCase()));

    if (qualification === "cadre") params.set("qualification", "9");
    else if (qualification === "non-cadre") params.set("qualification", "0");

    const resp = await fetch(`${FT_OFFRES_URL}?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (resp.status === 204) {
      return {
        content: [{ type: "text", text: "Aucune offre d'emploi trouvee pour ces criteres." }],
      };
    }

    if (!resp.ok) {
      const body = await resp.text();
      return {
        content: [{ type: "text", text: `Erreur API France Travail : HTTP ${resp.status} — ${body.slice(0, 300)}` }],
        isError: true,
      };
    }

    const data = (await resp.json()) as FtSearchResponse;
    const offres = data.resultats ?? [];

    if (offres.length === 0) {
      return {
        content: [{ type: "text", text: "Aucune offre d'emploi trouvee pour ces criteres. Essayez des mots-cles plus generaux." }],
      };
    }

    // Extraction du nombre total depuis Content-Range header (ex: "offres 0-9/1247")
    const rangeHeader = resp.headers.get("Content-Range") ?? "";
    const totalMatch = rangeHeader.match(/\/(\d+)$/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : offres.length;

    return { content: [{ type: "text", text: formatOffres(offres, args, total) }] };
  } catch (error) {
    // Message d'erreur verbeux pour faciliter le diagnostic (auth, scope, réseau)
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `[DEBUG] rechercher_offre_emploi : ${msg}` }],
      isError: true,
    };
  }
}

function formatOffres(offres: OffreEmploi[], args: RechercherOffreEmploiArgs, total: number): string {
  const lines: string[] = [];

  const subtitle: string[] = [];
  if (args.mots_cles) subtitle.push(`"${args.mots_cles}"`);
  if (args.commune) subtitle.push(`commune : ${args.commune}`);
  if (args.code_postal) subtitle.push(`CP : ${args.code_postal}`);
  if (args.departement) subtitle.push(`dept : ${args.departement}`);
  if (args.type_contrat) subtitle.push(`contrat : ${args.type_contrat.toUpperCase()}`);
  if (args.qualification) subtitle.push(args.qualification);

  lines.push(
    `**Offres d'emploi** — ${total.toLocaleString("fr-FR")} resultat(s)${subtitle.length ? ` (${subtitle.join(", ")})` : ""}`,
  );
  lines.push(`Affichage : ${offres.length} offre(s)`);
  lines.push("");

  for (const o of offres) {
    lines.push(`### ${o.intitule}`);
    if (o.entreprise?.nom) lines.push(`**Entreprise :** ${o.entreprise.nom}`);
    if (o.lieuTravail?.libelle) lines.push(`**Lieu :** ${o.lieuTravail.libelle}`);
    lines.push(`**Contrat :** ${o.typeContratLibelle} (${o.typeContrat})${o.dureeTravailLibelleConverti ? ` — ${o.dureeTravailLibelleConverti}` : ""}`);
    if (o.salaire?.libelle) lines.push(`**Salaire :** ${o.salaire.libelle}`);
    if (o.experienceLibelle) lines.push(`**Experience :** ${o.experienceLibelle}`);
    if (o.romeLibelle) lines.push(`**Metier :** ${o.romeLibelle}`);

    // Description (tronquee)
    if (o.description) {
      const desc = o.description.replace(/\n+/g, " ").trim();
      lines.push(`**Description :** ${desc.slice(0, 300)}${desc.length > 300 ? "..." : ""}`);
    }

    // Competences (max 5)
    if (o.competences?.length) {
      const comps = o.competences.slice(0, 5).map((c) => c.libelle).join(", ");
      lines.push(`**Competences :** ${comps}`);
    }

    // Date de creation
    const date = o.dateCreation ? new Date(o.dateCreation).toLocaleDateString("fr-FR") : "N/A";
    lines.push(`**Publie le :** ${date} | **Ref. :** ${o.id}`);

    // Lien direct
    if (o.origineOffre?.urlOrigine) {
      lines.push(`**Lien :** ${o.origineOffre.urlOrigine}`);
    } else {
      lines.push(`**Lien :** https://candidat.francetravail.fr/offres/emploi/offre/${o.id}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Source : API Offres d'emploi v2 — France Travail (temps reel). Offres actives uniquement._");
  lines.push("_Pour postuler, cliquez sur le lien de chaque offre. Resultats tries par pertinence._");

  return lines.join("\n");
}

function sanitize(s: string): string {
  return s.replace(/['"\\]/g, "");
}
