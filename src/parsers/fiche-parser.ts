import { XMLParser } from "fast-xml-parser";
import type { Fiche, ReferenceLegale, ServiceEnLigne } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (tagName) =>
    [
      "Paragraphe",
      "Reference",
      "ServiceEnLigne",
      "LienInterne",
      "LienExterne",
      "Chapitre",
      "SousChapitre",
      "Liste",
      "Element",
      "Item",
      "Cellule",
      "Rangee",
    ].includes(tagName),
});

/** Parse a single fiche XML string into a Fiche object */
export function parseFiche(xml: string, filename: string): Fiche | null {
  try {
    const doc = parser.parse(xml);
    const root = findRoot(doc);
    if (!root) return null;

    const id = filename.replace(".xml", "");
    const type = detectType(id);

    return {
      id,
      type,
      titre: extractText(root.dc?.title) || extractText(root.Publication?.["dc:title"]) || id,
      description: extractText(root.dc?.description) || extractText(root.Publication?.["dc:description"]) || null,
      sujet: extractText(root.dc?.subject) || extractText(root.Publication?.["dc:subject"]) || null,
      audience: extractAudience(root),
      url: buildUrl(id, type),
      theme_id: extractThemeId(root),
      theme_titre: extractThemeTitre(root),
      sous_theme: extractSousTheme(root),
      dossier_id: extractDossierId(root),
      dossier_titre: extractDossierTitre(root),
      contenu_texte: extractFullText(root),
      references_legales: JSON.stringify(extractReferences(root)),
      services_en_ligne: JSON.stringify(extractServices(root)),
      liens_internes: JSON.stringify(extractLiensInternes(root)),
      date_modification: extractDate(root),
    };
  } catch {
    return null;
  }
}

function findRoot(doc: Record<string, unknown>): Record<string, unknown> | null {
  const rootKeys = [
    "Publication",
    "ServiceEnLigne",
    "CommentFaireSi",
    "Noeud",
    "Ressource",
  ];
  for (const key of rootKeys) {
    if (doc[key]) return doc[key] as Record<string, unknown>;
  }
  for (const key of Object.keys(doc)) {
    if (key !== "?xml") return doc[key] as Record<string, unknown>;
  }
  return null;
}

function detectType(id: string): string {
  if (id.startsWith("F")) return "fiche";
  if (id.startsWith("R")) return "ressource";
  if (id.startsWith("N")) return "noeud";
  return "autre";
}

function buildUrl(id: string, _type: string): string {
  return `https://www.service-public.fr/particuliers/vosdroits/${id}`;
}

function extractText(node: unknown): string | null {
  if (!node) return null;
  if (typeof node === "string") return node;
  if (typeof node === "object" && node !== null) {
    const n = node as Record<string, unknown>;
    if ("#text" in n) return String(n["#text"]);
  }
  return null;
}

function extractAudience(root: Record<string, unknown>): string | null {
  const audience = root["@_audience"] || root["dc:audience"];
  return extractText(audience);
}

function extractThemeId(root: Record<string, unknown>): string | null {
  const fil = root["FilDAriane"] as Record<string, unknown> | undefined;
  if (!fil) return null;
  const niveau = fil["Niveau"] as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (!niveau) return null;
  const items = Array.isArray(niveau) ? niveau : [niveau];
  for (const n of items) {
    if (n["@_type"] === "Thème" || n["@_type"] === "Theme") {
      return extractText(n["@_ID"]) || null;
    }
  }
  return items[0] ? extractText(items[0]["@_ID"]) : null;
}

function extractThemeTitre(root: Record<string, unknown>): string | null {
  const fil = root["FilDAriane"] as Record<string, unknown> | undefined;
  if (!fil) return null;
  const niveau = fil["Niveau"] as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (!niveau) return null;
  const items = Array.isArray(niveau) ? niveau : [niveau];
  for (const n of items) {
    if (n["@_type"] === "Thème" || n["@_type"] === "Theme") {
      return extractText(n["#text"]) || extractText(n["Titre"]) || null;
    }
  }
  return null;
}

function extractSousTheme(root: Record<string, unknown>): string | null {
  const fil = root["FilDAriane"] as Record<string, unknown> | undefined;
  if (!fil) return null;
  const niveau = fil["Niveau"] as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (!niveau) return null;
  const items = Array.isArray(niveau) ? niveau : [niveau];
  for (const n of items) {
    if (n["@_type"] === "Sous-thème") {
      return extractText(n["#text"]) || extractText(n["Titre"]) || null;
    }
  }
  return null;
}

function extractDossierId(root: Record<string, unknown>): string | null {
  const fil = root["FilDAriane"] as Record<string, unknown> | undefined;
  if (!fil) return null;
  const niveau = fil["Niveau"] as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (!niveau) return null;
  const items = Array.isArray(niveau) ? niveau : [niveau];
  for (const n of items) {
    if (n["@_type"] === "Dossier") {
      return extractText(n["@_ID"]) || null;
    }
  }
  return null;
}

function extractDossierTitre(root: Record<string, unknown>): string | null {
  const fil = root["FilDAriane"] as Record<string, unknown> | undefined;
  if (!fil) return null;
  const niveau = fil["Niveau"] as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (!niveau) return null;
  const items = Array.isArray(niveau) ? niveau : [niveau];
  for (const n of items) {
    if (n["@_type"] === "Dossier") {
      return extractText(n["#text"]) || extractText(n["Titre"]) || null;
    }
  }
  return null;
}

/** Recursively extract all text from the XML tree */
function extractFullText(node: unknown, depth = 0): string {
  if (depth > 20) return "";
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) {
    return node.map((n) => extractFullText(n, depth + 1)).filter(Boolean).join(" ");
  }
  if (typeof node === "object" && node !== null) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@_")) continue;
      parts.push(extractFullText(value, depth + 1));
    }
    return parts.filter(Boolean).join(" ");
  }
  return "";
}

function extractReferences(root: Record<string, unknown>): ReferenceLegale[] {
  const refs: ReferenceLegale[] = [];
  collectNodes(root, "Reference", (node) => {
    refs.push({
      titre: extractText(node["Titre"]) || extractText(node["#text"]) || "",
      url: extractText(node["@_URL"]) || null,
      id_legifrance: extractText(node["@_ID"]) || null,
      numero_texte: extractText(node["@_numeroTexte"]) || null,
    });
  });
  return refs;
}

function extractServices(root: Record<string, unknown>): ServiceEnLigne[] {
  const services: ServiceEnLigne[] = [];
  collectNodes(root, "ServiceEnLigne", (node) => {
    services.push({
      id: extractText(node["@_ID"]) || "",
      titre: extractText(node["Titre"]) || extractText(node["#text"]) || "",
      type: extractText(node["@_type"]) || "",
      url: extractText(node["@_URL"]) || null,
    });
  });
  return services;
}

function extractLiensInternes(root: Record<string, unknown>): string[] {
  const liens: string[] = [];
  collectNodes(root, "LienInterne", (node) => {
    const id = extractText(node["@_LienPublication"]) || extractText(node["@_ID"]);
    if (id) liens.push(id);
  });
  return [...new Set(liens)];
}

function extractDate(root: Record<string, unknown>): string | null {
  return (
    extractText(root["dc:date"]) ||
    extractText(root["@_datePublication"]) ||
    extractText(root["@_dateDerniereModification"]) ||
    null
  );
}

/** Recursively collect all nodes matching a tag name */
function collectNodes(
  node: unknown,
  tagName: string,
  callback: (node: Record<string, unknown>) => void,
  depth = 0,
): void {
  if (depth > 20 || !node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectNodes(item, tagName, callback, depth + 1);
    return;
  }
  if (typeof node === "object" && node !== null) {
    const obj = node as Record<string, unknown>;
    if (tagName in obj) {
      const target = obj[tagName];
      const items = Array.isArray(target) ? target : [target];
      for (const item of items) {
        if (typeof item === "object" && item !== null) {
          callback(item as Record<string, unknown>);
        }
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key !== tagName && !key.startsWith("@_")) {
        collectNodes(value, tagName, callback, depth + 1);
      }
    }
  }
}
