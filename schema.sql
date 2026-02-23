-- Fiches pratiques from DILA (service-public.fr)
CREATE TABLE IF NOT EXISTS fiches (
  id TEXT PRIMARY KEY,          -- F14929, R42946, N360...
  type TEXT NOT NULL,            -- fiche, ressource, noeud
  titre TEXT NOT NULL,
  description TEXT,
  sujet TEXT,                    -- dc:subject (Papiers, Famille...)
  audience TEXT,                 -- Particuliers, Professionnels
  url TEXT,                      -- URL service-public.gouv.fr
  theme_id TEXT,
  theme_titre TEXT,
  sous_theme TEXT,
  dossier_id TEXT,
  dossier_titre TEXT,
  contenu_texte TEXT,            -- Full text content (stripped XML)
  references_legales TEXT,       -- JSON array of legal references
  services_en_ligne TEXT,        -- JSON array of online services
  liens_internes TEXT,           -- JSON array of internal links
  date_modification TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS fiches_fts USING fts5(
  id,
  titre,
  description,
  contenu_texte,
  content='fiches',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS fiches_ai AFTER INSERT ON fiches BEGIN
  INSERT INTO fiches_fts(rowid, id, titre, description, contenu_texte)
  VALUES (new.rowid, new.id, new.titre, new.description, new.contenu_texte);
END;

CREATE TRIGGER IF NOT EXISTS fiches_ad AFTER DELETE ON fiches BEGIN
  INSERT INTO fiches_fts(fiches_fts, rowid, id, titre, description, contenu_texte)
  VALUES ('delete', old.rowid, old.id, old.titre, old.description, old.contenu_texte);
END;

CREATE TRIGGER IF NOT EXISTS fiches_au AFTER UPDATE ON fiches BEGIN
  INSERT INTO fiches_fts(fiches_fts, rowid, id, titre, description, contenu_texte)
  VALUES ('delete', old.rowid, old.id, old.titre, old.description, old.contenu_texte);
  INSERT INTO fiches_fts(rowid, id, titre, description, contenu_texte)
  VALUES (new.rowid, new.id, new.titre, new.description, new.contenu_texte);
END;

-- Themes hierarchy (parsed from menu.xml)
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,             -- theme, sous-theme, dossier
  titre TEXT NOT NULL,
  parent_id TEXT,
  FOREIGN KEY (parent_id) REFERENCES themes(id)
);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  fiches_count INTEGER,
  status TEXT DEFAULT 'running'
);
