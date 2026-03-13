/**
 * T26-T4 — consulter_prix_carburant
 * Prix des carburants en temps reel via data.economie.gouv.fr
 * Dataset : prix-des-carburants-en-france-flux-instantane-v2
 * Mise a jour toutes les 10 minutes par les stations
 */

import type { ToolResult } from "../types.js";
import { resolveNomCommune, resolveCodePostal } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const CARBURANT_API =
  "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";

// Noms normalises pour la correspondance user -> nom colonne API
const CARBURANT_MAP: Record<string, { col: string; label: string }> = {
  gazole:  { col: "gazole_prix",  label: "Gazole" },
  diesel:  { col: "gazole_prix",  label: "Gazole" },
  sp95:    { col: "sp95_prix",    label: "SP95" },
  sp98:    { col: "sp98_prix",    label: "SP98" },
  e10:     { col: "e10_prix",     label: "E10" },
  e85:     { col: "e85_prix",     label: "E85" },
  gplc:    { col: "gplc_prix",    label: "GPLc" },
  gpl:     { col: "gplc_prix",    label: "GPLc" },
  essence: { col: "sp95_prix",    label: "SP95" },
};

interface ConsulterPrixCarburantArgs {
  departement?: string;
  commune?: string;
  code_postal?: string;
  carburant?: string;
  limit?: number;
}

interface StationRecord {
  id: number;
  adresse: string;
  ville: string;
  cp: string;
  code_departement: string;
  gazole_prix: number | null;
  sp95_prix: number | null;
  sp98_prix: number | null;
  e10_prix: number | null;
  e85_prix: number | null;
  gplc_prix: number | null;
  gazole_maj: string | null;
  carburants_disponibles: string[] | null;
  horaires_automate_24_24: string | null;
}

/** Resout un nom ou numero de departement en code a 2-3 chiffres */
async function resolveDepartement(input: string): Promise<string | null> {
  const trimmed = input.trim();
  // Numero direct (ex: "69", "2A", "974")
  if (/^\d{1,3}[AB]?$/i.test(trimmed)) return trimmed.padStart(2, "0").toUpperCase();

  // Nom de departement -> geo.api.gouv.fr
  try {
    const response = await cachedFetch(
      `https://geo.api.gouv.fr/departements?nom=${encodeURIComponent(trimmed)}&fields=code&limit=1`,
      { ttl: CACHE_TTL.ANNUAIRE }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as Array<{ code: string }>;
    return data[0]?.code ?? null;
  } catch {
    return null;
  }
}

/** Resout une commune en { codeDept, villePattern } pour filtrer l'API */
async function resolveCommune(input: string): Promise<{ codeDept: string; villePattern: string } | null> {
  try {
    const resolved = await resolveNomCommune(input);
    if (!resolved?.code) return null;

    // Code dept = 2 premiers caracteres du code INSEE (sauf DOM: 97x)
    const codeDept = resolved.code.startsWith("97") ? resolved.code.slice(0, 3) : resolved.code.slice(0, 2);
    return { codeDept, villePattern: resolved.nom.toUpperCase() };
  } catch {
    return null;
  }
}

/** Resout un code postal en dept + ville */
async function resolveCodePostalCommune(cp: string): Promise<{ codeDept: string; villePattern: string } | null> {
  try {
    const communes = await resolveCodePostal(cp);
    if (!communes.length) return null;
    const first = communes[0];
    const codeDept = first.code.startsWith("97") ? first.code.slice(0, 3) : first.code.slice(0, 2);
    return { codeDept, villePattern: first.nom.toUpperCase() };
  } catch {
    return null;
  }
}

/** Construit et execute la requete API */
async function fetchStations(
  filters: string[],
  orderBy: string,
  limit: number
): Promise<StationRecord[]> {
  const select = [
    "id", "adresse", "ville", "cp", "code_departement",
    "gazole_prix", "sp95_prix", "sp98_prix", "e10_prix", "e85_prix", "gplc_prix",
    "gazole_maj", "carburants_disponibles", "horaires_automate_24_24",
  ].join(",");

  const params = new URLSearchParams({
    limit: String(Math.min(limit, 20)),
    select,
    order_by: orderBy,
  });

  if (filters.length > 0) {
    params.set("where", filters.join(" AND "));
  }

  const response = await cachedFetch(`${CARBURANT_API}?${params}`, { ttl: CACHE_TTL.DVF });
  if (!response.ok) throw new Error(`API carburant HTTP ${response.status}`);

  const data = (await response.json()) as { total_count: number; results: StationRecord[] };
  return data.results ?? [];
}

/** Formate la date MAJ de maniere lisible */
function formatMaj(isoDate: string | null): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Formate un prix */
function fmtPrix(val: number | null): string {
  if (val === null || val <= 0) return "\u2014";
  return `${val.toFixed(3)} \u20ac`;
}

/** Genere le rapport texte */
function buildReport(
  stations: StationRecord[],
  carburantLabel: string | null,
  location: string,
): string {
  if (stations.length === 0) {
    return `Aucune station trouvee pour ${location}${carburantLabel ? ` avec ${carburantLabel}` : ""}.`;
  }

  const lines: string[] = [];
  const titre = carburantLabel
    ? `\u26fd Prix ${carburantLabel} \u2014 ${location}`
    : `\u26fd Stations-service \u2014 ${location}`;

  lines.push(`**${titre}**`);
  lines.push(`_${stations.length} station(s) trouvee(s)_`);
  lines.push("");

  const headers = ["Station", "Gazole", "SP95", "SP98", "E10", "E85", "GPLc", "MAJ", "24/24"];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  for (const s of stations) {
    const adresse = `${s.adresse}, ${s.ville} (${s.cp})`.slice(0, 45);
    const maj = formatMaj(s.gazole_maj ?? null);
    const automate = s.horaires_automate_24_24 === "Oui" ? "\u2705" : "";

    lines.push(
      `| ${adresse} | ${fmtPrix(s.gazole_prix)} | ${fmtPrix(s.sp95_prix)} | ${fmtPrix(s.sp98_prix)} | ${fmtPrix(s.e10_prix)} | ${fmtPrix(s.e85_prix)} | ${fmtPrix(s.gplc_prix)} | ${maj} | ${automate} |`
    );
  }

  lines.push("");

  // Prix min et moyen si carburant specifie
  if (carburantLabel) {
    const colKey = Object.values(CARBURANT_MAP).find(v => v.label === carburantLabel)?.col as keyof StationRecord | undefined;
    if (colKey) {
      const prices = stations
        .map(s => s[colKey] as number | null)
        .filter((p): p is number => p !== null && p > 0);
      if (prices.length >= 2) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const min = Math.min(...prices);
        lines.push(`_${carburantLabel} : min ${min.toFixed(3)} \u20ac | moy ${avg.toFixed(3)} \u20ac sur ${prices.length} stations_`);
      }
    }
  }

  lines.push("");
  lines.push(`_Source : data.economie.gouv.fr \u2014 Prix carburants flux instantane. Mis a jour toutes les 10 min._`);
  return lines.join("\n");
}

export async function consulterPrixCarburant(args: ConsulterPrixCarburantArgs): Promise<ToolResult> {
  const limit = Math.min(args.limit ?? 10, 20);

  // Normaliser le carburant demande
  const carburantKey = args.carburant?.toLowerCase().trim();
  const carburantInfo = carburantKey ? CARBURANT_MAP[carburantKey] : null;
  const carburantLabel = carburantInfo?.label ?? null;

  // Tri : prix croissant du carburant selectionne, sinon gazole par defaut
  const sortCol = carburantInfo?.col ?? "gazole_prix";
  const orderBy = `${sortCol} asc`;

  // Filtres de base : exclure stations sans prix pour le carburant demande
  const filters: string[] = [];
  if (carburantInfo) {
    filters.push(`${carburantInfo.col} is not null`);
    filters.push(`${carburantInfo.col} > 0`);
  }

  let location = "France";

  try {
    // Priorite : code_postal > commune > departement
    if (args.code_postal) {
      const resolved = await resolveCodePostalCommune(args.code_postal);
      if (!resolved) {
        return {
          content: [{ type: "text", text: `Code postal "${args.code_postal}" introuvable.` }],
          isError: true,
        };
      }
      filters.push(`code_departement="${sanitize(resolved.codeDept)}"`);
      filters.push(`ville like "${sanitize(resolved.villePattern)}%"`);
      location = `${resolved.villePattern} (${args.code_postal})`;

    } else if (args.commune) {
      const resolved = await resolveCommune(args.commune);
      if (!resolved) {
        return {
          content: [{ type: "text", text: `Commune "${args.commune}" introuvable.` }],
          isError: true,
        };
      }
      filters.push(`code_departement="${sanitize(resolved.codeDept)}"`);
      filters.push(`ville like "${sanitize(resolved.villePattern)}%"`);
      location = args.commune;

    } else if (args.departement) {
      const codeDept = await resolveDepartement(args.departement);
      if (!codeDept) {
        return {
          content: [{ type: "text", text: `Departement "${args.departement}" introuvable.` }],
          isError: true,
        };
      }
      filters.push(`code_departement="${sanitize(codeDept)}"`);
      location = `departement ${args.departement}`;

    } else {
      return {
        content: [{
          type: "text",
          text: "Veuillez specifier un departement, une commune ou un code postal.",
        }],
        isError: true,
      };
    }

    const stations = await fetchStations(filters, orderBy, limit);
    const report = buildReport(stations, carburantLabel, location);
    return { content: [{ type: "text", text: report }] };

  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Erreur consulter_prix_carburant : ${error instanceof Error ? error.message : "inconnue"}`,
      }],
      isError: true,
    };
  }
}

function sanitize(s: string): string {
  return s.replace(/['"\\]/g, "");
}
