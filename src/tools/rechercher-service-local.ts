import type { ToolResult } from "../types.js";

const ANNUAIRE_BASE = "https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1";
const DATASET_ID = "api-lannuaire-administration";

interface RechercherServiceLocalArgs {
  type_organisme?: string;
  code_postal?: string;
  commune?: string;
  code_insee?: string;
  query?: string;
  limit?: number;
}

/** Search local public services via API Annuaire */
export async function rechercherServiceLocal(
  args: RechercherServiceLocalArgs,
): Promise<ToolResult> {
  const { type_organisme, code_postal, commune, code_insee, query, limit = 5 } = args;
  const maxLimit = Math.min(limit, 20);

  try {
    const whereClauses: string[] = [];

    if (type_organisme) {
      whereClauses.push(`pivot LIKE '%${sanitize(type_organisme)}%'`);
    }
    if (code_postal) {
      whereClauses.push(`adresse LIKE '%"codePostal":"${sanitize(code_postal)}"%'`);
    }
    if (commune) {
      whereClauses.push(`nom LIKE '%${sanitize(commune)}%' OR adresse LIKE '%${sanitize(commune)}%'`);
    }
    if (code_insee) {
      whereClauses.push(`code_insee_commune = '${sanitize(code_insee)}'`);
    }

    const params = new URLSearchParams({
      limit: String(maxLimit),
      select: "id,nom,pivot,adresse,telephone,adresse_courriel,plage_ouverture,site_internet,geocodage",
    });

    if (whereClauses.length) {
      params.set("where", whereClauses.join(" AND "));
    }
    if (query) {
      params.set("where", query);
    }

    const url = `${ANNUAIRE_BASE}/catalog/datasets/${DATASET_ID}/records?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Erreur API Annuaire : ${response.status} ${response.statusText}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as AnnuaireResponse;

    if (!data.results?.length) {
      return {
        content: [{ type: "text", text: "Aucun organisme trouv\u00e9. Essayez des crit\u00e8res diff\u00e9rents." }],
      };
    }

    const formatted = data.results.map((r) => formatOrganisme(r));

    return {
      content: [
        {
          type: "text",
          text: [
            `**${data.total_count} organisme(s) trouv\u00e9(s)** (${data.results.length} affich\u00e9s)\n`,
            ...formatted,
          ].join("\n---\n"),
        },
      ],
    };
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

function formatOrganisme(record: AnnuaireRecord): string {
  const f = record;
  const sections: string[] = [`## ${f.nom || "Organisme"}`];

  if (f.pivot) {
    const pivots = safeParseArray(f.pivot);
    const types = pivots.map((p: { type_service_local?: string }) => p.type_service_local).filter(Boolean);
    if (types.length) sections.push(`**Type** : ${types.join(", ")}`);
  }

  if (f.adresse) {
    const addrs = safeParseArray(f.adresse);
    for (const addr of addrs) {
      const a = addr as Record<string, string>;
      const parts = [a.numeroVoie, a.complement1, a.nomVoie, a.codePostal, a.commune].filter(Boolean);
      if (parts.length) sections.push(`**Adresse** : ${parts.join(" ")}`);
    }
  }

  if (f.telephone) {
    const phones = safeParseArray(f.telephone);
    const numbers = phones.map((p: { valeur?: string }) => p.valeur).filter(Boolean);
    if (numbers.length) sections.push(`**T\u00e9l\u00e9phone** : ${numbers.join(", ")}`);
  }

  if (f.adresse_courriel) {
    sections.push(`**Email** : ${f.adresse_courriel}`);
  }

  if (f.site_internet) {
    const sites = safeParseArray(f.site_internet);
    const urls = sites.map((s: { valeur?: string }) => s.valeur).filter(Boolean);
    if (urls.length) sections.push(`**Site** : ${urls.join(", ")}`);
  }

  if (f.plage_ouverture) {
    const horaires = safeParseArray(f.plage_ouverture);
    if (horaires.length) {
      const formatted = horaires
        .map((h: Record<string, string>) => {
          const jour = h.nom_jour_debut || "";
          const debut = h.valeur_heure_debut_1 || "";
          const fin = h.valeur_heure_fin_1 || "";
          const debut2 = h.valeur_heure_debut_2 || "";
          const fin2 = h.valeur_heure_fin_2 || "";
          let line = `${jour} : ${debut}-${fin}`;
          if (debut2 && fin2) line += ` / ${debut2}-${fin2}`;
          return line;
        })
        .join(", ");
      sections.push(`**Horaires** : ${formatted}`);
    }
  }

  if (f.geocodage) {
    const geo = typeof f.geocodage === "string" ? JSON.parse(f.geocodage) : f.geocodage;
    if (geo?.lat && geo?.lon) {
      sections.push(`**Coordonn\u00e9es** : ${geo.lat}, ${geo.lon}`);
    }
  }

  return sections.join("\n");
}

function sanitize(input: string): string {
  return input.replace(/['"\\]/g, "");
}

function safeParseArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }
  if (typeof value === "object" && value !== null) return [value as Record<string, unknown>];
  return [];
}

interface AnnuaireRecord {
  id?: string;
  nom?: string;
  pivot?: unknown;
  adresse?: unknown;
  telephone?: unknown;
  adresse_courriel?: string;
  plage_ouverture?: unknown;
  site_internet?: unknown;
  geocodage?: unknown;
}

interface AnnuaireResponse {
  total_count: number;
  results: AnnuaireRecord[];
}
