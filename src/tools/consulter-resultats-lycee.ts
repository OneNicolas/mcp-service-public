import type { ToolResult } from "../types.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets";
const DATASET_GT = "fr-en-indicateurs-de-resultat-des-lycees-gt_v2";
const DATASET_PRO = "fr-en-indicateurs-de-resultat-des-lycees-pro_v2";

/** Champs selectionnes pour limiter la taille de la reponse */
const SELECT_FIELDS = [
  "annee", "uai", "libelle_uai", "secteur",
  "code_commune", "libelle_commune", "libelle_departement",
  "presents_total", "taux_reu_total", "va_reu_total",
  "taux_acces_2nde", "va_acces_2nde",
  "taux_men_total", "va_men_total",
  "eff_2nde", "eff_1ere", "eff_term",
].join(", ");

interface ConsulterResultatsArgs {
  commune?: string;
  code_postal?: string;
  code_insee?: string;
  nom_lycee?: string;
  type?: "gt" | "pro" | "tous";
  limit?: number;
}

interface IvalRecord {
  annee?: string;
  uai?: string;
  libelle_uai?: string;
  secteur?: string;
  code_commune?: string;
  libelle_commune?: string;
  libelle_departement?: string;
  presents_total?: number;
  taux_reu_total?: number;
  va_reu_total?: number;
  taux_acces_2nde?: number;
  va_acces_2nde?: number;
  taux_men_total?: number;
  va_men_total?: number;
  eff_2nde?: number;
  eff_1ere?: number;
  eff_term?: number;
}

interface ExploreResponse {
  total_count: number;
  results: Array<{ additional_properties: IvalRecord }>;
}

export async function consulterResultatsLycee(
  args: ConsulterResultatsArgs,
): Promise<ToolResult> {
  const { commune, code_postal, code_insee, nom_lycee, type = "tous", limit = 10 } = args;
  const maxLimit = Math.min(Math.max(limit, 1), 20);

  if (!commune && !code_postal && !code_insee && !nom_lycee) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins un critere : commune, code_postal, code_insee ou nom_lycee." }],
      isError: true,
    };
  }

  try {
    // Resolution localisation
    const location = await resolveLocation(commune, code_postal, code_insee);

    // Construire le filtre ODSQL
    const whereClauses: string[] = [];

    if (location) {
      // libelle_commune contient le nom en majuscules (ex: "LYON 07", "PARIS 05")
      whereClauses.push(`search(libelle_commune, '${sanitize(location.nom)}')`);
    }

    if (nom_lycee) {
      whereClauses.push(`search(libelle_uai, '${sanitize(nom_lycee)}')`);
    }

    const whereStr = whereClauses.length > 0 ? whereClauses.join(" AND ") : "";

    // Requetes paralleles GT et/ou Pro
    const fetchGT = type !== "pro";
    const fetchPro = type !== "gt";

    const [gtResults, proResults] = await Promise.all([
      fetchGT ? fetchIvalData(DATASET_GT, whereStr, maxLimit) : Promise.resolve(null),
      fetchPro ? fetchIvalData(DATASET_PRO, whereStr, maxLimit) : Promise.resolve(null),
    ]);

    // Fusionner et trier par VA reussite decroissante
    const allResults: Array<{ record: IvalRecord; voie: string }> = [];

    if (gtResults?.results?.length) {
      for (const r of gtResults.results) {
        allResults.push({ record: r.additional_properties, voie: "General/Technologique" });
      }
    }

    if (proResults?.results?.length) {
      for (const r of proResults.results) {
        allResults.push({ record: r.additional_properties, voie: "Professionnel" });
      }
    }

    if (allResults.length === 0) {
      const criteres = [
        location ? `commune "${location.nom}"` : null,
        nom_lycee ? `lycee "${nom_lycee}"` : null,
        type !== "tous" ? `voie "${type}"` : null,
      ].filter(Boolean).join(", ");
      return {
        content: [{ type: "text", text: `Aucun resultat IVAL trouve pour : ${criteres}. Les donnees couvrent uniquement les lycees publics et prives sous contrat.` }],
      };
    }

    // Trier par VA reussite decroissante (meilleurs lycees en premier)
    allResults.sort((a, b) => (b.record.va_reu_total ?? -999) - (a.record.va_reu_total ?? -999));

    // Limiter apres fusion
    const limited = allResults.slice(0, maxLimit);
    const formatted = limited.map((r) => formatResultat(r.record, r.voie));

    const totalCount = (gtResults?.total_count ?? 0) + (proResults?.total_count ?? 0);
    const locationLabel = location ? ` a ${location.nom}` : "";

    return {
      content: [{
        type: "text",
        text: [
          `**${totalCount} resultat(s) IVAL${locationLabel}** (${limited.length} affiches, derniere session disponible)\n`,
          "💡 _La valeur ajoutee (VA) mesure l'apport propre du lycee : positive = meilleur que prevu, negative = en-dessous des attendus._\n",
          ...formatted,
        ].join("\n---\n"),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Erreur : ${error instanceof Error ? error.message : "inconnue"}`,
      }],
      isError: true,
    };
  }
}

/** Fetch IVAL data depuis un dataset, derniere annee disponible */
async function fetchIvalData(
  dataset: string,
  where: string,
  limit: number,
): Promise<ExploreResponse | null> {
  const params = new URLSearchParams({
    select: SELECT_FIELDS,
    limit: String(limit),
    order_by: "annee DESC, va_reu_total DESC",
  });

  if (where) {
    params.set("where", where);
  }

  const url = `${EDUCATION_API}/${dataset}/records?${params}`;
  const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE, source: "education-gouv-ival" });

  if (!response.ok) return null;

  return (await response.json()) as ExploreResponse;
}

/** Resolution commune/code_postal/code_insee */
async function resolveLocation(
  commune?: string,
  code_postal?: string,
  code_insee?: string,
): Promise<{ nom: string; code: string } | null> {
  if (code_insee) return { nom: code_insee, code: code_insee };
  if (code_postal) {
    const communes = await resolveCodePostal(code_postal);
    if (communes.length > 0) return { nom: communes[0].nom, code: communes[0].code };
  }
  if (commune) {
    const resolved = await resolveNomCommune(commune);
    if (resolved) return resolved;
    return { nom: commune, code: "" };
  }
  return null;
}

function sanitize(input: string): string {
  return input.replace(/['"\\\n\r]/g, "");
}

function formatResultat(r: IvalRecord, voie: string): string {
  const sections: string[] = [];

  // Titre
  const nom = r.libelle_uai ?? "Lycee";
  const secteur = r.secteur === "public" ? "🟢 Public" : "🔵 Prive";
  sections.push(`## ${nom} (${secteur})`);

  // Localisation et session
  const locParts = [r.libelle_commune, r.libelle_departement].filter(Boolean);
  if (locParts.length) sections.push(`**Commune** : ${locParts.join(", ")}`);
  sections.push(`**Voie** : ${voie}`);
  if (r.annee) sections.push(`**Session** : ${r.annee}`);

  // Indicateurs principaux
  if (r.presents_total != null) sections.push(`**Candidats** : ${r.presents_total}`);

  // Taux de reussite + VA
  if (r.taux_reu_total != null) {
    const vaStr = formatVA(r.va_reu_total);
    sections.push(`**Taux de reussite** : ${r.taux_reu_total} %${vaStr}`);
  }

  // Taux d'acces 2nde→bac + VA
  if (r.taux_acces_2nde != null) {
    const vaStr = formatVA(r.va_acces_2nde);
    sections.push(`**Taux d'acces 2nde→bac** : ${r.taux_acces_2nde} %${vaStr}`);
  }

  // Taux de mentions + VA
  if (r.taux_men_total != null) {
    const vaStr = formatVA(r.va_men_total);
    sections.push(`**Taux de mentions** : ${r.taux_men_total} %${vaStr}`);
  }

  // Effectifs cycle
  const effectifs = [
    r.eff_2nde != null ? `2nde: ${r.eff_2nde}` : null,
    r.eff_1ere != null ? `1ere: ${r.eff_1ere}` : null,
    r.eff_term != null ? `Term: ${r.eff_term}` : null,
  ].filter(Boolean);
  if (effectifs.length) sections.push(`**Effectifs** : ${effectifs.join(" | ")}`);

  // UAI
  if (r.uai) sections.push(`**UAI** : ${r.uai}`);

  return sections.join("\n");
}

/** Formate la valeur ajoutee avec signe et emoji */
export function formatVA(va: number | null | undefined): string {
  if (va == null) return "";
  const sign = va > 0 ? "+" : "";
  const emoji = va > 0 ? " 📈" : va < 0 ? " 📉" : " ➡️";
  return ` (VA : ${sign}${va}${emoji})`;
}
