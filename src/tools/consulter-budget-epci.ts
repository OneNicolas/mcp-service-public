/**
 * T25-T3 -- consulter_budget_epci
 * Comptes financiers d'un EPCI (Groupement a Fiscalite Propre) depuis l'OFGL.
 * Source : data.ofgl.fr -- dataset ofgl-base-gfp (2017-2024)
 * Structure : une ligne par (epci, annee, agregat) -- pivot necessaire
 * Note : les montants consolidation incluent budget principal + budgets annexes
 */

import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

const OFGL_GFP_API = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-gfp/records";
const GEO_API = "https://geo.api.gouv.fr/communes";

const TYPE_GFP_LABELS: Record<string, string> = {
  CA: "Communaute d'Agglomeration",
  CC: "Communaute de Communes",
  CU: "Communaute Urbaine",
  ME: "Metropole",
};

// Agregats cles (meme liste que communes)
const AGREGATS_CLES = [
  "Recettes totales",
  "Depenses totales",
  "Recettes de fonctionnement",
  "Depenses de fonctionnement",
  "Epargne brute",
  "Epargne nette",
  "Encours de dette",
  "Annuite de la dette",
  "Depenses d'investissement",
  "Depenses d'equipement",
  "Impots et taxes",
  "Frais de personnel",
  "Capacite ou besoin de financement",
];

function normalizeAgregat(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, " ")
    .trim();
}

const AGREGATS_NORMALISES = new Set(AGREGATS_CLES.map(normalizeAgregat));

export interface BudgetEpciArgs {
  epci?: string;        // nom de l'EPCI (ex: "Bordeaux Metropole")
  code_siren?: string;  // SIREN de l'EPCI (9 chiffres)
  commune?: string;     // commune membre -> resolution vers EPCI via geo.api.gouv.fr
  annee?: number;
}

interface AgregatRow {
  exer: string;
  gfp_code: string;
  gfp_name: string;
  dep_name: string;
  reg_name: string;
  type_gfp: string;
  ptot: number;
  agregat: string;
  montant: number;
  euros_par_habitant: number;
}

/** Resout une commune membre vers le code SIREN et nom de son EPCI */
async function resolveEpciFromCommune(commune: string): Promise<{ code: string; nom: string } | null> {
  const params = new URLSearchParams({ nom: commune, fields: "epci", limit: "1" });
  const response = await cachedFetch(`${GEO_API}?${params}`, { ttl: CACHE_TTL.GEO_API });
  if (!response.ok) return null;
  const data = await response.json() as Array<{ epci?: { code: string; nom: string } }>;
  return data[0]?.epci ?? null;
}

/** Recupere les donnees budgetaires d'un EPCI par code SIREN ou nom */
async function fetchBudgetEpciData(filter: { sirenCode?: string; epciNom?: string }): Promise<AgregatRow[]> {
  const whereClause = filter.sirenCode
    ? `gfp_code="${sanitize(filter.sirenCode)}"`
    : `gfp_name like "%${sanitize(filter.epciNom ?? "")}%"`;

  const params = new URLSearchParams({
    limit: "100",
    where: whereClause,
    order_by: "exer desc, agregat asc",
    select: "exer,gfp_code,gfp_name,dep_name,reg_name,type_gfp,ptot,agregat,montant,euros_par_habitant",
  });

  const response = await cachedFetch(`${OFGL_GFP_API}?${params}`, { ttl: CACHE_TTL.REI });
  if (!response.ok) {
    throw new Error(`data.ofgl.fr HTTP ${response.status}`);
  }

  const data = await response.json() as { results: Array<Record<string, unknown>> };
  return (data.results ?? []).map(parseRow).filter((r): r is AgregatRow => r !== null);
}

function parseRow(r: Record<string, unknown>): AgregatRow | null {
  const row = (r as { additional_properties?: Record<string, unknown> }).additional_properties ?? r;
  const agregat = String(row.agregat ?? "");
  const montant = Number(row.montant ?? 0);
  if (!agregat || isNaN(montant)) return null;
  return {
    exer: String(row.exer ?? ""),
    gfp_code: String(row.gfp_code ?? ""),
    gfp_name: String(row.gfp_name ?? ""),
    dep_name: String(row.dep_name ?? ""),
    reg_name: String(row.reg_name ?? ""),
    type_gfp: String(row.type_gfp ?? ""),
    ptot: Number(row.ptot ?? 0),
    agregat,
    montant,
    euros_par_habitant: Number(row.euros_par_habitant ?? 0),
  };
}

/** Pivote les lignes par annee */
function pivotByYear(rows: AgregatRow[]): Map<string, Map<string, { montant: number; eph: number }>> {
  const pivot = new Map<string, Map<string, { montant: number; eph: number }>>();
  for (const row of rows) {
    if (!pivot.has(row.exer)) pivot.set(row.exer, new Map());
    const yearMap = pivot.get(row.exer)!;
    const norm = normalizeAgregat(row.agregat);
    if (!AGREGATS_NORMALISES.has(norm)) continue;
    if (!yearMap.has(norm)) {
      yearMap.set(norm, { montant: row.montant, eph: row.euros_par_habitant });
    } else {
      // Sommer les lignes du meme agregat (budgets annexes multiples)
      const existing = yearMap.get(norm)!;
      yearMap.set(norm, { montant: existing.montant + row.montant, eph: existing.eph });
    }
  }
  return pivot;
}

function getVal(yearMap: Map<string, { montant: number; eph: number }>, agregat: string): number | null {
  return yearMap.get(normalizeAgregat(agregat))?.montant ?? null;
}

function getEph(yearMap: Map<string, { montant: number; eph: number }>, agregat: string): number | null {
  return yearMap.get(normalizeAgregat(agregat))?.eph ?? null;
}

function fmtM(val: number | null): string {
  if (val === null) return "N/A";
  return `${(val / 1_000_000).toFixed(2)} M\u20ac`;
}

function fmtEph(val: number | null): string {
  if (val === null) return "";
  return ` (${val.toFixed(0)} \u20ac/hab.)`;
}

function sanitize(s: string): string {
  return s.replace(/['"\\]/g, "");
}

/** Formate le rapport budgetaire EPCI */
function formatBudgetEpciReport(rows: AgregatRow[], requestedAnnee?: number): string {
  if (rows.length === 0) return "Aucune donnee budgetaire disponible pour cet EPCI.";

  const first = rows[0];
  const pivot = pivotByYear(rows);
  const annees = [...pivot.keys()].sort((a, b) => b.localeCompare(a));
  const targetAnnee = requestedAnnee ? String(requestedAnnee) : annees[0];
  const yearMap = pivot.get(targetAnnee);

  if (!yearMap) {
    return `Aucune donnee disponible pour l'annee ${targetAnnee}. Annees disponibles : ${annees.join(", ")}.`;
  }

  const typeLabel = TYPE_GFP_LABELS[first.type_gfp] ?? first.type_gfp ?? "EPCI";
  const pop = first.ptot > 0 ? first.ptot.toLocaleString("fr-FR") : "N/A";
  const lines: string[] = [];

  lines.push(`**Budget de ${first.gfp_name}** (SIREN : ${first.gfp_code}) -- Exercice ${targetAnnee}`);
  lines.push(`Type d'EPCI : ${typeLabel}`);
  lines.push(`Departement : ${first.dep_name} | Region : ${first.reg_name}`);
  lines.push(`Population : ${pop} habitants`);
  lines.push("");

  lines.push("**Section de fonctionnement**");
  lines.push(`  Recettes de fonctionnement : **${fmtM(getVal(yearMap, "Recettes de fonctionnement"))}**${fmtEph(getEph(yearMap, "Recettes de fonctionnement"))}`);
  lines.push(`  Depenses de fonctionnement : **${fmtM(getVal(yearMap, "Depenses de fonctionnement"))}**${fmtEph(getEph(yearMap, "Depenses de fonctionnement"))}`);
  const fraisPerso = getVal(yearMap, "Frais de personnel");
  const impots = getVal(yearMap, "Impots et taxes");
  if (fraisPerso !== null) lines.push(`    dont Frais de personnel : ${fmtM(fraisPerso)}${fmtEph(getEph(yearMap, "Frais de personnel"))}`);
  if (impots !== null) lines.push(`    dont Impots et taxes : ${fmtM(impots)}${fmtEph(getEph(yearMap, "Impots et taxes"))}`);
  lines.push("");

  lines.push("**Epargne**");
  lines.push(`  Epargne brute : **${fmtM(getVal(yearMap, "Epargne brute"))}**${fmtEph(getEph(yearMap, "Epargne brute"))}`);
  const epargneNette = getVal(yearMap, "Epargne nette");
  if (epargneNette !== null) lines.push(`  Epargne nette : ${fmtM(epargneNette)}${fmtEph(getEph(yearMap, "Epargne nette"))}`);
  lines.push("");

  lines.push("**Investissement et dette**");
  const depInvest = getVal(yearMap, "Depenses d'investissement");
  const depEquip = getVal(yearMap, "Depenses d'equipement");
  const dette = getVal(yearMap, "Encours de dette");
  const annuite = getVal(yearMap, "Annuite de la dette");
  const capFinancement = getVal(yearMap, "Capacite ou besoin de financement");
  if (depInvest !== null) lines.push(`  Depenses d'investissement : **${fmtM(depInvest)}**${fmtEph(getEph(yearMap, "Depenses d'investissement"))}`);
  if (depEquip !== null) lines.push(`    dont Depenses d'equipement : ${fmtM(depEquip)}${fmtEph(getEph(yearMap, "Depenses d'equipement"))}`);
  if (dette !== null) lines.push(`  Encours de dette : **${fmtM(dette)}**${fmtEph(getEph(yearMap, "Encours de dette"))}`);
  if (annuite !== null) lines.push(`  Annuite de la dette : ${fmtM(annuite)}${fmtEph(getEph(yearMap, "Annuite de la dette"))}`);
  if (capFinancement !== null) {
    const sign = capFinancement >= 0 ? "Capacite" : "Besoin";
    lines.push(`  ${sign} de financement : ${fmtM(Math.abs(capFinancement))}`);
  }
  lines.push("");

  lines.push("**Totaux**");
  lines.push(`  Recettes totales : **${fmtM(getVal(yearMap, "Recettes totales"))}**${fmtEph(getEph(yearMap, "Recettes totales"))}`);
  lines.push(`  Depenses totales : **${fmtM(getVal(yearMap, "Depenses totales"))}**${fmtEph(getEph(yearMap, "Depenses totales"))}`);
  lines.push("");

  if (annees.length > 1) {
    lines.push(`_Donnees disponibles : ${annees.join(", ")} -- Utilisez le parametre \`annee\` pour consulter une annee anterieure._`);
  }
  lines.push("");
  lines.push(`_Source : OFGL -- Comptes des EPCI ${targetAnnee} (budget principal + annexes). data.ofgl.fr | Licence Ouverte 2.0_`);
  lines.push("_Montants en euros. Les montants incluent le budget principal et les budgets annexes consolides._");

  return lines.join("\n");
}

export async function consulterBudgetEpci(args: BudgetEpciArgs): Promise<ToolResult> {
  try {
    if (!args.epci && !args.code_siren && !args.commune) {
      return {
        content: [{ type: "text", text: "Veuillez fournir un nom d'EPCI, un code SIREN ou une commune membre." + suggestAlternative("consulter_budget_epci") }],
        isError: true,
      };
    }

    let sirenCode: string | undefined;
    let epciNomFiltre: string | undefined;

    if (args.code_siren) {
      sirenCode = args.code_siren.trim();
    } else if (args.commune) {
      const resolved = await resolveEpciFromCommune(args.commune);
      if (!resolved) {
        return {
          content: [{ type: "text", text: `Impossible de trouver l'EPCI de la commune "${args.commune}". Verifiez l'orthographe ou utilisez le code SIREN.` }],
          isError: true,
        };
      }
      sirenCode = resolved.code;
    } else if (args.epci) {
      epciNomFiltre = args.epci;
    }

    const rows = await fetchBudgetEpciData({ sirenCode, epciNom: epciNomFiltre });
    if (rows.length === 0) {
      const label = args.epci ?? args.code_siren ?? args.commune ?? "";
      return {
        content: [{ type: "text", text: `Aucune donnee budgetaire trouvee pour "${label}". Verifiez le nom ou utilisez le code SIREN a 9 chiffres.` }],
      };
    }

    return { content: [{ type: "text", text: formatBudgetEpciReport(rows, args.annee) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur consulter_budget_epci : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}
