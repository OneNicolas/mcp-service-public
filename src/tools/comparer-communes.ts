import type { ToolResult } from "../types.js";
import { resolveNomCommune, resolveCodePostal } from "../utils/geo-api.js";

const REI_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";
const DVF_RESOURCE_ID = "d7933994-2c66-4131-a4da-cf7cd18040a4";
const TABULAR_API_DVF = `https://tabular-api.data.gouv.fr/api/resources/${DVF_RESOURCE_ID}/data/`;
const ZONAGE_RESOURCE_ID = "13f7282b-8a25-43ab-9713-8bb4e476df55";
const TABULAR_API_ZONAGE = `https://tabular-api.data.gouv.fr/api/resources/${ZONAGE_RESOURCE_ID}/data/`;
const ANNUAIRE_API = "https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";

const PLM_ARRONDISSEMENTS: Record<string, string[]> = {
  "75056": Array.from({ length: 20 }, (_, i) => `751${String(i + 1).padStart(2, "0")}`),
  "69123": Array.from({ length: 9 }, (_, i) => `6938${i + 1}`),
  "13055": Array.from({ length: 16 }, (_, i) => `132${String(i + 1).padStart(2, "0")}`),
};

interface ComparerCommunesArgs {
  communes: string[];
}

interface CommuneData {
  nom: string;
  code: string;
  tauxTFB: string | null;
  tauxTEOM: string | null;
  intercommunalite: string | null;
  exercice: string | null;
  prixM2Appart: number | null;
  prixM2Maison: number | null;
  nbTransactions: number;
  zone: string | null;
  servicesCount: number | null;
}

export async function comparerCommunes(args: ComparerCommunesArgs): Promise<ToolResult> {
  const { communes } = args;

  if (!communes || communes.length < 2) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins 2 communes a comparer (maximum 5)." }],
      isError: true,
    };
  }

  if (communes.length > 5) {
    return {
      content: [{ type: "text", text: "Maximum 5 communes pour la comparaison." }],
      isError: true,
    };
  }

  try {
    const resolvedResults = await Promise.allSettled(communes.map((c) => resolveInput(c)));
    const resolved: { nom: string; code: string }[] = [];
    const errors: string[] = [];

    for (let i = 0; i < resolvedResults.length; i++) {
      const result = resolvedResults[i];
      if (result.status === "fulfilled" && result.value) {
        resolved.push(result.value);
      } else {
        errors.push(`"${communes[i]}" : commune non trouvee`);
      }
    }

    if (resolved.length < 2) {
      return {
        content: [{ type: "text", text: `Impossible de resoudre suffisamment de communes.\n${errors.join("\n")}` }],
        isError: true,
      };
    }

    const dataResults = await Promise.allSettled(resolved.map((c) => fetchCommuneData(c.nom, c.code)));
    const communeDataList: CommuneData[] = [];
    for (const result of dataResults) {
      if (result.status === "fulfilled") communeDataList.push(result.value);
    }

    if (communeDataList.length < 2) {
      return {
        content: [{ type: "text", text: "Impossible de recuperer les donnees pour suffisamment de communes." }],
        isError: true,
      };
    }

    const report = buildComparisonReport(communeDataList, errors);
    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur comparaison : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

async function resolveInput(input: string): Promise<{ nom: string; code: string } | null> {
  const trimmed = input.trim();
  if (/^\d{5}$/.test(trimmed)) {
    const communes = await resolveCodePostal(trimmed);
    return communes.length > 0 ? { nom: communes[0].nom, code: communes[0].code } : null;
  }
  return resolveNomCommune(trimmed);
}

async function fetchCommuneData(nom: string, code: string): Promise<CommuneData> {
  const [reiResult, dvfAppartResult, dvfMaisonResult, zonageResult, servicesResult] = await Promise.allSettled([
    fetchREI(code),
    fetchDvfMedianPrixM2(code, "Appartement"),
    fetchDvfMedianPrixM2(code, "Maison"),
    fetchZonage(code),
    fetchServicesCount(code),
  ]);

  const rei = reiResult.status === "fulfilled" ? reiResult.value : null;
  const dvfAppart = dvfAppartResult.status === "fulfilled" ? dvfAppartResult.value : null;
  const dvfMaison = dvfMaisonResult.status === "fulfilled" ? dvfMaisonResult.value : null;
  const zone = zonageResult.status === "fulfilled" ? zonageResult.value : null;
  const services = servicesResult.status === "fulfilled" ? servicesResult.value : null;

  return {
    nom, code,
    tauxTFB: rei?.tauxTFB ?? null,
    tauxTEOM: rei?.tauxTEOM ?? null,
    intercommunalite: rei?.intercommunalite ?? null,
    exercice: rei?.exercice ?? null,
    prixM2Appart: dvfAppart?.medianPrixM2 ?? null,
    prixM2Maison: dvfMaison?.medianPrixM2 ?? null,
    nbTransactions: (dvfAppart?.count ?? 0) + (dvfMaison?.count ?? 0),
    zone,
    servicesCount: services,
  };
}

// T17 -- Compte les services publics locaux via l'API Annuaire
async function fetchServicesCount(codeInsee: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      limit: "0",
      where: `code_insee_commune = '${sanitize(codeInsee)}'`,
    });

    const response = await fetch(`${ANNUAIRE_API}?${params}`);
    if (!response.ok) return null;

    const data = (await response.json()) as { total_count?: number };
    return data.total_count ?? null;
  } catch {
    return null;
  }
}

async function fetchREI(codeInsee: string): Promise<{
  tauxTFB: string; tauxTEOM: string | null; intercommunalite: string; exercice: string;
} | null> {
  const params = new URLSearchParams({
    limit: "1",
    select: "exercice,q03,taux_global_tfb,taux_plein_teom",
    where: `insee_com="${sanitize(codeInsee)}"`,
    order_by: "exercice DESC",
  });

  try {
    const response = await fetch(`${REI_API}/fiscalite-locale-des-particuliers/records?${params}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { results: Record<string, unknown>[] };
    if (!data.results?.length) return null;
    const r = data.results[0];
    return {
      tauxTFB: String(r.taux_global_tfb ?? "N/A"),
      tauxTEOM: r.taux_plein_teom ? String(r.taux_plein_teom) : null,
      intercommunalite: String(r.q03 ?? "N/A"),
      exercice: String(r.exercice ?? ""),
    };
  } catch {
    return null;
  }
}

async function fetchDvfMedianPrixM2(codeInsee: string, typeLocal: string): Promise<{ medianPrixM2: number; count: number } | null> {
  const arrondissements = PLM_ARRONDISSEMENTS[codeInsee];
  const codes = arrondissements ? arrondissements.slice(0, 3) : [codeInsee];
  const dateMin = `${new Date().getFullYear() - 2}-01-01`;
  const allPrixM2: number[] = [];

  for (const code of codes) {
    try {
      const params = new URLSearchParams({
        page: "1", page_size: "100",
        code_commune__exact: code,
        nature_mutation__exact: "Vente",
        type_local__exact: typeLocal,
        date_mutation__greater: dateMin,
      });
      const response = await fetch(`${TABULAR_API_DVF}?${params}`);
      if (!response.ok) continue;
      const data = (await response.json()) as { data: DvfRecord[] };
      if (!data.data?.length) continue;

      const byMutation = new Map<string, { prix: number; surface: number }>();
      for (const rec of data.data) {
        if (!rec.valeur_fonciere || rec.valeur_fonciere <= 0) continue;
        if (!rec.surface_reelle_bati || rec.surface_reelle_bati <= 0) continue;
        const existing = byMutation.get(rec.id_mutation);
        if (!existing || rec.surface_reelle_bati > existing.surface) {
          byMutation.set(rec.id_mutation, { prix: rec.valeur_fonciere, surface: rec.surface_reelle_bati });
        }
      }

      for (const { prix, surface } of byMutation.values()) {
        const pm2 = prix / surface;
        if (pm2 >= 200 && pm2 <= 30000) allPrixM2.push(pm2);
      }
    } catch {
      continue;
    }
  }

  if (allPrixM2.length < 3) return null;
  allPrixM2.sort((a, b) => a - b);
  const n = allPrixM2.length;
  const medianVal = n % 2 === 1 ? allPrixM2[Math.floor(n / 2)] : (allPrixM2[n / 2 - 1] + allPrixM2[n / 2]) / 2;
  return { medianPrixM2: medianVal, count: n };
}

interface DvfRecord {
  id_mutation: string;
  valeur_fonciere: number | null;
  surface_reelle_bati: number | null;
}

async function fetchZonage(codeInsee: string): Promise<string | null> {
  const columnVariants = [
    `CODGEO__exact=${codeInsee}`,
    `Code+INSEE__exact=${codeInsee}`,
    `code_commune_insee__exact=${codeInsee}`,
  ];

  for (const filter of columnVariants) {
    try {
      const response = await fetch(`${TABULAR_API_ZONAGE}?${filter}&page_size=1`);
      if (!response.ok) continue;
      const data = (await response.json()) as { data?: Record<string, unknown>[] };
      if (!data.data?.length) continue;
      const row = data.data[0];
      const zone = row["Zone"] ?? row["zone"] ?? row["ZONE"] ?? row["Zone_ABC"] ?? row["zone_abc"];
      if (zone && typeof zone === "string") return zone.trim().replace(/\s+/g, "");
    } catch {
      continue;
    }
  }
  return null;
}

function buildComparisonReport(data: CommuneData[], errors: string[]): string {
  const lines: string[] = [];
  const nbCommunes = data.length;

  lines.push(`\ud83d\udcca **Comparaison de ${nbCommunes} communes**`);
  lines.push("");

  const header = ["Indicateur", ...data.map((d) => `**${d.nom}**`)];
  const separator = header.map(() => "---");
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${separator.join(" | ")} |`);

  lines.push(`| Code INSEE | ${data.map((d) => d.code).join(" | ")} |`);
  const exercice = data[0]?.exercice ?? "";
  lines.push(`| Taux TFB (${exercice}) | ${data.map((d) => d.tauxTFB ? `${d.tauxTFB} %` : "N/A").join(" | ")} |`);
  lines.push(`| Taux TEOM | ${data.map((d) => d.tauxTEOM ? `${d.tauxTEOM} %` : "N/A").join(" | ")} |`);
  lines.push(`| Prix median/m\u00b2 appart. | ${data.map((d) => d.prixM2Appart ? formatEuro(d.prixM2Appart) : "N/A").join(" | ")} |`);
  lines.push(`| Prix median/m\u00b2 maison | ${data.map((d) => d.prixM2Maison ? formatEuro(d.prixM2Maison) : "N/A").join(" | ")} |`);
  lines.push(`| Transactions DVF (2 ans) | ${data.map((d) => d.nbTransactions > 0 ? String(d.nbTransactions) : "N/A").join(" | ")} |`);
  lines.push(`| Zone ABC | ${data.map((d) => d.zone ?? "N/A").join(" | ")} |`);
  lines.push(`| Services publics | ${data.map((d) => d.servicesCount !== null ? String(d.servicesCount) : "N/A").join(" | ")} |`);
  lines.push(`| Intercommunalite | ${data.map((d) => d.intercommunalite ?? "N/A").join(" | ")} |`);
  lines.push("");

  lines.push("**Points cles :**");
  const withTFB = data.filter((d) => d.tauxTFB && d.tauxTFB !== "N/A");
  if (withTFB.length >= 2) {
    const minTFB = withTFB.reduce((a, b) => Number(a.tauxTFB) < Number(b.tauxTFB) ? a : b);
    lines.push(`  \ud83c\udfc6 Taxe fonciere la plus basse : **${minTFB.nom}** (${minTFB.tauxTFB} %)`);
  }
  const withAppart = data.filter((d) => d.prixM2Appart);
  if (withAppart.length >= 2) {
    const minPrix = withAppart.reduce((a, b) => (a.prixM2Appart ?? Infinity) < (b.prixM2Appart ?? Infinity) ? a : b);
    lines.push(`  \ud83c\udfc6 Appartements les moins chers : **${minPrix.nom}** (${formatEuro(minPrix.prixM2Appart!)}/m\u00b2)`);
  }
  const withMaison = data.filter((d) => d.prixM2Maison);
  if (withMaison.length >= 2) {
    const minPrix = withMaison.reduce((a, b) => (a.prixM2Maison ?? Infinity) < (b.prixM2Maison ?? Infinity) ? a : b);
    lines.push(`  \ud83c\udfc6 Maisons les moins cheres : **${minPrix.nom}** (${formatEuro(minPrix.prixM2Maison!)}/m\u00b2)`);
  }
  // T17 -- Services publics
  const withServices = data.filter((d) => d.servicesCount !== null && d.servicesCount > 0);
  if (withServices.length >= 2) {
    const maxServices = withServices.reduce((a, b) => (a.servicesCount ?? 0) > (b.servicesCount ?? 0) ? a : b);
    lines.push(`  \ud83c\udfc6 Plus de services publics : **${maxServices.nom}** (${maxServices.servicesCount} organismes)`);
  }
  lines.push("");

  if (errors.length > 0) {
    lines.push(`\u26a0\ufe0f Communes non trouvees : ${errors.join(", ")}`);
    lines.push("");
  }

  lines.push("_Sources : DGFiP REI via data.economie.gouv.fr, DVF via data.gouv.fr, zonage ABC Min. Transition ecologique, Annuaire service-public.fr_");
  return lines.join("\n");
}

function formatEuro(value: number): string {
  return value.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function sanitize(input: string): string {
  return input.replace(/['"\\]/g, "");
}
