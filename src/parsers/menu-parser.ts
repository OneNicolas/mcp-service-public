import { XMLParser } from "fast-xml-parser";
import type { Theme } from "../types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (tagName) => ["ItemMenu"].includes(tagName),
});

/**
 * Parse menu.xml from the DILA archive into a flat list of Theme nodes.
 * The XML uses: Menu > ItemMenu[type="Theme"] > ItemMenu[type="Sous-theme"] > ItemMenu[type="Dossier"]
 * We flatten it into a parent_id-based structure for D1.
 */
export function parseMenu(xml: string): Theme[] {
  const themes: Theme[] = [];

  try {
    const doc = parser.parse(xml);
    const root = doc["Menu"];
    if (!root) return themes;

    const items = ensureArray(root["ItemMenu"]);
    for (const item of items) {
      processNode(item, null, themes);
    }
  } catch (error) {
    console.error("menu-parser: failed to parse menu.xml", error);
  }

  return themes;
}

function processNode(
  node: Record<string, unknown>,
  parentId: string | null,
  out: Theme[],
): void {
  const id = extractAttr(node, "ID");
  if (!id) return;

  const rawType = extractAttr(node, "type") || "theme";
  const type = normalizeType(rawType);

  const titre =
    extractText(node["Titre"]) ||
    extractText(node["#text"]) ||
    id;

  out.push({ id, type, titre, parent_id: parentId });

  for (const child of ensureArray(node["ItemMenu"])) {
    processNode(child, id, out);
  }
}

function normalizeType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower === "theme") return "theme";
  if (lower.includes("sous-theme")) return "sous-theme";
  if (lower === "sous-dossier") return "sous-dossier";
  if (lower === "dossier") return "dossier";
  return raw;
}

function ensureArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return [value as Record<string, unknown>];
}

function extractAttr(node: Record<string, unknown>, attr: string): string | null {
  const val = node["@_" + attr];
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
