import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

/**
 * Recherche de conventions collectives via l'API Tabular de data.gouv.fr
 * Source : KALI (DILA) — dataset 53ba5033a3a729219b7bead9
 * Resource : 02b67492-5243-44e8-8dd1-0cb3f90f35ff
 */

const RESOURCE_ID = "02b67492-5243-44e8-8dd1-0cb3f90f35ff";
const TABULAR_BASE = "https://tabular-api.data.gouv.fr/api/resources";

// Colonnes du XLSX KALI (headers decales)
const COL = {
  ID_KALI: "Unnamed: 1",
  TYPE: "Convention ou texte ind\u00e9pendant", // IDCC ou TI
  IDCC: "Unnamed: 3",
  TITRE: "Unnamed: 4",
  NATURE: "Unnamed: 5",
  ETAT: "Unnamed: 6",
  DEBUT: "Unnamed: 7",
  FIN: "Unnamed: 8",
  URL: "Unnamed: 9",
} as const;

interface RechercherConventionArgs {
  query?: string;
  idcc?: string;
  limit?: number;
}

interface ConventionRecord {
  [key: string]: unknown;
}

/** Recherche de conventions collectives par IDCC ou mot-cle */
export async function rechercherConventionCollective(
  args: RechercherConventionArgs,
): Promise<ToolResult> {
  const { query, idcc, limit = 10 } = args;
  const maxLimit = Math.min(limit, 20);

  if (!query && !idcc) {
    return {
      content: [{ type: "text", text: "Veuillez fournir un mot-cle (`query`) ou un numero IDCC (`idcc`)." }],
      isError: true,
    };
  }

  try {
    let records: ConventionRecord[] = [];

    if (idcc) {
      // Recherche exacte par IDCC
      records = await queryTabular(COL.IDCC, "exact", idcc.trim(), maxLimit);
    }

    if (!records.length && query) {
      // Recherche par mot-cle dans le titre
      records = await queryTabular(COL.TITRE, "contains", query.trim(), maxLimit);
    }

    // Filtrer les lignes vides et les headers
    records = records.filter((r) => r[COL.TITRE] && String(r[COL.TITRE]).length > 5);

    if (!records.length) {
      const searched = idcc ? `IDCC ${idcc}` : `"${query}"`;
      return {
        content: [{
          type: "text",
          text: `Aucune convention collective trouvee pour ${searched}. Verifiez l'IDCC ou essayez d'autres mots-cles.`,
        }],
      };
    }

    // Trier : conventions en vigueur d'abord, puis par IDCC
    records.sort((a, b) => {
      const etatA = String(a[COL.ETAT] ?? "");
      const etatB = String(b[COL.ETAT] ?? "");
      if (etatA.includes("VIGUEUR") && !etatB.includes("VIGUEUR")) return -1;
      if (!etatA.includes("VIGUEUR") && etatB.includes("VIGUEUR")) return 1;
      return 0;
    });

    const formatted = records.map((r) => {
      const idccVal = r[COL.IDCC] ? `IDCC ${r[COL.IDCC]}` : "Texte independant";
      const etat = formatEtat(String(r[COL.ETAT] ?? ""));
      const nature = String(r[COL.NATURE] ?? "").toLowerCase();
      const debut = formatDate(String(r[COL.DEBUT] ?? ""));
      const url = String(r[COL.URL] ?? "");

      const parts = [
        `## ${r[COL.TITRE]}`,
        `- **${idccVal}** | ${nature}`,
        `- **Etat** : ${etat}`,
      ];
      if (debut) parts.push(`- **Debut** : ${debut}`);
      if (r[COL.FIN]) parts.push(`- **Fin** : ${formatDate(String(r[COL.FIN]))}`);
      if (url) parts.push(`- **Legifrance** : ${url}`);
      return parts.join("\n");
    });

    const searched = idcc ? `IDCC ${idcc}` : `"${query}"`;
    const text = [
      `**${records.length} convention(s) trouvee(s) pour ${searched}**\n`,
      ...formatted,
      "",
      "---",
      "*Source : KALI (DILA) via data.gouv.fr*",
    ].join("\n---\n");

    return { content: [{ type: "text", text }] };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Erreur lors de la recherche : ${error instanceof Error ? error.message : "inconnue"} (source: data.gouv.fr KALI)`,
      }],
      isError: true,
    };
  }
}

/** Interroge l'API Tabular data.gouv.fr */
async function queryTabular(
  column: string,
  operator: string,
  value: string,
  limit: number,
): Promise<ConventionRecord[]> {
  const params = new URLSearchParams({
    [`${column}__${operator}`]: value,
    page_size: String(limit),
  });

  const url = `${TABULAR_BASE}/${RESOURCE_ID}/data/?${params.toString()}`;
  const response = await cachedFetch(url, { ttl: CACHE_TTL.BOFIP });

  if (!response.ok) {
    throw new Error(`API Tabular : ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: ConventionRecord[] };
  return json.data ?? [];
}

/** Formate l'etat d'une convention */
function formatEtat(etat: string): string {
  const map: Record<string, string> = {
    VIGUEUR_ETEN: "En vigueur etendue",
    VIGUEUR_NON_ETEN: "En vigueur non etendue",
    ABROGE: "Abrogee",
    DENONCE: "Denoncee",
    REMPLACE: "Remplacee",
    PERIME: "Perimee",
  };
  return map[etat] ?? etat;
}

/** Formate une date ISO en JJ/MM/AAAA */
function formatDate(raw: string): string {
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return raw;
}
