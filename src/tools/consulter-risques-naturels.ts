/**
 * T54 — consulter_risques_naturels
 * Risques naturels et technologiques via API Georisques v1 (GASPAR)
 * Source : Georisques (BRGM/MTE) — georisques.gouv.fr
 */

import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { resolveCodePostal, resolveNomCommune, resolveCodeInsee } from "../utils/geo-api.js";

const GEORISQUES_API = "https://georisques.gouv.fr/api/v1";

interface RisquesArgs {
  commune?: string;
  code_postal?: string;
  code_insee?: string;
}

interface RisqueDetail {
  num_risque: string;
  libelle_risque_long: string;
}

interface RisquesDataItem {
  code_insee: string;
  libelle_commune: string;
  risques_detail: RisqueDetail[];
}

interface RisquesResponse {
  data: RisquesDataItem[];
}

interface CatNatItem {
  code_insee: string;
  libelle_commune: string;
  dat_deb: string;
  dat_fin: string;
  dat_pub_arrete: string;
  lib_risque_jo: string;
}

interface CatNatResponse {
  data: CatNatItem[];
}

/** Resout les arguments en code INSEE */
export async function resolveToCodeInsee(args: RisquesArgs): Promise<{ codeInsee: string; nomCommune: string }> {
  if (args.code_insee) {
    const geo = await resolveCodeInsee(args.code_insee);
    return {
      codeInsee: args.code_insee.trim(),
      nomCommune: geo?.nom ?? args.code_insee,
    };
  }

  if (args.code_postal) {
    const communes = await resolveCodePostal(args.code_postal);
    if (communes.length > 0) {
      return { codeInsee: communes[0].code, nomCommune: communes[0].nom };
    }
    throw new Error(`Aucune commune trouvee pour le code postal ${args.code_postal}.`);
  }

  if (args.commune) {
    const resolved = await resolveNomCommune(args.commune);
    if (resolved) {
      return { codeInsee: resolved.code, nomCommune: resolved.nom };
    }
    throw new Error(`Commune non trouvee : "${args.commune}".`);
  }

  throw new Error("Veuillez preciser un code INSEE, une commune ou un code postal.");
}

/** Recupere les risques identifies pour une commune */
export async function fetchRisques(codeInsee: string): Promise<RisquesDataItem[]> {
  const url = `${GEORISQUES_API}/gaspar/risques?code_insee=${encodeURIComponent(codeInsee)}`;
  const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE });

  if (!response.ok) {
    throw new Error(`Erreur API Georisques (risques) : HTTP ${response.status}`);
  }

  const json = (await response.json()) as RisquesResponse;
  return json.data ?? [];
}

/** Recupere les arretes CatNat pour une commune */
export async function fetchCatNat(codeInsee: string): Promise<CatNatItem[]> {
  const url = `${GEORISQUES_API}/gaspar/catnat?code_insee=${encodeURIComponent(codeInsee)}&page_size=100`;
  const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE });

  if (!response.ok) {
    throw new Error(`Erreur API Georisques (catnat) : HTTP ${response.status}`);
  }

  const json = (await response.json()) as CatNatResponse;
  return json.data ?? [];
}

/** Formate le rapport de risques naturels */
export function formatRisquesReport(
  nomCommune: string,
  codeInsee: string,
  risquesItems: RisquesDataItem[],
  catnatItems: CatNatItem[],
): string {
  const lines: string[] = [];
  lines.push(`\u26A0\uFE0F **Risques naturels et technologiques — ${nomCommune}** (INSEE ${codeInsee})`);
  lines.push("");

  // Extraire les risques uniques
  const risquesSet = new Map<string, string>();
  for (const item of risquesItems) {
    for (const detail of item.risques_detail ?? []) {
      if (detail.num_risque && detail.libelle_risque_long) {
        risquesSet.set(detail.num_risque, detail.libelle_risque_long);
      }
    }
  }

  // Liste des risques
  if (risquesSet.size > 0) {
    lines.push(`**${risquesSet.size} risque(s) identifie(s) :**`);
    lines.push("");
    for (const [_num, libelle] of risquesSet) {
      lines.push(`- ${libelle}`);
    }
  } else {
    lines.push("Aucun risque naturel ou technologique recense pour cette commune.");
  }
  lines.push("");

  // Arretes CatNat
  if (catnatItems.length > 0) {
    lines.push(`**Arretes de catastrophe naturelle : ${catnatItems.length} au total**`);
    lines.push("");

    // 5 derniers par date de publication
    const sorted = [...catnatItems].sort((a, b) => {
      const dateA = a.dat_pub_arrete ?? "";
      const dateB = b.dat_pub_arrete ?? "";
      return dateB.localeCompare(dateA);
    });

    const recent = sorted.slice(0, 5);
    lines.push("| Type | Debut | Fin | Publication |");
    lines.push("| --- | --- | --- | --- |");

    for (const cat of recent) {
      const type = cat.lib_risque_jo ?? "N/A";
      const debut = formatDate(cat.dat_deb);
      const fin = formatDate(cat.dat_fin);
      const pub = formatDate(cat.dat_pub_arrete);
      lines.push(`| ${type} | ${debut} | ${fin} | ${pub} |`);
    }

    if (catnatItems.length > 5) {
      lines.push("");
      lines.push(`_... et ${catnatItems.length - 5} arrete(s) plus ancien(s)_`);
    }
  } else {
    lines.push("**Aucun arrete de catastrophe naturelle recense.**");
  }

  lines.push("");
  lines.push("_Source : Georisques (BRGM/MTE) — georisques.gouv.fr_");

  return lines.join("\n");
}

/** Formate une date ISO en format lisible */
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "N/A";
  // Georisques retourne "YYYY-MM-DD" ou "DD/MM/YYYY"
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const [y, m, d] = dateStr.split("T")[0].split("-");
    return `${d}/${m}/${y}`;
  }
  return dateStr;
}

/** Point d'entree principal */
export async function consulterRisquesNaturels(args: RisquesArgs): Promise<ToolResult> {
  try {
    const { codeInsee, nomCommune } = await resolveToCodeInsee(args);

    const [risquesResult, catnatResult] = await Promise.allSettled([
      fetchRisques(codeInsee),
      fetchCatNat(codeInsee),
    ]);

    const risques = risquesResult.status === "fulfilled" ? risquesResult.value : [];
    const catnat = catnatResult.status === "fulfilled" ? catnatResult.value : [];

    const report = formatRisquesReport(nomCommune, codeInsee, risques, catnat);
    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur consulter_risques_naturels : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}
