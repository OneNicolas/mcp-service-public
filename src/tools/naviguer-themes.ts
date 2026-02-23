import type { Env, ToolResult } from "../types.js";

interface NaviguerThemesArgs {
  theme_id?: string;
}

/** Navigate the theme hierarchy, optionally drilling into a specific theme */
export async function naviguerThemes(
  args: NaviguerThemesArgs,
  env: Env,
): Promise<ToolResult> {
  try {
    if (!args.theme_id) {
      // Return top-level themes
      const results = await env.DB.prepare(
        `SELECT id, titre, type FROM themes WHERE parent_id IS NULL ORDER BY titre`,
      ).all();

      if (!results.results?.length) {
        return {
          content: [{ type: "text", text: "Aucun thème trouvé. La base de données doit être synchronisée." }],
        };
      }

      const lines = results.results.map(
        (t: Record<string, unknown>) => `- **${t.titre}** (${t.id})`,
      );

      return {
        content: [
          {
            type: "text",
            text: `## Thèmes disponibles\n\n${lines.join("\n")}\n\nUtilisez un ID pour explorer les sous-thèmes.`,
          },
        ],
      };
    }

    // Get the requested theme and its children
    const theme = await env.DB.prepare(
      `SELECT id, titre, type, parent_id FROM themes WHERE id = ?`,
    )
      .bind(args.theme_id.toUpperCase())
      .first<Record<string, unknown>>();

    if (!theme) {
      return {
        content: [{ type: "text", text: `Thème "${args.theme_id}" introuvable.` }],
      };
    }

    const children = await env.DB.prepare(
      `SELECT id, titre, type FROM themes WHERE parent_id = ? ORDER BY titre`,
    )
      .bind(args.theme_id.toUpperCase())
      .all();

    // Get fiches in this theme/dossier
    const fiches = await env.DB.prepare(
      `SELECT id, titre FROM fiches
       WHERE theme_id = ? OR dossier_id = ?
       ORDER BY titre LIMIT 20`,
    )
      .bind(args.theme_id.toUpperCase(), args.theme_id.toUpperCase())
      .all();

    const sections: string[] = [`## ${theme.titre}`, `**Type** : ${theme.type} | **ID** : ${theme.id}`];

    if (children.results?.length) {
      sections.push("", "### Sous-catégories", "");
      for (const c of children.results) {
        sections.push(`- **${c.titre}** (${c.id})`);
      }
    }

    if (fiches.results?.length) {
      sections.push("", "### Fiches dans cette catégorie", "");
      for (const f of fiches.results) {
        sections.push(`- ${f.titre} (${f.id})`);
      }
    }

    return { content: [{ type: "text", text: sections.join("\n") }] };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Erreur : ${error instanceof Error ? error.message : "inconnue"}`,
        },
      ],
      isError: true,
    };
  }
}
