import type { ToolResult } from "../types.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";

const DVF_RESOURCE_ID = "d7933994-2c66-4131-a4da-cf7cd18040a4";
const TABULAR_API = `https://tabular-api.data.gouv.fr/api/resources/${DVF_RESOURCE_ID}/data/`;
const MAX_PAGE_SIZE = 200;
const MAX_PAGES_NORMAL = 15; // communes classiques
const MAX_PAGES_PLM = 3;    // par arrondissement PLM (limiter la charge)

// Paris, Lyon, Marseille : code INSEE unique → arrondissements DVF
const PLM_ARRONDISSEMENTS: Record<string, string[]> = {
  "75056": Array.from({ length: 20 }, (_, i) => `751${String(i + 1).padStart(2, "0")}`),
  "69123": Array.from({ length: 9 }, (_, i) => `6938${i + 1}`),
  "13055": Array.from({ length: 16 }, (_, i) => `132${String(i + 1).padStart(2, "0")}`),
};

interface ConsulterTransactionsArgs {
  commune?: string;
  code_insee?: string;
  code_postal?: string;
  type_local?: string;
  annee?: number;
  evolution?: boolean;
}

interface DvfRecord {
  id_mutation: string;
  date_mutation: string;
  nature_mutation: string;
  valeur_fonciere: number | null;
  code_postal: string;
  code_commune: string;
  nom_commune: string;
  type_local: string | null;
  surface_reelle_bati: number | null;
  nombre_pieces_principales: number | null;
  surface_terrain: number | null;
}

interface MutationAgg {
  id: string;
  date: string;
  prix: number;
  type: string;
  surface: number;
  pieces: number;
}

/** Consulte les transactions immobili\u00e8res (DVF) via data.gouv.fr */
export async function consulterTransactionsImmobilieres(
  args: ConsulterTransactionsArgs,
): Promise<ToolResult> {
  const { commune, code_insee, code_postal, type_local, annee, evolution } = args;

  if (!commune && !code_insee && !code_postal) {
    return {
      content: [{ type: "text", text: "Veuillez fournir un nom de commune, un code INSEE ou un code postal." }],
      isError: true,
    };
  }

  try {
    const codeInseeList = await resolveInseeList(commune, code_insee, code_postal);

    if (!codeInseeList.length) {
      return {
        content: [{ type: "text", text: "Aucune commune trouv\u00e9e pour les crit\u00e8res fournis." }],
        isError: true,
      };
    }

    // T35 -- Mode evolution multi-annees
    if (evolution) {
      return fetchEvolution(codeInseeList, type_local);
    }

    // Mode standard (existant)
    const isPLM = codeInseeList.some((c) => PLM_ARRONDISSEMENTS[c]);
    const expandedCodes = expandPLM(codeInseeList);
    const maxPages = isPLM ? MAX_PAGES_PLM : MAX_PAGES_NORMAL;

    const dateMin = annee
      ? `${annee}-01-01`
      : `${new Date().getFullYear() - 2}-01-01`;
    const dateMax = annee ? `${annee}-12-31` : undefined;

    const allMutations: MutationAgg[] = [];
    const communeLabels: string[] = [];
    const plmLabel = getPLMLabel(codeInseeList);
    const errors: string[] = [];

    if (isPLM) {
      const batchSize = 3;
      for (let i = 0; i < expandedCodes.length; i += batchSize) {
        const batch = expandedCodes.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((code) => fetchDvfForCommune(code, type_local, dateMin, dateMax, maxPages)),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            allMutations.push(...r.value.mutations);
          } else {
            errors.push(r.reason?.message ?? "erreur inconnue");
          }
        }
      }
    } else {
      for (const code of expandedCodes) {
        const { mutations, communeNom } = await fetchDvfForCommune(
          code, type_local, dateMin, dateMax, maxPages,
        );
        allMutations.push(...mutations);
        if (!communeLabels.includes(`${communeNom} (${code})`)) {
          communeLabels.push(`${communeNom} (${code})`);
        }
      }
    }

    if (plmLabel) communeLabels.push(plmLabel);

    if (!allMutations.length) {
      const typeNote = type_local ? ` de type "${type_local}"` : "";
      const periodNote = annee ? ` en ${annee}` : " sur les 2 derni\u00e8res ann\u00e9es";
      return {
        content: [{
          type: "text",
          text: `Aucune transaction${typeNote} trouv\u00e9e${periodNote} pour ${communeLabels.join(", ")}.\n\n\u26a0\ufe0f Les donn\u00e9es DVF excluent l'Alsace, la Moselle et Mayotte.`,
        }],
      };
    }

    let report = buildReport(allMutations, communeLabels, type_local, annee);
    if (errors.length > 0) {
      report += `\n\n\u26a0\ufe0f ${errors.length} arrondissement(s) n'ont pas pu \u00eatre interrog\u00e9s (donn\u00e9es partielles).`;
    }
    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur DVF : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

// --- T35 : Mode evolution multi-annees ---

const EVOLUTION_YEARS_START = 2019;
const EVOLUTION_MAX_PAGES = 5; // par annee, limiter les appels API

interface YearStats {
  annee: number;
  nb_transactions: number;
  prix_median: number;
  prix_median_m2: number | null;
}

/** Collecte les stats DVF annee par annee et calcule la tendance */
async function fetchEvolution(
  codeInseeList: string[],
  typeLocal?: string,
): Promise<ToolResult> {
  const isPLM = codeInseeList.some((c) => PLM_ARRONDISSEMENTS[c]);
  const expandedCodes = expandPLM(codeInseeList);
  const maxPages = isPLM ? Math.min(MAX_PAGES_PLM, EVOLUTION_MAX_PAGES) : EVOLUTION_MAX_PAGES;

  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: currentYear - EVOLUTION_YEARS_START + 1 },
    (_, i) => EVOLUTION_YEARS_START + i,
  );

  const communeLabels: string[] = [];
  const plmLabel = getPLMLabel(codeInseeList);
  const yearStats: YearStats[] = [];

  // Traiter annee par annee sequentiellement
  for (const year of years) {
    const dateMin = `${year}-01-01`;
    const dateMax = `${year}-12-31`;
    const allMutations: MutationAgg[] = [];

    if (isPLM) {
      const batchSize = 3;
      for (let i = 0; i < expandedCodes.length; i += batchSize) {
        const batch = expandedCodes.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((code) => fetchDvfForCommune(code, typeLocal, dateMin, dateMax, maxPages)),
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            allMutations.push(...r.value.mutations);
            if (communeLabels.length === 0 && r.value.communeNom) {
              communeLabels.push(r.value.communeNom);
            }
          }
        }
      }
    } else {
      for (const code of expandedCodes) {
        try {
          const { mutations, communeNom } = await fetchDvfForCommune(
            code, typeLocal, dateMin, dateMax, maxPages,
          );
          allMutations.push(...mutations);
          const label = `${communeNom} (${code})`;
          if (!communeLabels.includes(label)) communeLabels.push(label);
        } catch { /* annee sans donnees, continuer */ }
      }
    }

    if (plmLabel && !communeLabels.includes(plmLabel)) {
      communeLabels.push(plmLabel);
    }

    if (allMutations.length === 0) continue;

    const clean = filterOutliers(allMutations);
    const prices = clean.map((m) => m.prix).sort((a, b) => a - b);
    const withSurface = clean.filter((m) => m.surface > 0);
    const prixM2 = withSurface.length >= 3
      ? median(withSurface.map((m) => m.prix / m.surface).sort((a, b) => a - b))
      : null;

    yearStats.push({
      annee: year,
      nb_transactions: clean.length,
      prix_median: median(prices),
      prix_median_m2: prixM2,
    });
  }

  if (!yearStats.length) {
    const typeNote = typeLocal ? ` de type "${typeLocal}"` : "";
    return {
      content: [{
        type: "text",
        text: `Aucune transaction${typeNote} trouv\u00e9e pour ${communeLabels.join(", ") || "la commune"} entre ${EVOLUTION_YEARS_START} et ${currentYear}.\n\n\u26a0\ufe0f Les donn\u00e9es DVF excluent l'Alsace, la Moselle et Mayotte.`,
      }],
    };
  }

  const report = buildEvolutionReport(yearStats, communeLabels, typeLocal);
  return { content: [{ type: "text", text: report }] };
}

/** Construit le rapport d'evolution multi-annees */
function buildEvolutionReport(
  stats: YearStats[],
  communeLabels: string[],
  typeLocal?: string,
): string {
  const lines: string[] = [];
  const typeLabel = typeLocal ?? "Tous biens";

  lines.push(`\ud83d\udcc8 \u00c9volution des prix immobiliers \u2014 ${communeLabels.join(", ")}`);
  lines.push(`   Type : ${typeLabel} | P\u00e9riode : ${stats[0].annee}\u2013${stats[stats.length - 1].annee}`);
  lines.push(`   Source : DVF (DGFiP) via data.gouv.fr`);
  lines.push("");

  const hasM2 = stats.some((s) => s.prix_median_m2 !== null);
  if (hasM2) {
    lines.push("  Ann\u00e9e  | Transactions | Prix m\u00e9dian     | Prix m\u00e9dian/m\u00b2");
    lines.push("  -------|-------------|----------------|----------------");
    for (const s of stats) {
      const m2 = s.prix_median_m2 !== null ? formatEuro(s.prix_median_m2) + "/m\u00b2" : "n/a";
      lines.push(`  ${s.annee}   | ${String(s.nb_transactions).padStart(11)} | ${formatEuro(s.prix_median).padStart(14)} | ${m2}`);
    }
  } else {
    lines.push("  Ann\u00e9e  | Transactions | Prix m\u00e9dian");
    lines.push("  -------|-------------|---------------");
    for (const s of stats) {
      lines.push(`  ${s.annee}   | ${String(s.nb_transactions).padStart(11)} | ${formatEuro(s.prix_median)}`);
    }
  }
  lines.push("");

  if (stats.length >= 2) {
    const first = stats[0];
    const last = stats[stats.length - 1];
    const variation = ((last.prix_median - first.prix_median) / first.prix_median) * 100;
    const trend = variation > 5 ? "\ud83d\udcc8 Hausse" : variation < -5 ? "\ud83d\udcc9 Baisse" : "\u27a1\ufe0f Stable";
    lines.push(`  Tendance ${first.annee}\u2013${last.annee} : ${trend} (${variation >= 0 ? "+" : ""}${variation.toFixed(1)} %)`);

    if (hasM2 && first.prix_median_m2 !== null && last.prix_median_m2 !== null) {
      const varM2 = ((last.prix_median_m2 - first.prix_median_m2) / first.prix_median_m2) * 100;
      lines.push(`  Prix/m\u00b2 : ${formatEuro(first.prix_median_m2)} \u2192 ${formatEuro(last.prix_median_m2)} (${varM2 >= 0 ? "+" : ""}${varM2.toFixed(1)} %)`);
    }
    lines.push("");
  }

  lines.push("\u26a0\ufe0f Donn\u00e9es DVF (DGFiP) \u2014 hors Alsace, Moselle et Mayotte.");
  lines.push("   \u00c9chantillon limit\u00e9 par ann\u00e9e. Indicatif uniquement.");

  return lines.join("\n");
}

// --- R\u00e9solution des codes INSEE ---

async function resolveInseeList(
  commune?: string,
  codeInsee?: string,
  codePostal?: string,
): Promise<string[]> {
  if (codeInsee) return [codeInsee.trim()];

  if (codePostal) {
    const communes = await resolveCodePostal(codePostal);
    return communes.map((c) => c.code);
  }

  if (commune) {
    const resolved = await resolveNomCommune(commune);
    if (resolved) return [resolved.code];
  }

  return [];
}

/** Expanse les codes PLM en codes arrondissements DVF */
function expandPLM(codes: string[]): string[] {
  const result: string[] = [];
  for (const code of codes) {
    const arrondissements = PLM_ARRONDISSEMENTS[code];
    if (arrondissements) {
      result.push(...arrondissements);
    } else {
      result.push(code);
    }
  }
  return result;
}

/** Retourne un label lisible pour PLM, ou null si pas PLM */
function getPLMLabel(codes: string[]): string | null {
  const plmNames: Record<string, string> = {
    "75056": "Paris",
    "69123": "Lyon",
    "13055": "Marseille",
  };
  for (const code of codes) {
    if (plmNames[code]) return `${plmNames[code]} (tous arrondissements)`;
  }
  return null;
}

// --- Fetch DVF depuis l'API Tabular ---

async function fetchDvfForCommune(
  codeInsee: string,
  typeLocal?: string,
  dateMin?: string,
  dateMax?: string,
  maxPages: number = MAX_PAGES_NORMAL,
): Promise<{ mutations: MutationAgg[]; communeNom: string; totalInApi: number }> {
  const params = new URLSearchParams({
    page: "1",
    page_size: String(MAX_PAGE_SIZE),
    code_commune__exact: codeInsee,
    nature_mutation__exact: "Vente",
  });
  if (typeLocal) params.set("type_local__exact", typeLocal);
  if (dateMin) params.set("date_mutation__greater", dateMin);
  if (dateMax) params.set("date_mutation__less", dateMax);

  const firstPage = await fetchPage(params);
  let allRecords = firstPage.data ?? [];
  const communeNom = allRecords[0]?.nom_commune ?? codeInsee;

  if (allRecords.length === MAX_PAGE_SIZE) {
    for (let p = 2; p <= maxPages; p++) {
      const nextParams = new URLSearchParams(params);
      nextParams.set("page", String(p));
      try {
        const page = await fetchPage(nextParams);
        if (!page.data?.length) break;
        allRecords = allRecords.concat(page.data);
        if (page.data.length < MAX_PAGE_SIZE) break;
      } catch {
        break;
      }
    }
  }

  const seen = new Map<string, MutationAgg>();
  for (const rec of allRecords) {
    const id = rec.id_mutation;
    if (!id || !rec.valeur_fonciere || rec.valeur_fonciere <= 0) continue;
    if (!rec.type_local || rec.type_local === "D\u00e9pendance") continue;

    if (seen.has(id)) {
      const existing = seen.get(id)!;
      if ((rec.surface_reelle_bati ?? 0) <= existing.surface) continue;
    }

    seen.set(id, {
      id,
      date: rec.date_mutation,
      prix: rec.valeur_fonciere,
      type: rec.type_local,
      surface: rec.surface_reelle_bati ?? 0,
      pieces: rec.nombre_pieces_principales ?? 0,
    });
  }

  return {
    mutations: Array.from(seen.values()),
    communeNom,
    totalInApi: allRecords.length,
  };
}

interface TabularResponse {
  data: DvfRecord[];
  meta?: { page: number; page_size: number; total: number };
}

async function fetchPage(params: URLSearchParams): Promise<TabularResponse> {
  const url = `${TABULAR_API}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API DVF erreur ${response.status} : ${response.statusText}`);
  }
  return response.json() as Promise<TabularResponse>;
}

// --- Construction du rapport ---

function buildReport(
  mutations: MutationAgg[],
  communeLabels: string[],
  typeLocalFilter?: string,
  annee?: number,
): string {
  const lines: string[] = [];
  const period = annee ? `${annee}` : `${new Date().getFullYear() - 2}\u2013${new Date().getFullYear()}`;

  lines.push(`\ud83d\udcca Transactions immobili\u00e8res \u2014 ${communeLabels.join(", ")}`);
  lines.push(`   P\u00e9riode : ${period} | Source : DVF (DGFiP) via data.gouv.fr`);
  lines.push("");

  const byType = groupBy(mutations, (m) => m.type);
  const types = Object.keys(byType).sort();

  if (!typeLocalFilter && types.length > 1) {
    lines.push("\u2500\u2500 R\u00e9partition par type \u2500\u2500");
    for (const type of types) {
      lines.push(`  ${type} : ${byType[type].length} transactions`);
    }
    lines.push("");
  }

  const typesToAnalyze = typeLocalFilter ? [typeLocalFilter] : types;
  for (const type of typesToAnalyze) {
    const items = byType[type] ?? [];
    if (!items.length) continue;

    const cleanItems = filterOutliers(items);
    const outlierCount = items.length - cleanItems.length;

    lines.push(`\u2500\u2500 ${type} (${cleanItems.length} transactions${outlierCount > 0 ? `, ${outlierCount} exclues` : ""}) \u2500\u2500`);

    const prices = cleanItems.map((m) => m.prix).sort((a, b) => a - b);
    lines.push(`  Prix de vente :`);
    lines.push(`    M\u00e9dian : ${formatEuro(median(prices))}`);
    lines.push(`    Fourchette : ${formatEuro(prices[0])} \u2013 ${formatEuro(prices[prices.length - 1])}`);

    const withSurface = cleanItems.filter((m) => m.surface > 0);
    if (withSurface.length >= 3) {
      const prixM2 = withSurface.map((m) => m.prix / m.surface).sort((a, b) => a - b);
      const q1 = prixM2[Math.floor(prixM2.length * 0.25)];
      const q3 = prixM2[Math.floor(prixM2.length * 0.75)];
      lines.push(`  Prix au m\u00b2 :`);
      lines.push(`    M\u00e9dian : ${formatEuro(median(prixM2))}/m\u00b2`);
      lines.push(`    Q1\u2013Q3 : ${formatEuro(q1)} \u2013 ${formatEuro(q3)}/m\u00b2`);

      const surfaces = withSurface.map((m) => m.surface).sort((a, b) => a - b);
      lines.push(`  Surface m\u00e9diane : ${median(surfaces).toFixed(0)} m\u00b2`);
    }

    if (["Appartement", "Maison"].includes(type)) {
      const byPieces = groupBy(
        cleanItems.filter((m) => m.pieces > 0),
        (m) => `${m.pieces} pi\u00e8ce${m.pieces > 1 ? "s" : ""}`,
      );
      const piecesKeys = Object.keys(byPieces).sort();
      if (piecesKeys.length > 1) {
        lines.push(`  Par nombre de pi\u00e8ces :`);
        for (const pk of piecesKeys) {
          const group = byPieces[pk];
          const pm2s = group.filter((m) => m.surface > 0).map((m) => m.prix / m.surface);
          const pm2Info = pm2s.length ? ` \u2014 ${formatEuro(median(pm2s.sort((a, b) => a - b)))}/m\u00b2` : "";
          lines.push(`    ${pk} : ${group.length} ventes${pm2Info}`);
        }
      }
    }

    lines.push("");
  }

  lines.push("\u26a0\ufe0f Donn\u00e9es DVF (DGFiP) \u2014 hors Alsace, Moselle et Mayotte.");
  lines.push("   Les prix incluent tous les lots de la mutation. Indicatif uniquement.");

  return lines.join("\n");
}

// --- Utilitaires ---

/** Filtre les outliers via IQR \u00d7 3 sur les prix */
function filterOutliers(items: MutationAgg[]): MutationAgg[] {
  if (items.length < 10) return items;
  const prices = items.map((m) => m.prix).sort((a, b) => a - b);
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 3 * iqr;
  const upper = q3 + 3 * iqr;
  return items.filter((m) => m.prix >= lower && m.prix <= upper);
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function formatEuro(value: number): string {
  return value.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}
