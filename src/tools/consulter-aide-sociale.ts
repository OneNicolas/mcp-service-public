/**
 * T74 — consulter_aide_sociale
 * Statistiques CAF : allocataires RSA/APL/AAH/AF/PA par commune ou departement.
 * Source : CNAF — data.caf.fr (Opendatasoft v2.1, acces public, Licence Ouverte 2.0)
 *
 * Pourquoi des stats et pas des droits individuels :
 *   L'API Particulier (droits personnels CAF) est reservee aux administrations habilitees.
 *   data.caf.fr expose uniquement des donnees agregees anonymisees (arrondies a 5).
 */

import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { resolveNomCommune, resolveCodePostal } from "../utils/geo-api.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

const CAF_API = "https://data.caf.fr/api/explore/v2.1/catalog/datasets";

// Dataset toutes prestations par commune (depuis 2020, mise a jour mensuelle)
const DS_PRESTATIONS_COM = "s_ben_com_f";
// Dataset toutes prestations par departement
const DS_PRESTATIONS_DEP = "s_ben_dep";

// Libelles lisibles des codes de prestation CAF
const PRESTATION_LIBELLES: Record<string, string> = {
  RSA: "RSA (Revenu de Solidarite Active)",
  AL: "Aides au logement (APL/ALS/ALF)",
  AAH: "AAH (Allocation Adulte Handicape)",
  AF: "Allocations familiales",
  PA: "Prime d'activite",
  CF: "Complement familial",
  ASF: "Allocation de soutien familial",
  CMG: "Complement mode de garde",
  PAJE: "PAJE (Prestation accueil jeune enfant)",
  AEEH: "AEEH (Enfant handicape)",
  RSO: "RSO (Revenu de solidarite — DOM)",
  PREPARE: "PREPARE (Conge parental)",
  AMI: "AMI (Aide mobilite internationale)",
};

interface AideSocialeArgs {
  commune?: string;
  code_postal?: string;
  code_insee?: string;
  code_departement?: string;
  prestation?: string;
  annee?: number;
}

interface PrestationStat {
  prestation: string;
  libelle: string;
  nbFoyers: number;
  nbPersonnes: number;
  annee: string;
}

/** Extraie une valeur de row par regex sur les noms de colonnes (resilient aux renommages) */
function getField(row: Record<string, unknown>, patterns: RegExp[]): unknown {
  for (const [k, v] of Object.entries(row)) {
    for (const pat of patterns) {
      if (pat.test(k)) return v;
    }
  }
  return undefined;
}

/** Fetch les stats au niveau commune (code INSEE 5 chiffres) */
async function fetchStatCommune(codeInsee: string, annee?: number): Promise<PrestationStat[]> {
  const filters = [`com='${sanitize(codeInsee)}'`];
  if (annee) filters.push(`annee='${annee}'`);

  const params = new URLSearchParams({
    where: filters.join(" AND "),
    order_by: "annee DESC, nb_foy DESC",
    limit: "100",
  });

  const url = `${CAF_API}/${DS_PRESTATIONS_COM}/records?${params}`;
  const resp = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE });
  if (!resp.ok) throw new Error(`data.caf.fr HTTP ${resp.status}`);

  const data = await resp.json() as { results: Array<Record<string, unknown> & { additional_properties?: Record<string, unknown> }> };
  return parseRows(data.results ?? []);
}

/** Fetch les stats au niveau departement (code 2-3 chiffres) */
async function fetchStatDepartement(codeDept: string, annee?: number): Promise<PrestationStat[]> {
  const filters = [`dep='${sanitize(codeDept)}'`];
  if (annee) filters.push(`annee='${annee}'`);

  const params = new URLSearchParams({
    where: filters.join(" AND "),
    order_by: "annee DESC, nb_foy DESC",
    limit: "100",
  });

  const url = `${CAF_API}/${DS_PRESTATIONS_DEP}/records?${params}`;
  const resp = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE });
  if (!resp.ok) throw new Error(`data.caf.fr HTTP ${resp.status}`);

  const data = await resp.json() as { results: Array<Record<string, unknown> & { additional_properties?: Record<string, unknown> }> };
  return parseRows(data.results ?? []);
}

function parseRows(rawRows: Array<Record<string, unknown> & { additional_properties?: Record<string, unknown> }>): PrestationStat[] {
  return rawRows
    .map(r => {
      const row = (r.additional_properties ?? r) as Record<string, unknown>;

      const prestation = String(
        getField(row, [/^prestation$/i, /^lib_prest$/i, /^code_prest$/i, /^prestation_code$/i]) ?? "",
      ).toUpperCase();

      const annee = String(
        getField(row, [/^annee$/i, /^year$/i, /^an$/i]) ?? "",
      );

      const nbFoyers = Number(
        getField(row, [/^nb_foy$/i, /^nbfoy$/i, /^nombre_foy/i, /^nb_foyers/i]) ?? 0,
      );

      const nbPersonnes = Number(
        getField(row, [/^nb_pers$/i, /^nbpers$/i, /^nombre_pers/i, /^nb_personnes/i]) ?? 0,
      );

      const libelle = PRESTATION_LIBELLES[prestation] ?? prestation;

      return { prestation, libelle, nbFoyers, nbPersonnes, annee };
    })
    .filter(r => r.prestation && r.nbFoyers > 0);
}

/** Resout commune/code_postal/code_insee en code INSEE 5 chiffres */
async function resolveInsee(args: AideSocialeArgs): Promise<string | null> {
  if (args.code_insee) return args.code_insee.trim();

  if (args.code_postal) {
    const communes = await resolveCodePostal(args.code_postal);
    if (communes.length > 0) return communes[0].code;
  }

  if (args.commune) {
    const resolved = await resolveNomCommune(args.commune);
    if (resolved) return resolved.code;
  }

  return null;
}

function formatStats(
  stats: PrestationStat[],
  scope: string,
  filtrePrestation?: string,
): string {
  if (stats.length === 0) {
    return `Aucune donnee disponible pour ${scope}.\n\n_Les donnees data.caf.fr couvrent les communes depuis 2020. Verifiez le code commune ou essayez avec un departement._`;
  }

  // Grouper par annee (prendre la plus recente)
  const annees = [...new Set(stats.map(r => r.annee))].sort((a, b) => b.localeCompare(a));
  const derniereAnnee = annees[0];

  // Filtrer sur prestation si precisee
  let rows = stats.filter(r => r.annee === derniereAnnee);
  if (filtrePrestation && filtrePrestation.toLowerCase() !== "toutes") {
    const codeFiltre = filtrePrestation.toUpperCase();
    rows = rows.filter(r => r.prestation === codeFiltre);
  }

  if (rows.length === 0) {
    return `Aucune donnee pour la prestation "${filtrePrestation}" en ${derniereAnnee} pour ${scope}.`;
  }

  // Trier par nombre de foyers decroissant
  rows.sort((a, b) => b.nbFoyers - a.nbFoyers);

  const lines: string[] = [];
  lines.push(`**Allocataires CAF — ${scope}** (decembre ${derniereAnnee})`);
  lines.push("");
  lines.push("| Prestation | Foyers allocataires | Personnes couvertes |");
  lines.push("| --- | ---: | ---: |");

  for (const row of rows) {
    const foyers = row.nbFoyers.toLocaleString("fr-FR");
    const personnes = row.nbPersonnes > 0 ? row.nbPersonnes.toLocaleString("fr-FR") : "—";
    lines.push(`| ${row.libelle} | ${foyers} | ${personnes} |`);
  }

  // Total toutes prestations (les foyers peuvent etre dans plusieurs prestations — pas cumulable)
  const totalFoyers = rows.reduce((sum, r) => sum + r.nbFoyers, 0);
  lines.push(`| **Total lignes** | **${totalFoyers.toLocaleString("fr-FR")}** | — |`);
  lines.push("");

  if (annees.length > 1) {
    lines.push(`_Annees disponibles : ${annees.join(", ")}_`);
  }

  lines.push("");
  lines.push("_Source : CNAF — data.caf.fr | Licence Ouverte 2.0_");
  lines.push("_Donnees agregees anonymisees. Les effectifs < 5 sont arrondis. Un foyer peut cumuler plusieurs prestations._");
  lines.push("_Donnees individuelles (droits personnels) : non disponibles en open data (acces reserve aux administrations)._");

  return lines.join("\n");
}

function sanitize(s: string): string {
  return s.replace(/['"\\]/g, "");
}

/** Donnees CAF simplifiees pour comparer_communes (dept uniquement) */
export interface AideSocialeCompareData {
  nbFoyersRSA: number | null;
  nbFoyersAPL: number | null;
  nbFoyersAAH: number | null;
  annee: string | null;
}

export async function fetchAideSocialeForCompare(codeDept: string): Promise<AideSocialeCompareData | null> {
  try {
    const stats = await fetchStatDepartement(codeDept);
    if (stats.length === 0) return null;

    // Prendre la derniere annee disponible
    const latestAnnee = stats.reduce((max, r) => r.annee > max ? r.annee : max, "");
    const latest = stats.filter(r => r.annee === latestAnnee);

    const find = (code: string) => latest.find(r => r.prestation === code)?.nbFoyers ?? null;

    return {
      nbFoyersRSA: find("RSA"),
      nbFoyersAPL: find("AL"),   // AL = aides au logement (APL+ALS+ALF)
      nbFoyersAAH: find("AAH"),
      annee: latestAnnee || null,
    };
  } catch {
    return null;
  }
}

export async function consulterAideSociale(args: AideSocialeArgs): Promise<ToolResult> {
  try {
    const { prestation, annee, code_departement } = args;

    // Mode departement (prioritaire si specifie explicitement)
    if (code_departement && !args.commune && !args.code_postal && !args.code_insee) {
      const codeDept = code_departement.trim();
      const stats = await fetchStatDepartement(codeDept, annee);
      const report = formatStats(stats, `Departement ${codeDept}`, prestation);
      return { content: [{ type: "text", text: report }] };
    }

    // Mode commune
    const codeInsee = await resolveInsee(args);

    if (codeInsee) {
      const stats = await fetchStatCommune(codeInsee, annee);

      // Libelle commune (depuis geo-api)
      let libelleCommune = `commune ${codeInsee}`;
      if (args.commune) libelleCommune = args.commune;
      else if (args.code_postal) libelleCommune = `code postal ${args.code_postal}`;

      const report = formatStats(stats, libelleCommune, prestation);
      return { content: [{ type: "text", text: report }] };
    }

    // Fallback departement via code_departement present mais commune aussi specifiee
    if (code_departement) {
      const codeDept = code_departement.trim();
      const stats = await fetchStatDepartement(codeDept, annee);
      const report = formatStats(stats, `Departement ${codeDept}`, prestation);
      return { content: [{ type: "text", text: report }] };
    }

    return {
      content: [{ type: "text", text: "Precisez une commune (nom, code postal ou code INSEE) ou un code departement pour consulter les statistiques d'allocataires CAF." + suggestAlternative("consulter_aide_sociale") }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur consulter_aide_sociale : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}
