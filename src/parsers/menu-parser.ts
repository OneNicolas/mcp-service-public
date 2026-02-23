import { XMLParser } from "fast-xml-parser";
import type { Theme } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (tagName) =>
    ["Theme", "SousTheme", "Dossier", "SousDossier", "Fiche"].includes(tagName),
});

/**
 * Parse menu.xml from the DILA archive into a flat list of Theme nodes.
 * The XML has a nested hierarchy: Arborescence > Theme > SousTheme > Dossier > SousDossier
 * We flatten it into a parent_id-based structure for D1.
 */
export function parseMenu(xml: string): Theme[] {
  const themes: Theme[] = [];

  try {
    const doc = parser.parse(xml);
    const root =
      doc["Arborescence"] ||
      doc["Publication"] ||
      doc["Menu"] ||
      doc;

    // Top-level themes
    const topThemes = ensureArray(root["Theme"]);
    for (const theme of topThemes) {
      processNode(theme, "theme", null, themes);
    }
  } catch (error) {
    console.error("menu-parser: failed to parse menu.xml", error);
  }

  return themes;
}

function processNode(
  node: Record<string, unknown>,
  type: string,
  parentId: string | null,
  out: Theme[],
): void {
  const id = extractAttr(node, "ID");
  if (!id) return;

  const titre =
    extractText(node["Titre"]) ||
    extractText(node["#text"]) ||
    id;

  out.push({ id, type, titre, parent_id: parentId });

  // Recurse into children
  for (const sousTheme of ensureArray(node["SousTheme"])) {
    processNode(sousTheme, "sous-theme", id, out);
  }
  for (const dossier of ensureArray(node["Dossier"])) {
    processNode(dossier, "dossier", id, out);
  }
  for (const sousDossier of ensureArray(node["SousDossier"])) {
    processNode(sousDossier, "sous-dossier", id, out);
  }
}

function ensureArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return [value as Record<string, unknown>];
}

function extractAttr(node: Record<string, unknown>, attr: string): string | null {
  const val = node[`@_${attr}`];
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  return null;
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
