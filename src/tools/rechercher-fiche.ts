import type { Env, ToolResult } from "../types.js";

interface RechercherFicheArgs {
  query: string;
  theme?: string;
  audience?: string;
  limit?: number;
}

/**
 * Nettoie une query pour FTS5 : supprime les operateurs speciaux
 * qui casseraient la requete SQLite.
 */
export function sanitizeFtsQuery(query: string): string {
  // 1. Supprimer les guillemets et parentheses (operateurs FTS5)
  let cleaned = query.replace(/["()]/g, "");

  // 2. Supprimer les operateurs booleens FTS5 (mots-cles entiers uniquement)
  cleaned = cleaned.replace(/\b(AND|OR|NOT|NEAR)\b/gi, "");

  // 3. Supprimer les * et - en debut de mot (prefixes FTS5)
  cleaned = cleaned.replace(/(^|\s)[*\-]+/g, "$1");

  // 4. Supprimer les * en fin de mot (suffixe FTS5)
  cleaned = cleaned.replace(/\*+(\s|$)/g, "$1");

  // 5. Supprimer les : (separateur de colonne FTS5)
  cleaned = cleaned.replace(/:/g, "");

  // 6. Normaliser les espaces multiples
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Si la query nettoyee est vide, retourner le premier mot alphanum non-operateur
  if (!cleaned) {
    const ftsOperators = /^(AND|OR|NOT|NEAR)$/i;
    const words = query.match(/[a-zA-Z\u00C0-\u017F]{2,}/g) ?? [];
    const firstReal = words.find((w) => !ftsOperators.test(w));
    return firstReal ?? "";
  }

  return cleaned;
}

/** Search fiches pratiques using full-text search with fallback */
export async function rechercherFiche(
  args: RechercherFicheArgs,
  env: Env,
): Promise<ToolResult> {
  const { query, theme, audience, limit = 10 } = args;
  const maxLimit = Math.min(limit, 20);
  const sanitized = sanitizeFtsQuery(query);

  if (!sanitized) {
    return {
      content: [
        {
          type: "text",
          text: `Aucun terme exploitable dans "${query}". Essayez des termes plus precis.`,
        },
      ],
    };
  }

  try {
    // --- Tentative FTS5 avec snippets ---
    let results = await ftsSearch(sanitized, theme, audience, maxLimit, env);

    // --- Fallback LIKE si FTS retourne 0 resultats ---
    if (!results.length) {
      results = await likeSearch(sanitized, theme, audience, maxLimit, env);
    }

    if (!results.length) {
      return {
        content: [
          {
            type: "text",
            text: `Aucune fiche trouvee pour "${query}". Essayez des termes differents.`,
          },
        ],
      };
    }

    const formatted = results.map((r: Record<string, unknown>) => {
      const parts = [`## ${r.titre}`, `**ID** : ${r.id}`];
      if (r.snippet) parts.push(`> ${r.snippet}`);
      else if (r.description) parts.push(`${r.description}`);
      if (r.theme_titre) parts.push(`**Theme** : ${r.theme_titre}`);
      if (r.dossier_titre) parts.push(`**Dossier** : ${r.dossier_titre}`);
      if (r.url) parts.push(`**URL** : ${r.url}`);
      return parts.join("\n");
    });

    const method = results[0]?.snippet ? "FTS" : "LIKE";
    const text = [
      `**${results.length} fiche(s) trouvee(s) pour "${query}"** _(${method})_\n`,
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

/** Recherche FTS5 avec snippet */
async function ftsSearch(
  sanitized: string,
  theme: string | undefined,
  audience: string | undefined,
  limit: number,
  env: Env,
): Promise<Record<string, unknown>[]> {
  let sql = `
    SELECT f.id, f.titre, f.description, f.sujet, f.audience,
           f.theme_titre, f.dossier_titre, f.url,
           snippet(fiches_fts, 5, '<b>', '</b>', '...', 30) as snippet,
           rank
    FROM fiches_fts
    JOIN fiches f ON fiches_fts.rowid = f.rowid
    WHERE fiches_fts MATCH ?
  `;
  const params: unknown[] = [sanitized];

  if (theme) {
    sql += ` AND f.theme_titre LIKE ?`;
    params.push(`%${theme}%`);
  }
  if (audience) {
    sql += ` AND f.audience = ?`;
    params.push(audience);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  try {
    const results = await env.DB.prepare(sql).bind(...params).all();
    return (results.results ?? []) as Record<string, unknown>[];
  } catch {
    // FTS peut echouer meme apres sanitization (ex: query trop courte)
    return [];
  }
}

/** Fallback LIKE quand FTS ne retourne rien */
async function likeSearch(
  sanitized: string,
  theme: string | undefined,
  audience: string | undefined,
  limit: number,
  env: Env,
): Promise<Record<string, unknown>[]> {
  const words = sanitized.split(" ").filter((w) => w.length >= 2);
  if (!words.length) return [];

  // Construire les conditions LIKE pour chaque mot
  const conditions = words.map(
    () => `(f.titre LIKE ? OR f.description LIKE ?)`,
  );

  let sql = `
    SELECT f.id, f.titre, f.description, f.sujet, f.audience,
           f.theme_titre, f.dossier_titre, f.url
    FROM fiches f
    WHERE ${conditions.join(" AND ")}
  `;
  const params: unknown[] = [];
  for (const word of words) {
    params.push(`%${word}%`, `%${word}%`);
  }

  if (theme) {
    sql += ` AND f.theme_titre LIKE ?`;
    params.push(`%${theme}%`);
  }
  if (audience) {
    sql += ` AND f.audience = ?`;
    params.push(audience);
  }

  sql += ` LIMIT ?`;
  params.push(limit);

  const results = await env.DB.prepare(sql).bind(...params).all();
  return (results.results ?? []) as Record<string, unknown>[];
}
