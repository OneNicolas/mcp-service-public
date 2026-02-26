import type { ToolResult } from "../types.js";

const API_BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";
const DATASET_ID = "bofip-vigueur";

interface RechercherDoctrineFiscaleArgs {
  query: string;
  serie?: string;
  limit?: number;
}

/** Search BOFiP (Bulletin Officiel des Finances Publiques) doctrine via data.economie.gouv.fr */
export async function rechercherDoctrineFiscale(
  args: RechercherDoctrineFiscaleArgs,
): Promise<ToolResult> {
  const { query, serie, limit = 5 } = args;
  const maxLimit = Math.min(limit, 10);

  if (!query) {
    return {
      content: [{ type: "text", text: "Veuillez fournir des termes de recherche." }],
      isError: true,
    };
  }

  try {
    const whereClauses: string[] = [];

    // Split query into individual terms for reliable accent-insensitive search
    // Single search() call fails with accented multi-word queries
    const terms = sanitize(query).split(/\s+/).filter((t) => t.length >= 2);
    if (terms.length === 0) {
      return {
        content: [{ type: "text", text: "Termes de recherche trop courts." }],
        isError: true,
      };
    }
    const titleSearch = terms.map((t) => `search(titre, "${t}")`).join(" AND ");
    const contentSearch = terms.map((t) => `search(contenu, "${t}")`).join(" AND ");
    whereClauses.push(`(${titleSearch}) OR (${contentSearch})`);

    if (serie) {
      whereClauses.push(`serie = "${sanitize(serie.toUpperCase())}"`);
    }

    const params = new URLSearchParams({
      limit: String(maxLimit),
      select: "titre,serie,division,identifiant_juridique,permalien,debut_de_validite,contenu",
      where: whereClauses.join(" AND "),
    });

    const url = `${API_BASE}/${DATASET_ID}/records?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      return {
        content: [{ type: "text", text: `Erreur API BOFiP : ${response.status} — ${body.slice(0, 200)}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as ApiResponse;

    if (!data.results?.length) {
      return {
        content: [{ type: "text", text: `Aucune doctrine trouvée pour "${query}". Essayez d'autres termes.` }],
      };
    }

    const formatted = data.results.map((r) => formatDoctrine(r));

    return {
      content: [
        {
          type: "text",
          text: [
            `**Doctrine fiscale BOFiP** — ${data.total_count} résultat(s) pour "${query}" (${data.results.length} affichés)\n`,
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

function formatDoctrine(r: Record<string, unknown>): string {
  const contenu = typeof r.contenu === "string" ? r.contenu : "";
  // Truncate content to keep response manageable
  const extrait = contenu.length > 1500 ? contenu.slice(0, 1500) + "…" : contenu;

  const sections: string[] = [
    `## ${r.titre || "Sans titre"}`,
    `**Référence** : ${r.identifiant_juridique || "N/A"}`,
    `**Série** : ${r.serie || "N/A"} | **Division** : ${r.division || "N/A"}`,
    `**En vigueur depuis** : ${r.debut_de_validite || "N/A"}`,
  ];

  if (r.permalien) {
    sections.push(`**Lien officiel** : ${r.permalien}`);
  }

  if (extrait) {
    sections.push("", `**Extrait** :\n${extrait}`);
  }

  return sections.join("\n");
}

function sanitize(input: string): string {
  return input.replace(/['"\\\n\r]/g, "");
}

interface ApiResponse {
  total_count: number;
  results: Record<string, unknown>[];
}
