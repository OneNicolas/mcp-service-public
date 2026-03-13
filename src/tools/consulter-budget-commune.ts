/**
 * T85a — consulter_budget_commune
 * Comptes financiers d'une commune depuis l'OFGL (data.ofgl.fr — Opendatasoft v2.1)
 * Dataset : ofgl-base-communes (2017-2024)
 * Structure : une ligne par (commune, annee, agregat, budget) — pivot necessaire
 */

import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

const OFGL_API = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-communes/records";

// Agregats cles a extraire (nom exact tel que retourne par l'API)
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

// Noms normalises pour la comparaison (sans accents ni apostrophes)
function normalizeAgregat(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, " ")
    .trim();
}

const AGREGATS_NORMALISES = new Set(AGREGATS_CLES.map(normalizeAgregat));

interface BudgetCommuneArgs {
  commune?: string;
  code_postal?: string;
  code_insee?: string;
  annee?: number;
}

interface AgregatRow {
  exer: string;
  com_code: string;
  com_name: string;
  dep_name: string;
  reg_name: string;
  epci_name: string;
  ptot: number;
  agregat: string;
  montant: number;
  euros_par_habitant: number;
}

/** Resout les arguments en code INSEE 5 chiffres */
async function resolveInsee(args: BudgetCommuneArgs): Promise<{ code: string; nom: string } | null> {
  if (args.code_insee) return { code: args.code_insee.trim(), nom: args.code_insee.trim() };

  if (args.code_postal) {
    const communes = await resolveCodePostal(args.code_postal);
    if (communes.length > 0) return { code: communes[0].code, nom: communes[0].nom };
  }

  if (args.commune) {
    const resolved = await resolveNomCommune(args.commune);
    if (resolved) return { code: resolved.code, nom: resolved.nom };
  }

  return null;
}

/** Recupere les donnees budgetaires d'une commune */
async function fetchBudgetData(codeInsee: string): Promise<AgregatRow[]> {
  const whereFilters = [
    `com_code="${sanitize(codeInsee)}"`,
    `type_de_budget="Budget principal"`,
  ];

  // Pas de filtre date : on recupere les dernieres annees disponibles, on trie en desc
  const params = new URLSearchParams({
    limit: "100",
    where: whereFilters.join(" AND "),
    order_by: "exer desc, agregat asc",
    select: "exer,com_code,com_name,dep_name,reg_name,epci_name,ptot,agregat,montant,euros_par_habitant",
  });

  const response = await cachedFetch(`${OFGL_API}?${params}`, { ttl: CACHE_TTL.REI });
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
    com_code: String(row.com_code ?? ""),
    com_name: String(row.com_name ?? ""),
    dep_name: String(row.dep_name ?? ""),
    reg_name: String(row.reg_name ?? ""),
    epci_name: String(row.epci_name ?? ""),
    ptot: Number(row.ptot ?? 0),
    agregat,
    montant,
    euros_par_habitant: Number(row.euros_par_habitant ?? 0),
  };
}

/** Pivote les lignes par annee → Map<agregat, montant> */
function pivotByYear(rows: AgregatRow[]): Map<string, Map<string, { montant: number; eph: number }>> {
  // year → agregat → { montant, euros_par_habitant }
  const pivot = new Map<string, Map<string, { montant: number; eph: number }>>();

  for (const row of rows) {
    if (!pivot.has(row.exer)) pivot.set(row.exer, new Map());
    const yearMap = pivot.get(row.exer)!;
    const norm = normalizeAgregat(row.agregat);
    if (!yearMap.has(norm)) {
      yearMap.set(norm, { montant: row.montant, eph: row.euros_par_habitant });
    } else {
      // Sommer les lignes du meme agregat (ex : plusieurs budgets annexes)
      const existing = yearMap.get(norm)!;
      yearMap.set(norm, { montant: existing.montant + row.montant, eph: existing.eph });
    }
  }
  return pivot;
}

function getVal(yearMap: Map<string, { montant: number; eph: number }>, agregat: string): number | null {
  const norm = normalizeAgregat(agregat);
  return yearMap.get(norm)?.montant ?? null;
}

function getEph(yearMap: Map<string, { montant: number; eph: number }>, agregat: string): number | null {
  const norm = normalizeAgregat(agregat);
  return yearMap.get(norm)?.eph ?? null;
}

function fmtM(val: number | null): string {
  if (val === null) return "N/A";
  const m = val / 1_000_000;
  return `${m >= 0 ? "" : ""}${m.toFixed(2)} M€`;
}

function fmtEph(val: number | null): string {
  if (val === null) return "";
  return ` (${val.toFixed(0)} €/hab.)`;
}

function sanitize(s: string): string {
  return s.replace(/['"\\]/g, "");
}

/** Formate le rapport budgetaire */
function formatBudgetReport(rows: AgregatRow[], requestedAnnee?: number): string {
  if (rows.length === 0) return "Aucune donnee budgetaire disponible pour cette commune.";

  // Meta depuis la premiere ligne
  const first = rows[0];
  const pivot = pivotByYear(rows);

  // Annees disponibles triees desc
  const annees = [...pivot.keys()].sort((a, b) => b.localeCompare(a));
  const targetAnnee = requestedAnnee ? String(requestedAnnee) : annees[0];
  const yearMap = pivot.get(targetAnnee);

  if (!yearMap) {
    return `Aucune donnee disponible pour l'annee ${targetAnnee}. Annees disponibles : ${annees.join(", ")}.`;
  }

  const pop = first.ptot.toLocaleString("fr-FR");
  const lines: string[] = [];

  lines.push(`**Budget de la commune de ${first.com_name}** (${first.com_code}) — Exercice ${targetAnnee}`);
  lines.push(`Departement : ${first.dep_name} | Region : ${first.reg_name}`);
  lines.push(`Intercommunalite : ${first.epci_name}`);
  lines.push(`Population : ${pop} habitants`);
  lines.push("");

  // Section fonctionnement
  const recFonct = getVal(yearMap, "Recettes de fonctionnement");
  const depFonct = getVal(yearMap, "Depenses de fonctionnement");
  const epargneBrute = getVal(yearMap, "Epargne brute");
  const epargneNette = getVal(yearMap, "Epargne nette");
  const fraisPerso = getVal(yearMap, "Frais de personnel");
  const impots = getVal(yearMap, "Impots et taxes");

  lines.push("**Section de fonctionnement**");
  lines.push(`  Recettes de fonctionnement : **${fmtM(recFonct)}**${fmtEph(getEph(yearMap, "Recettes de fonctionnement"))}`);
  lines.push(`  Depenses de fonctionnement : **${fmtM(depFonct)}**${fmtEph(getEph(yearMap, "Depenses de fonctionnement"))}`);
  if (fraisPerso !== null) lines.push(`    dont Frais de personnel : ${fmtM(fraisPerso)}${fmtEph(getEph(yearMap, "Frais de personnel"))}`);
  if (impots !== null) lines.push(`    dont Impots et taxes : ${fmtM(impots)}${fmtEph(getEph(yearMap, "Impots et taxes"))}`);
  lines.push("");

  lines.push("**Epargne**");
  lines.push(`  Epargne brute : **${fmtM(epargneBrute)}**${fmtEph(getEph(yearMap, "Epargne brute"))}`);
  if (epargneNette !== null) lines.push(`  Epargne nette : ${fmtM(epargneNette)}${fmtEph(getEph(yearMap, "Epargne nette"))}`);
  lines.push("");

  // Section investissement
  const depInvest = getVal(yearMap, "Depenses d'investissement");
  const depEquip = getVal(yearMap, "Depenses d'equipement");
  const dette = getVal(yearMap, "Encours de dette");
  const annuite = getVal(yearMap, "Annuite de la dette");
  const capFinancement = getVal(yearMap, "Capacite ou besoin de financement");

  lines.push("**Investissement et dette**");
  if (depInvest !== null) lines.push(`  Depenses d'investissement : **${fmtM(depInvest)}**${fmtEph(getEph(yearMap, "Depenses d'investissement"))}`);
  if (depEquip !== null) lines.push(`    dont Depenses d'equipement : ${fmtM(depEquip)}${fmtEph(getEph(yearMap, "Depenses d'equipement"))}`);
  if (dette !== null) lines.push(`  Encours de dette : **${fmtM(dette)}**${fmtEph(getEph(yearMap, "Encours de dette"))}`);
  if (annuite !== null) lines.push(`  Annuite de la dette : ${fmtM(annuite)}${fmtEph(getEph(yearMap, "Annuite de la dette"))}`);
  if (capFinancement !== null) {
    const sign = (capFinancement >= 0) ? "Capacite" : "Besoin";
    lines.push(`  ${sign} de financement : ${fmtM(Math.abs(capFinancement))}`);
  }
  lines.push("");

  // Recettes et depenses totales
  const recTot = getVal(yearMap, "Recettes totales");
  const depTot = getVal(yearMap, "Depenses totales");
  lines.push("**Totaux**");
  lines.push(`  Recettes totales : **${fmtM(recTot)}**${fmtEph(getEph(yearMap, "Recettes totales"))}`);
  lines.push(`  Depenses totales : **${fmtM(depTot)}**${fmtEph(getEph(yearMap, "Depenses totales"))}`);
  lines.push("");

  // Annees disponibles
  if (annees.length > 1) {
    lines.push(`_Donnees disponibles : ${annees.join(", ")} — Utilisez le parametre \`annee\` pour consulter une annee anterieure._`);
  }
  lines.push("");
  lines.push(`_Source : OFGL — Comptes des communes ${targetAnnee} (budget principal). data.ofgl.fr | Licence Ouverte 2.0_`);
  lines.push("_Montants en euros. Agregats calcules par l'OFGL a partir des balances comptables DGFiP._");

  return lines.join("\n");
}

export async function consulterBudgetCommune(args: BudgetCommuneArgs): Promise<ToolResult> {
  try {
    if (!args.commune && !args.code_postal && !args.code_insee) {
      return {
        content: [{ type: "text", text: "Veuillez fournir un nom de commune, un code postal ou un code INSEE." + suggestAlternative("consulter_budget_commune") }],
        isError: true,
      };
    }

    const resolved = await resolveInsee(args);
    if (!resolved) {
      const label = args.commune ?? args.code_postal ?? args.code_insee ?? "";
      return {
        content: [{ type: "text", text: `Commune introuvable : "${label}". Verifiez l'orthographe ou utilisez un code INSEE.` }],
        isError: true,
      };
    }

    const rows = await fetchBudgetData(resolved.code);
    const report = formatBudgetReport(rows, args.annee);

    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur consulter_budget_commune : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

// Export for comparer_communes integration (future use)
export { AGREGATS_NORMALISES };

export interface BudgetCompareData {
  epargneBrute: number | null;
  encoursDette: number | null;
  epargneBruteEph: number | null;
  encoursDetteEph: number | null;
  annee: string | null;
}

/** Recupere epargne brute et encours de dette (derniere annee) pour comparaison de communes */
export async function fetchBudgetForCompare(codeInsee: string): Promise<BudgetCompareData | null> {
  try {
    const rows = await fetchBudgetData(codeInsee);
    if (rows.length === 0) return null;

    const pivot = pivotByYear(rows);
    const annees = [...pivot.keys()].sort((a, b) => b.localeCompare(a));
    const latestAnnee = annees[0];
    if (!latestAnnee) return null;

    const yearMap = pivot.get(latestAnnee)!;
    const epargneBrute = getVal(yearMap, "Epargne brute");
    const encoursDette = getVal(yearMap, "Encours de dette");
    const epargneBruteEph = getEph(yearMap, "Epargne brute");
    const encoursDetteEph = getEph(yearMap, "Encours de dette");

    if (epargneBrute === null && encoursDette === null) return null;

    return { epargneBrute, encoursDette, epargneBruteEph, encoursDetteEph, annee: latestAnnee };
  } catch {
    return null;
  }
}
