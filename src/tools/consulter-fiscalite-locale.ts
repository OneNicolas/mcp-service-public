import type { ToolResult } from "../types.js";
import { resolveCodePostal } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const API_BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";

interface ConsulterFiscaliteLocaleArgs {
  commune?: string;
  communes?: string[];
  code_insee?: string;
  code_postal?: string;
  exercice?: string;
  type?: "particuliers" | "entreprises";
}

/** Query local tax rates for a commune via data.economie.gouv.fr */
export async function consulterFiscaliteLocale(
  args: ConsulterFiscaliteLocaleArgs,
): Promise<ToolResult> {
  const { commune, communes, code_insee, code_postal, exercice, type = "particuliers" } = args;

  // Mode comparaison : tableau de communes
  if (communes?.length) {
    return comparerCommunes(communes, exercice, type);
  }

  if (!commune && !code_insee && !code_postal) {
    return {
      content: [{ type: "text", text: "Veuillez fournir un nom de commune, un code INSEE ou un code postal." }],
      isError: true,
    };
  }

  try {
    // Résolution code postal → codes INSEE
    let inseeToQuery: string[] = [];
    let cpLabel = "";

    if (code_postal) {
      const communesGeo = await resolveCodePostal(code_postal);
      inseeToQuery = communesGeo.map((c) => c.code);
      cpLabel = `Code postal ${code_postal} → ${communesGeo.map((c) => `${c.nom} (${c.code})`).join(", ")}`;
    }

    const dataset =
      type === "entreprises"
        ? "fiscalite-locale-des-entreprises"
        : "fiscalite-locale-des-particuliers";

    const selectFields =
      type === "entreprises"
        ? "exercice,libcom,insee_com,libdep,libreg,q03,mpoid,taux_global_tfb,taux_global_tfnb,taux_plein_teom,taux_global_cfe_hz,taux_global_cfe_zae,taux_global_cfe_eol"
        : "exercice,libcom,insee_com,libdep,libreg,q03,mpoid,taux_global_tfb,taux_global_tfnb,taux_global_th,taux_plein_teom,ind_majothrs,thsurtaxrstau";

    // Si code_postal avec plusieurs communes, requêter tous les INSEE en une seule requête
    if (inseeToQuery.length > 0) {
      return await queryMultipleCommunes(inseeToQuery, exercice, dataset, selectFields, type, cpLabel);
    }

    // Mode classique : une seule commune
    const whereClauses: string[] = [];
    if (code_insee) {
      whereClauses.push(`insee_com="${sanitize(code_insee)}"`);
    } else if (commune) {
      whereClauses.push(`libcom like "${sanitize(commune.toUpperCase())}"`);
    }

    if (exercice) {
      whereClauses.push(`exercice="${sanitize(exercice)}"`);
    }

    // Sans exercice : récupérer toutes les années pour la tendance
    const limit = exercice ? 10 : 20;

    const params = new URLSearchParams({
      limit: String(limit),
      select: selectFields,
      where: whereClauses.join(" AND "),
      order_by: "exercice DESC",
    });

    const url = `${API_BASE}/${dataset}/records?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.REI });

    if (!response.ok) {
      const body = await response.text();
      return {
        content: [{ type: "text", text: `Erreur API data.economie.gouv.fr : ${response.status} — ${body.slice(0, 200)}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as ApiResponse;

    if (!data.results?.length) {
      return {
        content: [{ type: "text", text: `Aucune donnée trouvée pour "${commune || code_insee}". Vérifiez l'orthographe ou le code INSEE.` }],
      };
    }

    // Mode tendance si pas d'exercice ET plusieurs années pour une même commune
    if (!exercice && hasMultipleYears(data.results)) {
      return {
        content: [{ type: "text", text: formatTendance(data.results, type, data.total_count) }],
      };
    }

    // Mode unitaire classique
    const formatted = data.results.map((r) =>
      type === "entreprises" ? formatEntreprises(r) : formatParticuliers(r),
    );

    return {
      content: [
        {
          type: "text",
          text: [
            `**Fiscalité locale — ${type}** (${data.total_count} résultat(s))\n`,
            ...formatted,
          ].join("\n---\n"),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

// --- T2 : Comparaison entre communes ---

/** Compare les taux de fiscalité locale de plusieurs communes côte à côte */
async function comparerCommunes(
  communes: string[],
  exercice: string | undefined,
  type: "particuliers" | "entreprises",
): Promise<ToolResult> {
  if (communes.length < 2) {
    return {
      content: [{ type: "text", text: "La comparaison nécessite au moins 2 communes." }],
      isError: true,
    };
  }

  if (communes.length > 5) {
    return {
      content: [{ type: "text", text: "Maximum 5 communes pour la comparaison." }],
      isError: true,
    };
  }

  const dataset =
    type === "entreprises"
      ? "fiscalite-locale-des-entreprises"
      : "fiscalite-locale-des-particuliers";

  const selectFields =
    type === "entreprises"
      ? "exercice,libcom,insee_com,libdep,q03,mpoid,taux_global_tfb,taux_global_tfnb,taux_plein_teom,taux_global_cfe_hz"
      : "exercice,libcom,insee_com,libdep,q03,mpoid,taux_global_tfb,taux_global_tfnb,taux_global_th,taux_plein_teom";

  // Année cible : la plus récente disponible ou celle spécifiée
  const targetYear = exercice || "2024";

  // Requête unique avec filtre OR sur les noms de communes
  const communeNames = communes.map((c) => sanitize(c.toUpperCase()));
  const likeFilter = communeNames.map((c) => `libcom like "${c}"`).join(" OR ");
  const where = `(${likeFilter}) AND exercice="${sanitize(targetYear)}"`;

  const params = new URLSearchParams({
    limit: String(communes.length * 2),
    select: selectFields,
    where,
    order_by: "libcom ASC",
  });

  try {
    const url = `${API_BASE}/${dataset}/records?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.REI });

    if (!response.ok) {
      const body = await response.text();
      return {
        content: [{ type: "text", text: `Erreur API : ${response.status} — ${body.slice(0, 200)}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as ApiResponse;

    if (!data.results?.length) {
      // Retry avec l'année précédente si 2024 ne donne rien
      if (targetYear === "2024" && !exercice) {
        return comparerCommunes(communes, "2023", type);
      }
      return {
        content: [{ type: "text", text: `Aucune donnée trouvée pour les communes demandées (exercice ${targetYear}).` }],
      };
    }

    // Dédupliquer : garder un seul résultat par commune
    const byCommune = new Map<string, Record<string, unknown>>();
    for (const r of data.results) {
      const key = String(r.libcom);
      if (!byCommune.has(key)) byCommune.set(key, r);
    }

    const results = Array.from(byCommune.values());

    // Vérifier les communes non trouvées
    const found = new Set(results.map((r) => String(r.libcom)));
    const notFound = communeNames.filter((c) => !found.has(c));

    const text = type === "entreprises"
      ? formatComparaisonEntreprises(results, targetYear, notFound)
      : formatComparaisonParticuliers(results, targetYear, notFound);

    return { content: [{ type: "text", text }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

function formatComparaisonParticuliers(
  results: Record<string, unknown>[],
  exercice: string,
  notFound: string[],
): string {
  const lines: string[] = [
    `**Comparaison fiscalité locale — Particuliers — ${exercice}**\n`,
  ];

  // En-tête du tableau
  const headers = ["Commune", "Dép.", "Interco.", "Pop.", "TFB %", "TFNB %", "TH %", "TEOM %"];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  for (const r of results) {
    const row = [
      `**${r.libcom}** (${r.insee_com})`,
      String(r.libdep || ""),
      truncate(String(r.q03 || "N/A"), 25),
      fmt(r.mpoid),
      fmt(r.taux_global_tfb),
      fmt(r.taux_global_tfnb),
      fmt(r.taux_global_th),
      fmt(r.taux_plein_teom),
    ];
    lines.push(`| ${row.join(" | ")} |`);
  }

  if (notFound.length > 0) {
    lines.push("", `⚠️ Communes non trouvées : ${notFound.join(", ")}`);
  }

  lines.push("", `_Source : DGFiP — REI ${exercice} via data.economie.gouv.fr_`);
  return lines.join("\n");
}

function formatComparaisonEntreprises(
  results: Record<string, unknown>[],
  exercice: string,
  notFound: string[],
): string {
  const lines: string[] = [
    `**Comparaison fiscalité locale — Entreprises — ${exercice}**\n`,
  ];

  const headers = ["Commune", "Dép.", "Interco.", "Pop.", "TFB %", "TFNB %", "TEOM %", "CFE HZ %"];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  for (const r of results) {
    const row = [
      `**${r.libcom}** (${r.insee_com})`,
      String(r.libdep || ""),
      truncate(String(r.q03 || "N/A"), 25),
      fmt(r.mpoid),
      fmt(r.taux_global_tfb),
      fmt(r.taux_global_tfnb),
      fmt(r.taux_plein_teom),
      fmt(r.taux_global_cfe_hz),
    ];
    lines.push(`| ${row.join(" | ")} |`);
  }

  if (notFound.length > 0) {
    lines.push("", `⚠️ Communes non trouvées : ${notFound.join(", ")}`);
  }

  lines.push("", `_Source : DGFiP — REI ${exercice} via data.economie.gouv.fr_`);
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// --- Existing: Query multiple communes by postal code ---

/** Requête plusieurs communes en parallèle (mode code postal) */
async function queryMultipleCommunes(
  inseeCodes: string[],
  exercice: string | undefined,
  dataset: string,
  selectFields: string,
  type: "particuliers" | "entreprises",
  cpLabel: string,
): Promise<ToolResult> {
  // Construire un filtre IN pour tous les codes INSEE
  const inseeFilter = inseeCodes.map((c) => `"${sanitize(c)}"`).join(", ");
  const whereClauses = [`insee_com IN (${inseeFilter})`];

  if (exercice) {
    whereClauses.push(`exercice="${sanitize(exercice)}"`);
  }

  const limit = exercice ? inseeCodes.length * 2 : inseeCodes.length * 5;

  const params = new URLSearchParams({
    limit: String(Math.min(limit, 100)),
    select: selectFields,
    where: whereClauses.join(" AND "),
    order_by: "libcom ASC, exercice DESC",
  });

  const url = `${API_BASE}/${dataset}/records?${params}`;
  const response = await cachedFetch(url, { ttl: CACHE_TTL.REI });

  if (!response.ok) {
    const body = await response.text();
    return {
      content: [{ type: "text", text: `Erreur API data.economie.gouv.fr : ${response.status} — ${body.slice(0, 200)}` }],
      isError: true,
    };
  }

  const data = (await response.json()) as ApiResponse;

  if (!data.results?.length) {
    return {
      content: [{ type: "text", text: `Aucune donnée fiscale trouvée pour les communes du code postal.` }],
    };
  }

  // Mode tendance si pas d'exercice
  if (!exercice && hasMultipleYears(data.results)) {
    return {
      content: [{ type: "text", text: `${cpLabel}\n\n${formatTendance(data.results, type, data.total_count)}` }],
    };
  }

  const formatted = data.results.map((r) =>
    type === "entreprises" ? formatEntreprises(r) : formatParticuliers(r),
  );

  return {
    content: [
      {
        type: "text",
        text: [
          `${cpLabel}\n\n**Fiscalité locale — ${type}** (${data.total_count} résultat(s))\n`,
          ...formatted,
        ].join("\n---\n"),
      },
    ],
  };
}

// --- Tendance formatting ---

function hasMultipleYears(results: Record<string, unknown>[]): boolean {
  const years = new Set(results.map((r) => String(r.exercice)));
  return years.size > 1;
}

/** Formate les résultats multi-années en tendance par commune */
function formatTendance(
  results: Record<string, unknown>[],
  type: "particuliers" | "entreprises",
  totalCount: number,
): string {
  // Grouper par commune (code INSEE)
  const byCommune = new Map<string, Record<string, unknown>[]>();
  for (const r of results) {
    const key = String(r.insee_com);
    if (!byCommune.has(key)) byCommune.set(key, []);
    byCommune.get(key)!.push(r);
  }

  const sections: string[] = [
    `**Évolution fiscalité locale — ${type}** (${totalCount} résultat(s))\n`,
  ];

  for (const [, records] of byCommune) {
    // Trier par année croissante
    const sorted = records.sort((a, b) => Number(a.exercice) - Number(b.exercice));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const header = [
      `## ${first.libcom} (${first.insee_com})`,
      `**Département** : ${first.libdep} | **Région** : ${first.libreg}`,
      `**Intercommunalité** : ${first.q03 || "N/A"}`,
      `**Période** : ${first.exercice} → ${last.exercice} (${sorted.length} exercice(s))`,
      "",
    ];

    const taxLines: string[] =
      type === "entreprises"
        ? formatTendanceEntreprises(sorted)
        : formatTendanceParticuliers(sorted);

    sections.push([...header, ...taxLines, "", `_Source : DGFiP — REI via data.economie.gouv.fr_`].join("\n"));
  }

  return sections.join("\n---\n");
}

function formatTendanceParticuliers(sorted: Record<string, unknown>[]): string[] {
  return [
    tendanceLine("Taux global TFB", sorted, "taux_global_tfb"),
    tendanceLine("Taux global TFNB", sorted, "taux_global_tfnb"),
    tendanceLine("Taux global TH (rés. secondaires)", sorted, "taux_global_th"),
    tendanceLine("Taux TEOM", sorted, "taux_plein_teom"),
  ];
}

function formatTendanceEntreprises(sorted: Record<string, unknown>[]): string[] {
  return [
    tendanceLine("Taux global TFB", sorted, "taux_global_tfb"),
    tendanceLine("Taux global TFNB", sorted, "taux_global_tfnb"),
    tendanceLine("Taux TEOM", sorted, "taux_plein_teom"),
    tendanceLine("Taux CFE hors zone", sorted, "taux_global_cfe_hz"),
  ];
}

/** Génère une ligne de tendance : "TFB : 45.3% → 49.0% (+8.2%)" */
function tendanceLine(
  label: string,
  sorted: Record<string, unknown>[],
  field: string,
): string {
  const values = sorted.map((r) => ({ year: String(r.exercice), val: r[field] }));
  const numValues = values.filter((v) => v.val !== null && v.val !== undefined);

  if (numValues.length === 0) return `**${label}** : N/A`;

  if (numValues.length === 1) {
    return `**${label}** : ${fmt(numValues[0].val)} % (${numValues[0].year})`;
  }

  const firstVal = Number(numValues[0].val);
  const lastVal = Number(numValues[numValues.length - 1].val);
  const variation = firstVal !== 0 ? ((lastVal - firstVal) / firstVal) * 100 : 0;
  const sign = variation >= 0 ? "+" : "";
  const arrow = numValues.map((v) => `${fmt(v.val)}%`).join(" → ");

  return `**${label}** : ${arrow} (${sign}${variation.toFixed(1)}%)`;
}

// --- Single-year formatting (inchangé) ---

function formatParticuliers(r: Record<string, unknown>): string {
  const sections: string[] = [
    `## ${r.libcom} (${r.insee_com}) — ${r.exercice}`,
    `**Département** : ${r.libdep} | **Région** : ${r.libreg}`,
    `**Intercommunalité** : ${r.q03 || "N/A"}`,
    `**Population** : ${r.mpoid ?? "N/A"}`,
    "",
    `**Taux global taxe foncière bâti (TFB)** : ${fmt(r.taux_global_tfb)} %`,
    `**Taux global taxe foncière non bâti (TFNB)** : ${fmt(r.taux_global_tfnb)} %`,
    `**Taux global taxe d'habitation (TH résidences secondaires)** : ${fmt(r.taux_global_th)} %`,
    `**Taux TEOM (ordures ménagères)** : ${fmt(r.taux_plein_teom)} %`,
  ];

  if (r.ind_majothrs === "OUI" && r.thsurtaxrstau) {
    sections.push(`**Majoration TH résidences secondaires** : ${r.thsurtaxrstau} %`);
  }

  sections.push(
    "",
    `_Source : DGFiP — REI ${r.exercice} via data.economie.gouv.fr_`,
  );

  return sections.join("\n");
}

function formatEntreprises(r: Record<string, unknown>): string {
  const sections: string[] = [
    `## ${r.libcom} (${r.insee_com}) — ${r.exercice}`,
    `**Département** : ${r.libdep} | **Région** : ${r.libreg}`,
    `**Intercommunalité** : ${r.q03 || "N/A"}`,
    `**Population** : ${r.mpoid ?? "N/A"}`,
    "",
    `**Taux global TFB** : ${fmt(r.taux_global_tfb)} %`,
    `**Taux global TFNB** : ${fmt(r.taux_global_tfnb)} %`,
    `**Taux TEOM** : ${fmt(r.taux_plein_teom)} %`,
    `**Taux CFE hors zone** : ${fmt(r.taux_global_cfe_hz)} %`,
  ];

  if (r.taux_global_cfe_zae !== null && r.taux_global_cfe_zae !== undefined) {
    sections.push(`**Taux CFE zone activité** : ${fmt(r.taux_global_cfe_zae)} %`);
  }
  if (r.taux_global_cfe_eol !== null && r.taux_global_cfe_eol !== undefined) {
    sections.push(`**Taux CFE éolien** : ${fmt(r.taux_global_cfe_eol)} %`);
  }

  sections.push(
    "",
    `_Source : DGFiP — REI ${r.exercice} via data.economie.gouv.fr_`,
  );

  return sections.join("\n");
}

function fmt(val: unknown): string {
  if (val === null || val === undefined) return "N/A";
  return String(val);
}

function sanitize(input: string): string {
  return input.replace(/['"\\\n\r]/g, "");
}

interface ApiResponse {
  total_count: number;
  results: Record<string, unknown>[];
}
