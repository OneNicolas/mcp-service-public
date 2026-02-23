import type { Env, ToolResult } from "../types.js";

interface RechercherFicheArgs {
  query: string;
  theme?: string;
  audience?: string;
  limit?: number;
}

/** Search fiches pratiques using full-text search */
export async function rechercherFiche(
  args: RechercherFicheArgs,
  env: Env,
): Promise<ToolResult> {
  const { query, theme, audience, limit = 10 } = args;
  const maxLimit = Math.min(limit, 20);

  try {
    let sql = `
      SELECT f.id, f.titre, f.description, f.sujet, f.audience,
             f.theme_titre, f.dossier_titre, f.url,
             rank
      FROM fiches_fts
      JOIN fiches f ON fiches_fts.rowid = f.rowid
      WHERE fiches_fts MATCH ?
    `;
    const params: unknown[] = [query];

    if (theme) {
      sql += ` AND f.theme_titre LIKE ?`;
      params.push(`%${theme}%`);
    }
    if (audience) {
      sql += ` AND f.audience = ?`;
      params.push(audience);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(maxLimit);

    const results = await env.DB.prepare(sql).bind(...params).all();

    if (!results.results?.length) {
      return {
        content: [
          {
            type: "text",
            text: `Aucune fiche trouvée pour "${query}". Essayez des termes différents.`,
          },
        ],
      };
    }

    const formatted = results.results.map((r: Record<string, unknown>) => {
      const parts = [`## ${r.titre}`, `**ID** : ${r.id}`];
      if (r.description) parts.push(`${r.description}`);
      if (r.theme_titre) parts.push(`**Thème** : ${r.theme_titre}`);
      if (r.dossier_titre) parts.push(`**Dossier** : ${r.dossier_titre}`);
      if (r.url) parts.push(`**URL** : ${r.url}`);
      return parts.join("\n");
    });

    const text = [
      `**${results.results.length} fiche(s) trouvée(s) pour "${query}"**\n`,
      ...formatted,
    ].join("\n---\n");

    return { content: [{ type: "text", text }] };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Erreur lors de la recherche : ${error instanceof Error ? error.message : "inconnue"}`,
        },
      ],
      isError: true,
    };
  }
}
