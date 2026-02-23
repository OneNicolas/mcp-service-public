/** Cloudflare Workers environment bindings */
export interface Env {
  DB: D1Database;
  MCP_OBJECT: DurableObjectNamespace;
}

/** Fiche pratique stored in D1 */
export interface Fiche {
  id: string;
  type: string;
  titre: string;
  description: string | null;
  sujet: string | null;
  audience: string | null;
  url: string | null;
  theme_id: string | null;
  theme_titre: string | null;
  sous_theme: string | null;
  dossier_id: string | null;
  dossier_titre: string | null;
  contenu_texte: string | null;
  references_legales: string | null;
  services_en_ligne: string | null;
  liens_internes: string | null;
  date_modification: string | null;
}

/** Parsed legal reference from XML */
export interface ReferenceLegale {
  titre: string;
  url: string | null;
  id_legifrance: string | null;
  numero_texte: string | null;
}

/** Parsed online service from XML */
export interface ServiceEnLigne {
  id: string;
  titre: string;
  type: string;
  url: string | null;
}

/** Theme hierarchy node */
export interface Theme {
  id: string;
  type: string;
  titre: string;
  parent_id: string | null;
  children?: Theme[];
}

/** API Annuaire - Organisation result */
export interface OrganismeAnnuaire {
  id: string;
  nom: string;
  type_organisme: string;
  adresse: string | null;
  code_postal: string | null;
  commune: string | null;
  telephone: string | null;
  email: string | null;
  url: string | null;
  horaires: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Tool result wrapper */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
