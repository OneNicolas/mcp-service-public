import type { ToolResult } from "../types.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const ZONAGE_RESOURCE_ID = "13f7282b-8a25-43ab-9713-8bb4e476df55";
const TABULAR_API = `https://tabular-api.data.gouv.fr/api/resources/${ZONAGE_RESOURCE_ID}/data/`;

const PLAFONDS_LOYERS: Record<string, number> = {
  "Abis": 18.89, "A": 14.03, "B1": 11.31, "B2": 9.83, "C": 9.83,
};

const PLAFONDS_RESSOURCES_PERSONNE_SEULE: Record<string, number> = {
  "Abis": 43_475, "A": 43_475, "B1": 35_435, "B2": 31_892, "C": 31_892,
};

const PTZ_ELIGIBLE: Record<string, boolean> = {
  "Abis": true, "A": true, "B1": true, "B2": false, "C": false,
};

const ZONE_DESCRIPTIONS: Record<string, string> = {
  "Abis": "Zone très tendue (Paris et 1ère couronne)",
  "A": "Zone tendue (grandes agglomérations)",
  "B1": "Zone moyennement tendue (agglomérations > 250 000 hab.)",
  "B2": "Zone peu tendue (villes moyennes)",
  "C": "Zone détendue (reste du territoire)",
};

interface ConsulterZonageArgs {
  commune?: string;
  code_insee?: string;
  code_postal?: string;
}

export async function consulterZonageImmobilier(args: ConsulterZonageArgs): Promise<ToolResult> {
  const { commune, code_insee, code_postal } = args;

  if (!commune && !code_insee && !code_postal) {
    return {
      content: [{ type: "text", text: "Veuillez fournir un nom de commune, un code INSEE ou un code postal." }],
      isError: true,
    };
  }

  try {
    const resolved = await resolveCommune(commune, code_insee, code_postal);
    if (!resolved) {
      return {
        content: [{ type: "text", text: "Impossible de résoudre la commune. Vérifiez le nom, code INSEE ou code postal." }],
        isError: true,
      };
    }

    const zone = await fetchZonage(resolved.code);
    if (!zone) {
      return {
        content: [{
          type: "text",
          text: `Aucune donnée de zonage trouvée pour ${resolved.nom} (${resolved.code}). La commune n'est peut-être pas référencée dans le fichier officiel.`,
        }],
        isError: true,
      };
    }

    const report = buildReport(resolved.nom, resolved.code, zone);
    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur zonage : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

async function fetchZonage(codeInsee: string): Promise<string | null> {
  const columnVariants = [
    { col: "CODGEO", filter: `CODGEO__exact=${codeInsee}` },
    { col: "Code INSEE", filter: `Code+INSEE__exact=${codeInsee}` },
    { col: "code_commune_insee", filter: `code_commune_insee__exact=${codeInsee}` },
  ];

  for (const variant of columnVariants) {
    try {
      const url = `${TABULAR_API}?${variant.filter}&page_size=1`;
      const response = await cachedFetch(url, { ttl: CACHE_TTL.ZONAGE });
      if (!response.ok) continue;

      const data = (await response.json()) as { data?: Record<string, unknown>[] };
      if (!data.data?.length) continue;

      const row = data.data[0];
      const zone = row["Zone"] ?? row["zone"] ?? row["ZONE"] ?? row["Zone_ABC"] ?? row["zone_abc"] ?? row["Zonage"] ?? row["zonage"];
      if (zone && typeof zone === "string") return normalizeZone(zone);
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeZone(raw: string): string {
  const z = raw.trim().replace(/\s+/g, "");
  if (/^a\s*bis$/i.test(raw.trim())) return "Abis";
  if (/^a$/i.test(z)) return "A";
  if (/^b1$/i.test(z)) return "B1";
  if (/^b2$/i.test(z)) return "B2";
  if (/^c$/i.test(z)) return "C";
  return z;
}

async function resolveCommune(
  commune?: string, codeInsee?: string, codePostal?: string,
): Promise<{ nom: string; code: string } | null> {
  if (codeInsee) return { nom: codeInsee, code: codeInsee.trim() };
  if (codePostal) {
    const communes = await resolveCodePostal(codePostal);
    if (communes.length > 0) return { nom: communes[0].nom, code: communes[0].code };
    return null;
  }
  if (commune) return resolveNomCommune(commune);
  return null;
}

function buildReport(nom: string, code: string, zone: string): string {
  const lines: string[] = [];

  lines.push(`📍 **Zonage immobilier — ${nom} (${code})**`);
  lines.push("");
  lines.push(`**Zone : ${zone}** — ${ZONE_DESCRIPTIONS[zone] ?? "Classification inconnue"}`);
  lines.push("");

  const plafondLoyer = PLAFONDS_LOYERS[zone];
  const plafondRessources = PLAFONDS_RESSOURCES_PERSONNE_SEULE[zone];
  const ptzEligible = PTZ_ELIGIBLE[zone];

  lines.push("**Plafonds 2025 :**");
  if (plafondLoyer) lines.push(`  Loyer Pinel max : ${plafondLoyer.toFixed(2)} €/m²/mois (hors charges)`);
  if (plafondRessources) lines.push(`  Ressources locataire max (personne seule) : ${formatEuro(plafondRessources)}`);
  lines.push("");

  lines.push("**Éligibilité dispositifs :**");
  lines.push(`  PTZ (neuf) : ${ptzEligible ? "✅ Éligible" : "❌ Non éligible"}`);
  const pinelEligible = zone === "Abis" || zone === "A" || zone === "B1";
  lines.push(`  Pinel / Denormandie : ${pinelEligible ? "✅ Éligible" : "❌ Non éligible (zones B2/C)"}`);
  const lliEligible = zone === "Abis" || zone === "A" || zone === "B1";
  lines.push(`  Logement locatif intermédiaire (LLI) : ${lliEligible ? "✅ Éligible" : "❌ Non éligible"}`);
  lines.push("");

  lines.push("**Signification du zonage :**");
  lines.push("  Le zonage ABC classe les communes selon la tension du marché du logement.");
  lines.push("  Il détermine l'éligibilité aux aides (PTZ, Pinel, PLS) et les plafonds");
  lines.push("  de loyers et de ressources pour les dispositifs d'investissement locatif.");
  lines.push("");
  lines.push("_Source : Ministère de la Transition écologique, arrêté du 05/09/2025 (art. D304-1 CCH) via data.gouv.fr_");

  return lines.join("\n");
}

function formatEuro(value: number): string {
  return value.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}
