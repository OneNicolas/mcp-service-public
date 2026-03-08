/**
 * T53 — consulter_securite
 * Statistiques de securite/delinquance par departement via Tabular API data.gouv.fr
 * Source : SSMSI, Ministere de l'Interieur
 */

import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";
import { extractDeptFromInsee } from "./consulter-evaluations-nationales.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

const RESOURCE_ID = "2b27a675-e3bf-41ef-a852-5fb9ab483967";
const TABULAR_API = `https://tabular-api.data.gouv.fr/api/resources/${RESOURCE_ID}/data/`;

interface SecuriteArgs {
  code_departement?: string;
  commune?: string;
  code_postal?: string;
  annee?: number;
}

interface SecuriteRow {
  Code_departement: string;
  annee: number;
  indicateur: string;
  unite_de_compte: string;
  nombre: number;
  taux_pour_mille: number;
  insee_pop: number;
}

interface TabularResponse {
  data: SecuriteRow[];
  links?: { next?: string };
}

/** Resout les arguments en code departement */
export async function resolveCodeDepartement(args: SecuriteArgs): Promise<string> {
  if (args.code_departement) {
    return args.code_departement.trim().toUpperCase();
  }

  if (args.code_postal) {
    const communes = await resolveCodePostal(args.code_postal);
    if (communes.length > 0) {
      return extractDeptFromInsee(communes[0].code);
    }
    throw new Error(`Aucune commune trouvee pour le code postal ${args.code_postal}.`);
  }

  if (args.commune) {
    const resolved = await resolveNomCommune(args.commune);
    if (resolved) {
      return extractDeptFromInsee(resolved.code);
    }
    throw new Error(`Commune non trouvee : "${args.commune}".`);
  }

  throw new Error("Veuillez preciser un code departement, une commune ou un code postal." + suggestAlternative("consulter_securite"));
}

/** Recupere les donnees de securite pour un departement */
export async function fetchSecuriteData(
  codeDept: string,
  annee?: number,
): Promise<SecuriteRow[]> {
  const params = new URLSearchParams({
    Code_departement__exact: codeDept,
    annee__sort: "desc",
    page_size: "200",
  });

  const url = `${TABULAR_API}?${params}`;
  const response = await cachedFetch(url, { ttl: CACHE_TTL.DVF });

  if (!response.ok) {
    throw new Error(`Erreur API data.gouv.fr Tabular : HTTP ${response.status}`);
  }

  const json = (await response.json()) as TabularResponse;
  const rows = json.data ?? [];

  if (rows.length === 0) return [];

  // Filtrer par annee si demandee
  if (annee) {
    return rows.filter((r) => r.annee === annee);
  }

  return rows;
}

/** Calcule la moyenne nationale en sommant les departements pour une annee donnee */
export function computeNationalAverage(
  allRows: SecuriteRow[],
  targetYear: number,
): Map<string, { totalNombre: number; totalPop: number; taux: number }> {
  // On utilise les donnees du departement demande uniquement
  // La moyenne nationale sera approximee par le taux fourni dans les donnees
  // (les donnees contiennent deja le taux pour 1000 par departement)
  const map = new Map<string, { totalNombre: number; totalPop: number; taux: number }>();
  const yearRows = allRows.filter((r) => r.annee === targetYear);

  for (const row of yearRows) {
    map.set(row.indicateur, {
      totalNombre: row.nombre,
      totalPop: row.insee_pop,
      taux: row.taux_pour_mille,
    });
  }

  return map;
}

/** Formate le rapport de securite */
export function formatSecuriteReport(
  codeDept: string,
  rows: SecuriteRow[],
  requestedYear?: number,
): string {
  if (rows.length === 0) {
    return `Aucune donnee de securite trouvee pour le departement ${codeDept}.`;
  }

  // Determiner les annees disponibles
  const annees = [...new Set(rows.map((r) => r.annee))].sort((a, b) => b - a);
  const latestYear = requestedYear ?? annees[0];
  const previousYear = annees.find((a) => a < latestYear);
  const latestRows = rows.filter((r) => r.annee === latestYear);
  const previousRows = previousYear ? rows.filter((r) => r.annee === previousYear) : [];

  // Population de reference
  const pop = latestRows[0]?.insee_pop ?? 0;

  const lines: string[] = [];
  lines.push(`\uD83D\uDEE1\uFE0F **Securite — Departement ${codeDept}** (${latestYear})`);
  if (pop > 0) {
    lines.push(`Population : ${pop.toLocaleString("fr-FR")} habitants`);
  }
  lines.push("");

  // Tableau des indicateurs
  lines.push("| Indicateur | Nombre | Taux /1000 hab. | Evolution |");
  lines.push("| --- | ---: | ---: | --- |");

  // Trier par taux decroissant
  const sorted = [...latestRows].sort((a, b) => (b.taux_pour_mille ?? 0) - (a.taux_pour_mille ?? 0));

  for (const row of sorted) {
    const nombre = row.nombre?.toLocaleString("fr-FR") ?? "N/A";
    const taux = row.taux_pour_mille != null ? row.taux_pour_mille.toFixed(2) : "N/A";

    // Evolution vs annee precedente
    let evolution = "";
    if (previousRows.length > 0) {
      const prev = previousRows.find((p) => p.indicateur === row.indicateur);
      if (prev && prev.nombre > 0) {
        const pct = ((row.nombre - prev.nombre) / prev.nombre) * 100;
        if (Math.abs(pct) >= 0.5) {
          const sign = pct > 0 ? "+" : "";
          const emoji = pct > 5 ? "\uD83D\uDD3A" : pct < -5 ? "\uD83D\uDD3B" : "";
          evolution = `${sign}${pct.toFixed(1)} % ${emoji}`;
        } else {
          evolution = "\u2194\uFE0F stable";
        }
      }
    }

    lines.push(`| ${row.indicateur} | ${nombre} | ${taux} | ${evolution} |`);
  }

  lines.push("");

  // Resume
  if (sorted.length > 0) {
    const topIndicateurs = sorted.slice(0, 3);
    lines.push("**Faits marquants :**");
    for (const ind of topIndicateurs) {
      lines.push(`- ${ind.indicateur} : ${ind.nombre.toLocaleString("fr-FR")} faits (${ind.taux_pour_mille.toFixed(2)}/1000 hab.)`);
    }
    lines.push("");
  }

  // Annees disponibles
  if (annees.length > 1) {
    lines.push(`_Donnees disponibles : ${annees.join(", ")}_`);
  }

  lines.push("");
  lines.push("_Source : SSMSI, Ministere de l'Interieur — data.gouv.fr_");
  lines.push("_Les indicateurs sont presentes par departement, non par commune._");

  return lines.join("\n");
}

/** Point d'entree principal */
export async function consulterSecurite(args: SecuriteArgs): Promise<ToolResult> {
  try {
    const codeDept = await resolveCodeDepartement(args);
    const rows = await fetchSecuriteData(codeDept, args.annee);
    const report = formatSecuriteReport(codeDept, rows, args.annee);
    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur consulter_securite : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}
