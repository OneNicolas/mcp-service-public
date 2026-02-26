import type { ToolResult } from "../types.js";

const API_BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";

interface ConsulterFiscaliteLocaleArgs {
  commune: string;
  code_insee?: string;
  exercice?: string;
  type?: "particuliers" | "entreprises";
}

/** Query local tax rates for a commune via data.economie.gouv.fr */
export async function consulterFiscaliteLocale(
  args: ConsulterFiscaliteLocaleArgs,
): Promise<ToolResult> {
  const { commune, code_insee, exercice, type = "particuliers" } = args;

  if (!commune && !code_insee) {
    return {
      content: [{ type: "text", text: "Veuillez fournir un nom de commune ou un code INSEE." }],
      isError: true,
    };
  }

  try {
    const dataset =
      type === "entreprises"
        ? "fiscalite-locale-des-entreprises"
        : "fiscalite-locale-des-particuliers";

    const whereClauses: string[] = [];

    if (code_insee) {
      whereClauses.push(`insee_com="${sanitize(code_insee)}"`);
    } else if (commune) {
      whereClauses.push(`libcom like "${sanitize(commune.toUpperCase())}"`);
    }

    // Default to latest year if not specified
    if (exercice) {
      whereClauses.push(`exercice="${sanitize(exercice)}"`);
    }

    const selectFields =
      type === "entreprises"
        ? "exercice,libcom,insee_com,libdep,libreg,q03,mpoid,taux_global_tfb,taux_global_tfnb,taux_plein_teom,taux_global_cfe_hz,taux_global_cfe_zae,taux_global_cfe_eol"
        : "exercice,libcom,insee_com,libdep,libreg,q03,mpoid,taux_global_tfb,taux_global_tfnb,taux_global_th,taux_plein_teom,ind_majothrs,thsurtaxrstau";

    const params = new URLSearchParams({
      limit: "10",
      select: selectFields,
      where: whereClauses.join(" AND "),
      order_by: "exercice DESC",
    });

    const url = `${API_BASE}/${dataset}/records?${params}`;
    const response = await fetch(url);

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
