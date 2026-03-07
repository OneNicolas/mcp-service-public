import type { ToolResult } from "../types.js";
import { resolveNomCommune, resolveCodePostal, resolveCodeInsee } from "../utils/geo-api.js";
import { fetch6emeScores, extractDeptFromInsee } from "./consulter-evaluations-nationales.js";
import { fetchSecuriteData } from "./consulter-securite.js";
import { fetchRisques, fetchCatNat } from "./consulter-risques-naturels.js";
import { fetchAideSocialeForCompare, type AideSocialeCompareData } from "./consulter-aide-sociale.js";
import { fetchIvalForCompare, type IvalCompareData } from "./consulter-resultats-lycee.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const REI_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";
const DVF_RESOURCE_ID = "d7933994-2c66-4131-a4da-cf7cd18040a4";
const TABULAR_API_DVF = `https://tabular-api.data.gouv.fr/api/resources/${DVF_RESOURCE_ID}/data/`;
const ZONAGE_RESOURCE_ID = "13f7282b-8a25-43ab-9713-8bb4e476df55";
const TABULAR_API_ZONAGE = `https://tabular-api.data.gouv.fr/api/resources/${ZONAGE_RESOURCE_ID}/data/`;
const ANNUAIRE_API = "https://api-lannuaire.service-public.gouv.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";
const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records";

const PLM_ARRONDISSEMENTS: Record<string, string[]> = {
  "75056": Array.from({ length: 20 }, (_, i) => `751${String(i + 1).padStart(2, "0")}`),
  "69123": Array.from({ length: 9 }, (_, i) => `6938${i + 1}`),
  "13055": Array.from({ length: 16 }, (_, i) => `132${String(i + 1).padStart(2, "0")}`),
};

interface ComparerCommunesArgs {
  communes: string[];
}

export interface EducationStats {
  ecoles: number;
  colleges: number;
  lycees: number;
}

interface Scores6emeData {
  scoreFrancais: number;
  scoreMaths: number;
  ips: number;
}

export interface CollegeDistrict {
  codeRne: string;
  nom: string | null;
}

interface SanteData {
  densiteMG: number | null;
  densiteSpecialistes: number | null;
  patienteleMT: number | null;
}

interface SecuriteCompareData {
  cambriolages: number | null;
  volsSansViolence: number | null;
  violencesPhysiques: number | null;
  tauxCambriolages: number | null;
}

interface RisquesCompareData {
  nbRisques: number;
  nbCatNat: number;
}

interface CommuneData {
  nom: string;
  code: string;
  population: number | null;
  densite: number | null;
  tauxTFB: string | null;
  tauxTEOM: string | null;
  intercommunalite: string | null;
  exercice: string | null;
  prixM2Appart: number | null;
  prixM2Maison: number | null;
  nbTransactions: number;
  zone: string | null;
  servicesCount: number | null;
  education: EducationStats | null;
  scores6eme: Scores6emeData | null;
  collegesDistrict: CollegeDistrict[] | null;
  sante: SanteData | null;
  securite: SecuriteCompareData | null;
  risques: RisquesCompareData | null;
  ival: IvalCompareData | null;
  aideSociale: AideSocialeCompareData | null;
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
  const codeDept = extractDeptFromInsee(code);

  const [reiResult, dvfAppartResult, dvfMaisonResult, zonageResult, servicesResult, educationResult, geoResult, scores6emeResult, collegesResult, santeResult, securiteResult, risquesResult, ivalResult, aideSocialeResult] = await Promise.allSettled([
    fetchREI(code),
    fetchDvfMedianPrixM2(code, "Appartement"),
    fetchDvfMedianPrixM2(code, "Maison"),
    fetchZonage(code),
    fetchServicesCount(code),
    fetchEducationStats(nom),
    resolveCodeInsee(code),
    fetchScoresForCompare(codeDept),
    fetchCollegesDistrict(nom),
    fetchSanteForCompare(codeDept),
    fetchSecuriteForCompare(codeDept),
    fetchRisquesForCompare(code),
    fetchIvalForCompare(code),
    fetchAideSocialeForCompare(codeDept),
  ]);

  const rei = reiResult.status === "fulfilled" ? reiResult.value : null;
  const dvfAppart = dvfAppartResult.status === "fulfilled" ? dvfAppartResult.value : null;
  const dvfMaison = dvfMaisonResult.status === "fulfilled" ? dvfMaisonResult.value : null;
  const zone = zonageResult.status === "fulfilled" ? zonageResult.value : null;
  const services = servicesResult.status === "fulfilled" ? servicesResult.value : null;
  const education = educationResult.status === "fulfilled" ? educationResult.value : null;
  const geo = geoResult.status === "fulfilled" ? geoResult.value : null;
  const scores6eme = scores6emeResult.status === "fulfilled" ? scores6emeResult.value : null;
  const collegesDistrict = collegesResult.status === "fulfilled" ? collegesResult.value : null;
  const sante = santeResult.status === "fulfilled" ? santeResult.value : null;
  const securite = securiteResult.status === "fulfilled" ? securiteResult.value : null;
  const risques = risquesResult.status === "fulfilled" ? risquesResult.value : null;
  const ival = ivalResult.status === "fulfilled" ? ivalResult.value : null;
  const aideSociale = aideSocialeResult.status === "fulfilled" ? aideSocialeResult.value : null;

  // Densite = population / (surface en hectares / 100) = hab/km2
  const population = geo?.population ?? null;
  const densite = (population && geo?.surface) ? Math.round(population / (geo.surface / 100)) : null;

  return {
    nom, code,
    population,
    densite,
    tauxTFB: rei?.tauxTFB ?? null,
    tauxTEOM: rei?.tauxTEOM ?? null,
    intercommunalite: rei?.intercommunalite ?? null,
    exercice: rei?.exercice ?? null,
    prixM2Appart: dvfAppart?.medianPrixM2 ?? null,
    prixM2Maison: dvfMaison?.medianPrixM2 ?? null,
    nbTransactions: (dvfAppart?.count ?? 0) + (dvfMaison?.count ?? 0),
    zone,
    servicesCount: services,
    education,
    scores6eme,
    collegesDistrict,
    sante,
    securite,
    risques,
    ival,
    aideSociale,
  };
}

// T40 -- Fetch scores 6eme pour le departement de la commune
async function fetchScoresForCompare(codeDept: string): Promise<Scores6emeData | null> {
  try {
    const scores = await fetch6emeScores(codeDept);
    if (scores.length === 0) return null;
    const latest = scores[0];
    return {
      scoreFrancais: latest.scoreFrancais,
      scoreMaths: latest.scoreMaths,
      ips: latest.ipsMoyen,
    };
  } catch {
    return null;
  }
}

// T17 -- Compte les services publics locaux via l'API Annuaire
async function fetchServicesCount(codeInsee: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      limit: "0",
      where: `code_insee_commune = '${sanitize(codeInsee)}'`,
    });

    const response = await cachedFetch(`${ANNUAIRE_API}?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return null;

    const data = (await response.json()) as { total_count?: number };
    return data.total_count ?? null;
  } catch {
    return null;
  }
}

// T31 -- Compte les etablissements scolaires ouverts par type via l'API Education nationale
export async function fetchEducationStats(communeName: string): Promise<EducationStats | null> {
  try {
    const params = new URLSearchParams({
      select: "type_etablissement, count(*) as nb",
      where: `search(nom_commune, '${sanitize(communeName)}') AND etat = 'OUVERT'`,
      group_by: "type_etablissement",
      limit: "20",
    });

    const response = await cachedFetch(`${EDUCATION_API}?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      results: Array<{ type_etablissement?: string; nb?: number }>;
    };

    if (!data.results?.length) return null;

    return parseEducationResults(data.results);
  } catch {
    return null;
  }
}

// Extrait ecoles/colleges/lycees depuis la reponse groupee de l'API Education
// Retourne null si aucun resultat ou aucun type scolaire connu
export function parseEducationResults(
  results: Array<{ type_etablissement?: string; nb?: number }>,
): EducationStats | null {
  if (!results || results.length === 0) return null;

  let ecoles = 0;
  let colleges = 0;
  let lycees = 0;
  let found = false;

  for (const r of results) {
    const type = r.type_etablissement;
    const nb = r.nb ?? 0;
    if (type === "Ecole") { ecoles = nb; found = true; }
    else if (type === "Coll\u00e8ge") { colleges = nb; found = true; }
    else if (type === "Lyc\u00e9e") { lycees = nb; found = true; }
    // Ignorer Medico-social, Service Administratif, Information et orientation
  }

  return found ? { ecoles, colleges, lycees } : null;
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
    const response = await cachedFetch(`${REI_API}/fiscalite-locale-des-particuliers/records?${params}`, { ttl: CACHE_TTL.REI });
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
      const response = await cachedFetch(`${TABULAR_API_DVF}?${params}`, { ttl: CACHE_TTL.DVF });
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
      const response = await cachedFetch(`${TABULAR_API_ZONAGE}?${filter}&page_size=1`, { ttl: CACHE_TTL.ZONAGE });
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

const CARTE_SCOLAIRE_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-carte-scolaire-colleges-publics@dataeducation/records";

// T43 -- Colleges de secteur (carte scolaire) pour une commune
export async function fetchCollegesDistrict(communeName: string): Promise<CollegeDistrict[] | null> {
  try {
    // Etape 1 : recuperer les codes RNE distincts de la carte scolaire
    const params = new URLSearchParams({
      select: "code_rne",
      where: `libelle_commune = '${sanitize(communeName.toUpperCase())}'`,
      group_by: "code_rne",
      limit: "20",
    });

    const response = await cachedFetch(`${CARTE_SCOLAIRE_API}?${params}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      results: Array<{ code_rne?: string }>;
    };

    if (!data.results?.length) return null;

    const rnes = data.results
      .map((r) => r.code_rne)
      .filter((rne): rne is string => !!rne);

    if (rnes.length === 0) return null;

    // Etape 2 : recuperer les noms depuis l'annuaire education
    const rneFilter = rnes.map((r) => `'${sanitize(r)}'`).join(", ");
    const annuaireParams = new URLSearchParams({
      select: "identifiant_de_l_etablissement, nom_etablissement",
      where: `identifiant_de_l_etablissement IN (${rneFilter})`,
      limit: "20",
    });

    const annuaireResp = await cachedFetch(`${EDUCATION_API}?${annuaireParams}`, { ttl: CACHE_TTL.ANNUAIRE });

    const nameMap = new Map<string, string>();
    if (annuaireResp.ok) {
      const annuaireData = (await annuaireResp.json()) as {
        results: Array<{ identifiant_de_l_etablissement?: string; nom_etablissement?: string }>;
      };
      for (const r of annuaireData.results ?? []) {
        const id = r.identifiant_de_l_etablissement;
        const nom = r.nom_etablissement;
        if (id && nom) nameMap.set(id, nom);
      }
    }

    return rnes.map((rne) => ({
      codeRne: rne,
      nom: nameMap.get(rne) ?? null,
    }));
  } catch {
    return null;
  }
}

const AMELI_API = "https://data.ameli.fr/api/explore/v2.1/catalog/datasets";
const DS_DEMOGRAPHIE = "demographie-effectifs-et-les-densites";
const DS_PATIENTELE = "patientele-medecintraitant-generalistes-annuelle";

// T49 -- Donnees sante departementales pour comparaison
async function fetchSanteForCompare(codeDept: string): Promise<SanteData | null> {
  try {
    // 1. Densite MG et total specialistes
    const demoParams = new URLSearchParams({
      select: "profession_sante, densite",
      where: `departement='${sanitize(codeDept)}' AND classe_age='tout_age' AND libelle_sexe='tout sexe'`,
      order_by: "annee DESC",
      limit: "40",
    });

    const demoResp = await cachedFetch(`${AMELI_API}/${DS_DEMOGRAPHIE}/records?${demoParams}`, { ttl: CACHE_TTL.ANNUAIRE });
    let densiteMG: number | null = null;
    let densiteSpec: number | null = null;

    if (demoResp.ok) {
      const demoData = (await demoResp.json()) as { results: Array<Record<string, unknown>> };
      const specDensites: number[] = [];
      // Garder uniquement la derniere annee (tri DESC deja fait)
      const seenProfessions = new Set<string>();
      for (const r of demoData.results ?? []) {
        const prof = String(r.profession_sante ?? "");
        if (seenProfessions.has(prof)) continue;
        seenProfessions.add(prof);
        const d = Number(r.densite ?? 0);
        if (d <= 0) continue;
        const profLower = prof.toLowerCase();
        if (profLower.includes("generaliste")) {
          densiteMG = d;
        } else if (!profLower.includes("ensemble")) {
          specDensites.push(d);
        }
      }
      if (specDensites.length > 0) {
        densiteSpec = Math.round(specDensites.reduce((a, b) => a + b, 0) * 10) / 10;
      }
    }

    // 2. Patientele MT moyenne
    const mtParams = new URLSearchParams({
      select: "patientele_mt_moyenne",
      where: `departement='${sanitize(codeDept)}'`,
      order_by: "annee DESC",
      limit: "1",
    });

    let patienteleMT: number | null = null;
    const mtResp = await cachedFetch(`${AMELI_API}/${DS_PATIENTELE}/records?${mtParams}`, { ttl: CACHE_TTL.ANNUAIRE });
    if (mtResp.ok) {
      const mtData = (await mtResp.json()) as { results: Array<Record<string, unknown>> };
      if (mtData.results?.length) {
        patienteleMT = Number(mtData.results[0].patientele_mt_moyenne ?? 0) || null;
      }
    }

    if (densiteMG === null && densiteSpec === null && patienteleMT === null) return null;
    return { densiteMG, densiteSpecialistes: densiteSpec, patienteleMT };
  } catch {
    return null;
  }
}

// T56 -- Recupere les indicateurs de securite cles pour le departement
async function fetchSecuriteForCompare(codeDept: string): Promise<SecuriteCompareData | null> {
  try {
    const rows = await fetchSecuriteData(codeDept);
    if (rows.length === 0) return null;

    // Prendre la derniere annee disponible
    const latestYear = Math.max(...rows.map((r) => r.annee));
    const latestRows = rows.filter((r) => r.annee === latestYear);

    const find = (keyword: string) => latestRows.find((r) => r.indicateur.toLowerCase().includes(keyword));
    const camb = find("cambriolage");
    const vols = find("vols sans violence");
    const violences = find("violences physiques intrafamiliales") ?? find("violences physiques");

    return {
      cambriolages: camb?.nombre ?? null,
      volsSansViolence: vols?.nombre ?? null,
      violencesPhysiques: violences?.nombre ?? null,
      tauxCambriolages: camb?.taux_pour_mille ?? null,
    };
  } catch {
    return null;
  }
}

// T56 -- Recupere le nombre de risques et arretes CatNat pour une commune
async function fetchRisquesForCompare(codeInsee: string): Promise<RisquesCompareData | null> {
  try {
    const [risquesItems, catnatItems] = await Promise.all([
      fetchRisques(codeInsee),
      fetchCatNat(codeInsee),
    ]);

    // Compter les risques uniques
    const risquesSet = new Set<string>();
    for (const item of risquesItems) {
      for (const detail of item.risques_detail ?? []) {
        if (detail.num_risque) risquesSet.add(detail.num_risque);
      }
    }

    return {
      nbRisques: risquesSet.size,
      nbCatNat: catnatItems.length,
    };
  } catch {
    return null;
  }
}

function buildComparisonReport(data: CommuneData[], errors: string[]): string {
  const lines: string[] = [];
  const nbCommunes = data.length;

  lines.push(`\uD83D\uDCCA **Comparaison de ${nbCommunes} communes**`);
  lines.push("");

  const header = ["Indicateur", ...data.map((d) => `**${d.nom}**`)];
  const separator = header.map(() => "---");
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${separator.join(" | ")} |`);

  lines.push(`| Code INSEE | ${data.map((d) => d.code).join(" | ")} |`);
  lines.push(`| Population | ${data.map((d) => d.population ? d.population.toLocaleString("fr-FR") : "N/A").join(" | ")} |`);
  lines.push(`| Densite (hab/km\u00B2) | ${data.map((d) => d.densite ? d.densite.toLocaleString("fr-FR") : "N/A").join(" | ")} |`);
  const exercice = data[0]?.exercice ?? "";
  lines.push(`| Taux TFB (${exercice}) | ${data.map((d) => d.tauxTFB ? `${d.tauxTFB} %` : "N/A").join(" | ")} |`);
  lines.push(`| Taux TEOM | ${data.map((d) => d.tauxTEOM ? `${d.tauxTEOM} %` : "N/A").join(" | ")} |`);
  lines.push(`| Prix median/m\u00B2 appart. | ${data.map((d) => d.prixM2Appart ? formatEuro(d.prixM2Appart) : "N/A").join(" | ")} |`);
  lines.push(`| Prix median/m\u00B2 maison | ${data.map((d) => d.prixM2Maison ? formatEuro(d.prixM2Maison) : "N/A").join(" | ")} |`);
  lines.push(`| Transactions DVF (2 ans) | ${data.map((d) => d.nbTransactions > 0 ? String(d.nbTransactions) : "N/A").join(" | ")} |`);
  lines.push(`| Zone ABC | ${data.map((d) => d.zone ?? "N/A").join(" | ")} |`);
  lines.push(`| Services publics | ${data.map((d) => d.servicesCount !== null ? String(d.servicesCount) : "N/A").join(" | ")} |`);
  // T31 -- Lignes education
  lines.push(`| \uD83C\uDFEB Ecoles | ${data.map((d) => d.education ? String(d.education.ecoles) : "N/A").join(" | ")} |`);
  lines.push(`| \uD83C\uDFEB Coll\u00E8ges | ${data.map((d) => d.education ? String(d.education.colleges) : "N/A").join(" | ")} |`);
  // T43 -- Colleges de secteur (carte scolaire)
  lines.push(`| \uD83C\uDFEB Coll\u00E8ges de secteur | ${data.map((d) => formatCollegesDistrict(d.collegesDistrict)).join(" | ")} |`);
  lines.push(`| \uD83C\uDFEB Lyc\u00E9es | ${data.map((d) => d.education ? String(d.education.lycees) : "N/A").join(" | ")} |`);
  lines.push(`| \uD83C\uDFEB Total \u00E9tablissements | ${data.map((d) => d.education ? String(d.education.ecoles + d.education.colleges + d.education.lycees) : "N/A").join(" | ")} |`);
  // T40 -- Scores 6eme departementaux
  lines.push(`| \uD83D\uDCCA Score 6eme Fran\u00E7ais (dept) | ${data.map((d) => d.scores6eme ? String(d.scores6eme.scoreFrancais) : "N/A").join(" | ")} |`);
  lines.push(`| \uD83D\uDCCA Score 6eme Maths (dept) | ${data.map((d) => d.scores6eme ? String(d.scores6eme.scoreMaths) : "N/A").join(" | ")} |`);
  lines.push(`| \uD83D\uDCCA IPS moyen (dept) | ${data.map((d) => d.scores6eme ? d.scores6eme.ips.toFixed(1) : "N/A").join(" | ")} |`);
  // T49 -- Lignes sante
  lines.push(`| \u{1FA7A} Densite MG (dept, /100k) | ${data.map((d) => d.sante?.densiteMG ? String(d.sante.densiteMG) : "N/A").join(" | ")} |`);
  lines.push(`| \u{1FA7A} Densite specialistes (dept) | ${data.map((d) => d.sante?.densiteSpecialistes ? String(d.sante.densiteSpecialistes) : "N/A").join(" | ")} |`);
  lines.push(`| \u{1FA7A} Patientele MT moy. (dept) | ${data.map((d) => d.sante?.patienteleMT ? String(Math.round(d.sante.patienteleMT)) : "N/A").join(" | ")} |`);
  // T56 -- Lignes securite departementale
  lines.push(`| \uD83D\uDEE1\uFE0F Cambriolages (dept) | ${data.map((d) => d.securite?.cambriolages != null ? `${d.securite.cambriolages.toLocaleString("fr-FR")} (${d.securite.tauxCambriolages?.toFixed(2) ?? "?"}\u2030)` : "N/A").join(" | ")} |`);
  lines.push(`| \uD83D\uDEE1\uFE0F Vols sans violence (dept) | ${data.map((d) => d.securite?.volsSansViolence != null ? d.securite.volsSansViolence.toLocaleString("fr-FR") : "N/A").join(" | ")} |`);
  lines.push(`| \uD83D\uDEE1\uFE0F Violences physiques (dept) | ${data.map((d) => d.securite?.violencesPhysiques != null ? d.securite.violencesPhysiques.toLocaleString("fr-FR") : "N/A").join(" | ")} |`);
  // T56 -- Lignes risques naturels
  lines.push(`| \u26A0\uFE0F Risques naturels | ${data.map((d) => d.risques ? `${d.risques.nbRisques} identifie(s)` : "N/A").join(" | ")} |`);
  lines.push(`| \u26A0\uFE0F Arretes CatNat | ${data.map((d) => d.risques ? String(d.risques.nbCatNat) : "N/A").join(" | ")} |`);
  lines.push(`| Intercommunalite | ${data.map((d) => d.intercommunalite ?? "N/A").join(" | ")} |`);
  // T76 -- IVAL meilleur lycee GT de la commune
  lines.push(`| \uD83C\uDFEB Meilleur lyc\u00E9e bac (commune) | ${data.map((d) => d.ival ? `${d.ival.nomLycee} (${d.ival.tauxReussite.toFixed(1)}%${d.ival.valeurAjoutee != null ? `, VA ${d.ival.valeurAjoutee > 0 ? "+" : ""}${d.ival.valeurAjoutee}` : ""})` : "N/A").join(" | ")} |`);
  lines.push(`| \uD83C\uDFEB Taux mentions bac (commune) | ${data.map((d) => d.ival ? `${d.ival.tauxMentions.toFixed(1)}% (${d.ival.annee})` : "N/A").join(" | ")} |`);
  // T76 -- Aide sociale CAF departementale
  const anneeCAF = data.find(d => d.aideSociale?.annee)?.aideSociale?.annee ?? "";
  lines.push(`| \uD83D\uDC9A RSA foyers dept${anneeCAF ? ` (${anneeCAF})` : ""} | ${data.map((d) => d.aideSociale?.nbFoyersRSA != null ? d.aideSociale.nbFoyersRSA.toLocaleString("fr-FR") : "N/A").join(" | ")} |`);
  lines.push(`| \uD83D\uDC9A Aides logement foyers dept | ${data.map((d) => d.aideSociale?.nbFoyersAPL != null ? d.aideSociale.nbFoyersAPL.toLocaleString("fr-FR") : "N/A").join(" | ")} |`);
  lines.push(`| \uD83D\uDC9A AAH foyers dept | ${data.map((d) => d.aideSociale?.nbFoyersAAH != null ? d.aideSociale.nbFoyersAAH.toLocaleString("fr-FR") : "N/A").join(" | ")} |`);
  lines.push("");

  lines.push("**Points cles :**");
  // T38 -- Population et densite
  const withPop = data.filter((d) => d.population !== null && d.population > 0);
  if (withPop.length >= 2) {
    const maxPop = withPop.reduce((a, b) => (a.population ?? 0) > (b.population ?? 0) ? a : b);
    lines.push(`  \uD83C\uDFC6 Commune la plus peuplee : **${maxPop.nom}** (${maxPop.population!.toLocaleString("fr-FR")} hab.)`);
  }
  const withDens = data.filter((d) => d.densite !== null && d.densite > 0);
  if (withDens.length >= 2) {
    const maxDens = withDens.reduce((a, b) => (a.densite ?? 0) > (b.densite ?? 0) ? a : b);
    lines.push(`  \uD83C\uDFC6 Commune la plus dense : **${maxDens.nom}** (${maxDens.densite!.toLocaleString("fr-FR")} hab/km\u00B2)`);
  }
  const withTFB = data.filter((d) => d.tauxTFB && d.tauxTFB !== "N/A");
  if (withTFB.length >= 2) {
    const minTFB = withTFB.reduce((a, b) => Number(a.tauxTFB) < Number(b.tauxTFB) ? a : b);
    lines.push(`  \uD83C\uDFC6 Taxe fonciere la plus basse : **${minTFB.nom}** (${minTFB.tauxTFB} %)`);
  }
  const withAppart = data.filter((d) => d.prixM2Appart);
  if (withAppart.length >= 2) {
    const minPrix = withAppart.reduce((a, b) => (a.prixM2Appart ?? Infinity) < (b.prixM2Appart ?? Infinity) ? a : b);
    lines.push(`  \uD83C\uDFC6 Appartements les moins chers : **${minPrix.nom}** (${formatEuro(minPrix.prixM2Appart!)}/m\u00B2)`);
  }
  const withMaison = data.filter((d) => d.prixM2Maison);
  if (withMaison.length >= 2) {
    const minPrix = withMaison.reduce((a, b) => (a.prixM2Maison ?? Infinity) < (b.prixM2Maison ?? Infinity) ? a : b);
    lines.push(`  \uD83C\uDFC6 Maisons les moins cheres : **${minPrix.nom}** (${formatEuro(minPrix.prixM2Maison!)}/m\u00B2)`);
  }
  // T17 -- Services publics
  const withServices = data.filter((d) => d.servicesCount !== null && d.servicesCount > 0);
  if (withServices.length >= 2) {
    const maxServices = withServices.reduce((a, b) => (a.servicesCount ?? 0) > (b.servicesCount ?? 0) ? a : b);
    lines.push(`  \uD83C\uDFC6 Plus de services publics : **${maxServices.nom}** (${maxServices.servicesCount} organismes)`);
  }
  // T31 -- Education
  const withEducation = data.filter((d) => d.education && (d.education.ecoles + d.education.colleges + d.education.lycees) > 0);
  if (withEducation.length >= 2) {
    const maxEdu = withEducation.reduce((a, b) => {
      const totalA = a.education!.ecoles + a.education!.colleges + a.education!.lycees;
      const totalB = b.education!.ecoles + b.education!.colleges + b.education!.lycees;
      return totalA > totalB ? a : b;
    });
    const total = maxEdu.education!.ecoles + maxEdu.education!.colleges + maxEdu.education!.lycees;
    lines.push(`  \uD83C\uDFC6 Plus d'\u00E9tablissements scolaires : **${maxEdu.nom}** (${total} : ${maxEdu.education!.ecoles} \u00E9coles, ${maxEdu.education!.colleges} coll\u00E8ges, ${maxEdu.education!.lycees} lyc\u00E9es)`);
  }
  // T49 -- Sante
  const withSante = data.filter((d) => d.sante?.densiteMG !== null);
  if (withSante.length >= 2) {
    const bestMG = withSante.reduce((a, b) => (a.sante!.densiteMG ?? 0) > (b.sante!.densiteMG ?? 0) ? a : b);
    const worstMG = withSante.reduce((a, b) => (a.sante!.densiteMG ?? Infinity) < (b.sante!.densiteMG ?? Infinity) ? a : b);
    if ((bestMG.sante!.densiteMG ?? 0) > (worstMG.sante!.densiteMG ?? 0) * 1.1) {
      lines.push(`  \u{1FA7A} Meilleure densite MG (dept) : **${bestMG.nom}** (${bestMG.sante!.densiteMG}/100k hab.)`);
    }
  }
  // T40 -- Meilleur score scolaire (ecart > 5 points)
  const withScores = data.filter((d) => d.scores6eme !== null);
  if (withScores.length >= 2) {
    const best = withScores.reduce((a, b) => {
      const avgA = (a.scores6eme!.scoreFrancais + a.scores6eme!.scoreMaths) / 2;
      const avgB = (b.scores6eme!.scoreFrancais + b.scores6eme!.scoreMaths) / 2;
      return avgA > avgB ? a : b;
    });
    const worst = withScores.reduce((a, b) => {
      const avgA = (a.scores6eme!.scoreFrancais + a.scores6eme!.scoreMaths) / 2;
      const avgB = (b.scores6eme!.scoreFrancais + b.scores6eme!.scoreMaths) / 2;
      return avgA < avgB ? a : b;
    });
    const ecart = ((best.scores6eme!.scoreFrancais + best.scores6eme!.scoreMaths) - (worst.scores6eme!.scoreFrancais + worst.scores6eme!.scoreMaths)) / 2;
    if (ecart > 5) {
      lines.push(`  \uD83C\uDFC6 Meilleur score scolaire (dept) : **${best.nom}** (moy. ${Math.round((best.scores6eme!.scoreFrancais + best.scores6eme!.scoreMaths) / 2)})`);
    }
  }
  // T76 -- Point cle IVAL meilleur lycee bac
  const withIval = data.filter((d) => d.ival !== null && d.ival.tauxReussite > 0);
  if (withIval.length >= 2) {
    const bestIval = withIval.reduce((a, b) => {
      const scoreA = (a.ival!.valeurAjoutee ?? 0) * 10 + a.ival!.tauxReussite;
      const scoreB = (b.ival!.valeurAjoutee ?? 0) * 10 + b.ival!.tauxReussite;
      return scoreA > scoreB ? a : b;
    });
    lines.push(`  \uD83C\uDFC6 Meilleur lycee bac GT : **${bestIval.nom}** — ${bestIval.ival!.nomLycee} (${bestIval.ival!.tauxReussite.toFixed(1)}%)`);
  }
  lines.push("");
  // Note donnees departementales
  const withSecurite = data.filter((d) => d.securite !== null);
  const withAideSociale = data.filter((d) => d.aideSociale !== null);
  const hasDeptData = withScores.length > 0 || withSante.length > 0 || withSecurite.length > 0 || withAideSociale.length > 0;
  if (hasDeptData) {
    const deptItems = [];
    if (withScores.length > 0) deptItems.push("Scores 6eme/IPS");
    if (withSante.length > 0) deptItems.push("densite medecins/patientele MT");
    if (withSecurite.length > 0) deptItems.push("securite/delinquance");
    if (withAideSociale.length > 0) deptItems.push("aide sociale CAF (RSA/AL/AAH)");
    lines.push(`_Note : ${deptItems.join(", ")} = donnees departementales, non communales._`);
  }
  lines.push("");

  if (errors.length > 0) {
    lines.push(`\u26A0\uFE0F Communes non trouvees : ${errors.join(", ")}`);
    lines.push("");
  }

  lines.push("_Sources : geo.api.gouv.fr (population/surface), DGFiP REI via data.economie.gouv.fr, DVF via data.gouv.fr, zonage ABC Min. Transition ecologique, Annuaire service-public.fr, Annuaire + Evaluations nationales (IVAL) + Carte scolaire DEPP via data.education.gouv.fr, CNAM via data.ameli.fr (sante), SSMSI via data.gouv.fr (securite), Georisques BRGM/MTE (risques), CNAF data.caf.fr (aide sociale)_");
  return lines.join("\n");
}

function formatCollegesDistrict(colleges: CollegeDistrict[] | null): string {
  if (!colleges || colleges.length === 0) return "N/A";
  return colleges
    .map((c) => c.nom ?? c.codeRne)
    .join(", ");
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
