import type { Fiche, Theme } from "../types.js";

/** Max statements per D1 batch() call */
const D1_BATCH_LIMIT = 100;

const UPSERT_FICHE_SQL = `
  INSERT OR REPLACE INTO fiches
  (id, type, titre, description, sujet, audience, url, theme_id, theme_titre,
   sous_theme, dossier_id, dossier_titre, contenu_texte, references_legales,
   services_en_ligne, liens_internes, date_modification, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`;

const UPSERT_THEME_SQL = `
  INSERT OR REPLACE INTO themes (id, type, titre, parent_id)
  VALUES (?, ?, ?, ?)
`;

/** Upsert a batch of fiches (must be ≤ D1_BATCH_LIMIT) */
export async function batchUpsertFiches(
  db: D1Database,
  fiches: Fiche[],
): Promise<void> {
  if (fiches.length === 0) return;

  const statements = fiches.map((f) =>
    db.prepare(UPSERT_FICHE_SQL).bind(
      f.id,
      f.type,
      f.titre,
      f.description,
      f.sujet,
      f.audience,
      f.url,
      f.theme_id,
      f.theme_titre,
      f.sous_theme,
      f.dossier_id,
      f.dossier_titre,
      f.contenu_texte,
      f.references_legales,
      f.services_en_ligne,
      f.liens_internes,
      f.date_modification,
    ),
  );

  // Split into sub-batches if needed
  for (let i = 0; i < statements.length; i += D1_BATCH_LIMIT) {
    await db.batch(statements.slice(i, i + D1_BATCH_LIMIT));
  }
}

/** Upsert all themes, auto-chunked to respect D1 batch limit */
export async function batchUpsertThemes(
  db: D1Database,
  themes: Theme[],
): Promise<void> {
  if (themes.length === 0) return;

  for (let i = 0; i < themes.length; i += D1_BATCH_LIMIT) {
    const batch = themes.slice(i, i + D1_BATCH_LIMIT);
    const statements = batch.map((t) =>
      db.prepare(UPSERT_THEME_SQL).bind(t.id, t.type, t.titre, t.parent_id),
    );
    await db.batch(statements);
  }
}
