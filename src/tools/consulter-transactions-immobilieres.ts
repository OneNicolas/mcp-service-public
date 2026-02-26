import type { ToolResult } from "../types.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";

const DVF_RESOURCE_ID = "d7933994-2c66-4131-a4da-cf7cd18040a4";
const TABULAR_API = `https://tabular-api.data.gouv.fr/api/resources/${DVF_RESOURCE_ID}/data/`;
const MAX_PAGE_SIZE = 200;
const MAX_PAGES = 5; // 1000 records max

interface ConsulterTransactionsArgs {
  commune?: string;
  code_insee?: string;
  code_postal?: string;
  type_local?: string;
  annee?: number;
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

/** Consulte les transactions immobilières (DVF) via data.gouv.fr */
export async function consulterTransactionsImmobilieres(
  args: ConsulterTransactionsArgs,
): Promise<ToolResult> {
  const { commune, code_insee, code_postal, type_local, annee } = args;

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
        content: [{ type: "text", text: "Aucune commune trouvée pour les critères fournis." }],
        isError: true,
      };
    }

    // Période : 2 dernières années par défaut ou année spécifique
    const dateMin = annee
      ? `${annee}-01-01`
      : `${new Date().getFullYear() - 2}-01-01`;
    const dateMax = annee ? `${annee}-12-31` : undefined;

    const allMutations: MutationAgg[] = [];
    const communeLabels: string[] = [];

    for (const code of codeInseeList) {
      const { mutations, communeNom } = await fetchDvfForCommune(
        code,
        type_local,
        dateMin,
        dateMax,
      );
      allMutations.push(...mutations);
      communeLabels.push(`${communeNom} (${code})`);
    }

    if (!allMutations.length) {
      const typeNote = type_local ? ` de type "${type_local}"` : "";
      const periodNote = annee ? ` en ${annee}` : " sur les 2 dernières années";
      return {
        content: [{
          type: "text",
          text: `Aucune transaction${typeNote} trouvée${periodNote} pour ${communeLabels.join(", ")}.\n\n⚠️ Les données DVF excluent l'Alsace, la Moselle et Mayotte.`,
        }],
      };
    }

    const report = buildReport(allMutations, communeLabels, type_local, annee);
    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur DVF : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

// --- Résolution des codes INSEE ---

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

// --- Fetch DVF depuis l'API Tabular ---

async function fetchDvfForCommune(
  codeInsee: string,
  typeLocal?: string,
  dateMin?: string,
  dateMax?: string,
): Promise<{ mutations: MutationAgg[]; communeNom: string; totalInApi: number }> {
  const params = new URLSearchParams({
    page: "1",
    page_size: String(MAX_PAGE_SIZE),
    code_commune__exact: codeInsee,
    date_mutation__sort: "desc",
  });
  if (typeLocal) params.set("type_local__exact", typeLocal);
  if (dateMin) params.set("date_mutation__greater", dateMin);
  if (dateMax) params.set("date_mutation__less", dateMax);

  // Première page
  const firstPage = await fetchPage(params);
  const total = firstPage.meta?.total ?? 0;
  let allRecords = firstPage.data ?? [];
  const communeNom = allRecords[0]?.nom_commune ?? codeInsee;

  // Pages supplémentaires en parallèle
  const totalPages = Math.min(Math.ceil(total / MAX_PAGE_SIZE), MAX_PAGES);
  if (totalPages > 1) {
    const pagePromises: Promise<TabularResponse>[] = [];
    for (let p = 2; p <= totalPages; p++) {
      const nextParams = new URLSearchParams(params);
      nextParams.set("page", String(p));
      pagePromises.push(fetchPage(nextParams));
    }
    const results = await Promise.all(pagePromises);
    for (const r of results) {
      allRecords = allRecords.concat(r.data ?? []);
    }
  }

  // Déduplication par id_mutation : garder la ligne avec la plus grande surface
  const seen = new Map<string, MutationAgg>();
  for (const rec of allRecords) {
    const id = rec.id_mutation;
    if (!id || !rec.valeur_fonciere || !rec.type_local) continue;
    if (rec.type_local === "Dépendance" && !rec.surface_reelle_bati) continue;

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
    totalInApi: total,
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
  const period = annee ? `${annee}` : `${new Date().getFullYear() - 2}–${new Date().getFullYear()}`;

  lines.push(`📊 Transactions immobilières — ${communeLabels.join(", ")}`);
  lines.push(`   Période : ${period} | Source : DVF (DGFiP) via data.gouv.fr`);
  lines.push("");

  const byType = groupBy(mutations, (m) => m.type);
  const types = Object.keys(byType).sort();

  if (!typeLocalFilter && types.length > 1) {
    lines.push("── Répartition par type ──");
    for (const type of types) {
      lines.push(`  ${type} : ${byType[type].length} transactions`);
    }
    lines.push("");
  }

  const typesToAnalyze = typeLocalFilter ? [typeLocalFilter] : types;
  for (const type of typesToAnalyze) {
    const items = byType[type] ?? [];
    if (!items.length) continue;

    const withSurface = items.filter((m) => m.surface > 0);

    lines.push(`── ${type} (${items.length} transactions) ──`);

    const prices = items.map((m) => m.prix).sort((a, b) => a - b);
    lines.push(`  Prix de vente :`);
    lines.push(`    Médian : ${formatEuro(median(prices))}`);
    lines.push(`    Fourchette : ${formatEuro(prices[0])} – ${formatEuro(prices[prices.length - 1])}`);

    if (withSurface.length >= 3) {
      const prixM2 = withSurface.map((m) => m.prix / m.surface).sort((a, b) => a - b);
      const q1 = prixM2[Math.floor(prixM2.length * 0.25)];
      const q3 = prixM2[Math.floor(prixM2.length * 0.75)];
      lines.push(`  Prix au m² :`);
      lines.push(`    Médian : ${formatEuro(median(prixM2))}/m²`);
      lines.push(`    Q1–Q3 : ${formatEuro(q1)} – ${formatEuro(q3)}/m²`);

      const surfaces = withSurface.map((m) => m.surface).sort((a, b) => a - b);
      lines.push(`  Surface médiane : ${median(surfaces).toFixed(0)} m²`);
    }

    if (["Appartement", "Maison"].includes(type)) {
      const byPieces = groupBy(
        items.filter((m) => m.pieces > 0),
        (m) => `${m.pieces} pièce${m.pieces > 1 ? "s" : ""}`,
      );
      const piecesKeys = Object.keys(byPieces).sort();
      if (piecesKeys.length > 1) {
        lines.push(`  Par nombre de pièces :`);
        for (const pk of piecesKeys) {
          const group = byPieces[pk];
          const pm2s = group.filter((m) => m.surface > 0).map((m) => m.prix / m.surface);
          const pm2Info = pm2s.length ? ` — ${formatEuro(median(pm2s.sort((a, b) => a - b)))}/m²` : "";
          lines.push(`    ${pk} : ${group.length} ventes${pm2Info}`);
        }
      }
    }

    lines.push("");
  }

  lines.push("⚠️ Données DVF (DGFiP) — hors Alsace, Moselle et Mayotte.");
  lines.push("   Les prix incluent tous les lots de la mutation. Indicatif uniquement.");

  return lines.join("\n");
}

// --- Utilitaires ---

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
