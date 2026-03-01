import type { ToolResult } from "../types.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

// --- Constantes de calcul ---

// Tarifs VLC moyens nationaux (€/m²/an) — catégorie 5-6 (ordinaire/assez confortable)
const TARIF_BASE: Record<string, number> = {
  Appartement: 28,
  Maison: 22,
};

// Prix médians nationaux au m² (DVF 2023-2024) pour calcul du ratio d'ajustement
const PRIX_M2_NATIONAL: Record<string, number> = {
  Appartement: 3800,
  Maison: 2200,
};

// T32 -- Coefficient d'entretien affine : 8 tranches (art. 324 Q annexe III CGI)
// Courbe plus realiste selon l'age du bien
export function getCoefEntretien(anneeConstruction?: number): { coef: number; label: string } {
  if (!anneeConstruction) return { coef: 1.0, label: "standard (non pr\u00e9cis\u00e9)" };
  const age = new Date().getFullYear() - anneeConstruction;
  if (age <= 2) return { coef: 1.20, label: "neuf (moins de 2 ans)" };
  if (age <= 10) return { coef: 1.15, label: "tr\u00e8s bon \u00e9tat (moins de 10 ans)" };
  if (age <= 20) return { coef: 1.10, label: "bon \u00e9tat (10-20 ans)" };
  if (age <= 35) return { coef: 1.05, label: "assez bon \u00e9tat (20-35 ans)" };
  if (age <= 55) return { coef: 1.00, label: "\u00e9tat normal (35-55 ans)" };
  if (age <= 75) return { coef: 0.95, label: "vieillissant (55-75 ans)" };
  if (age <= 100) return { coef: 0.90, label: "v\u00e9tuste (75-100 ans)" };
  return { coef: 0.85, label: "tr\u00e8s v\u00e9tuste (plus de 100 ans)" };
}

// Équivalences superficielles standard pour éléments de confort (art. 324 L annexe III CGI)
export function getSurfacePonderee(surface: number, nbPieces: number): number {
  const equivalencesConfort = nbPieces * 2 + 12;
  return surface + equivalencesConfort;
}

// T32 -- Calcul de l'abattement RP facultatif sur la part communale
// Certaines communes votent un abattement de 50% de la base imposable
// pour la part communale de la TFB (art. 1391 B ter CGI)
export function calcAbattementRP(
  baseImposable: number,
  tauxCommune: number,
): { montantAvecAbattement: number; economie: number } {
  const partCommuneSansAbattement = baseImposable * (tauxCommune / 100);
  // Abattement de 50% sur la base imposable pour la part communale
  const partCommuneAvecAbattement = (baseImposable * 0.5) * (tauxCommune / 100);
  return {
    montantAvecAbattement: partCommuneAvecAbattement,
    economie: partCommuneSansAbattement - partCommuneAvecAbattement,
  };
}

// --- APIs ---

const REI_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";
const DVF_RESOURCE_ID = "d7933994-2c66-4131-a4da-cf7cd18040a4";
const TABULAR_API = `https://tabular-api.data.gouv.fr/api/resources/${DVF_RESOURCE_ID}/data/`;

// PLM : code INSEE unique -> arrondissements DVF
const PLM_ARRONDISSEMENTS: Record<string, string[]> = {
  "75056": Array.from({ length: 20 }, (_, i) => `751${String(i + 1).padStart(2, "0")}`),
  "69123": Array.from({ length: 9 }, (_, i) => `6938${i + 1}`),
  "13055": Array.from({ length: 16 }, (_, i) => `132${String(i + 1).padStart(2, "0")}`),
};

// --- Interface ---

interface SimulerTaxeFonciereArgs {
  commune?: string;
  code_insee?: string;
  code_postal?: string;
  surface: number;
  type_bien: "Maison" | "Appartement";
  nombre_pieces?: number;
  annee_construction?: number;
  residence_principale?: boolean;
}

// --- Fonction principale ---

export async function simulerTaxeFonciere(
  args: SimulerTaxeFonciereArgs,
): Promise<ToolResult> {
  const {
    commune,
    code_insee,
    code_postal,
    surface,
    type_bien,
    nombre_pieces,
    annee_construction,
    residence_principale = false,
  } = args;

  if (!commune && !code_insee && !code_postal) {
    return {
      content: [{ type: "text", text: "Veuillez fournir un nom de commune, un code INSEE ou un code postal." }],
      isError: true,
    };
  }

  if (!surface || surface <= 0) {
    return {
      content: [{ type: "text", text: "La surface habitable doit \u00eatre sup\u00e9rieure \u00e0 0 m\u00b2." }],
      isError: true,
    };
  }

  if (!type_bien || !TARIF_BASE[type_bien]) {
    return {
      content: [{ type: "text", text: "Le type de bien doit \u00eatre \"Maison\" ou \"Appartement\"." }],
      isError: true,
    };
  }

  try {
    const resolved = await resolveCommune(commune, code_insee, code_postal);
    if (!resolved) {
      return {
        content: [{ type: "text", text: "Impossible de r\u00e9soudre la commune. V\u00e9rifiez le nom, code INSEE ou code postal." }],
        isError: true,
      };
    }

    const [reiResult, dvfResult] = await Promise.allSettled([
      fetchTauxREI(resolved.code),
      fetchDvfPrixM2(resolved.code, type_bien),
    ]);

    const tauxTFB = reiResult.status === "fulfilled" ? reiResult.value : null;
    const dvfData = dvfResult.status === "fulfilled" ? dvfResult.value : null;

    if (!tauxTFB) {
      return {
        content: [{
          type: "text",
          text: `Impossible de r\u00e9cup\u00e9rer le taux de taxe fonci\u00e8re pour ${resolved.nom} (${resolved.code}). Les donn\u00e9es REI ne sont peut-\u00eatre pas disponibles pour cette commune.`,
        }],
        isError: true,
      };
    }

    const piecesEstimees = !nombre_pieces;
    const nbPieces = nombre_pieces ?? estimerPieces(surface, type_bien);
    const surfacePonderee = getSurfacePonderee(surface, nbPieces);
    const { coef: coefEntretien, label: labelEntretien } = getCoefEntretien(annee_construction);
    const tarifBase = TARIF_BASE[type_bien];

    let ratioDVF = 1.0;
    let dvfLabel = "non disponible (tarif national moyen appliqu\u00e9)";
    if (dvfData && dvfData.prixM2Median > 0 && dvfData.nbTransactions >= 5) {
      const prixNational = PRIX_M2_NATIONAL[type_bien];
      ratioDVF = Math.max(0.5, Math.min(2.5, dvfData.prixM2Median / prixNational));
      dvfLabel = `${formatEuro(dvfData.prixM2Median)}/m\u00b2 local vs ${formatEuro(prixNational)}/m\u00b2 national \u2192 ratio \u00d7${ratioDVF.toFixed(2)} (${dvfData.nbTransactions} transactions)`;
    }

    const tarifAjuste = tarifBase * ratioDVF;
    const vlcEstimee = surfacePonderee * tarifAjuste * coefEntretien;
    const baseImposable = vlcEstimee * 0.5;
    const tfEstimee = baseImposable * (tauxTFB.tauxGlobal / 100);

    const report = buildSimulationReport({
      communeNom: resolved.nom,
      communeCode: resolved.code,
      exercice: tauxTFB.exercice,
      surface,
      surfacePonderee,
      typeBien: type_bien,
      nbPieces,
      piecesEstimees,
      anneeConstruction: annee_construction,
      coefEntretien,
      labelEntretien,
      tarifBase,
      ratioDVF,
      dvfLabel,
      tarifAjuste,
      vlcEstimee,
      baseImposable,
      tauxTFB: tauxTFB.tauxGlobal,
      tauxCommune: tauxTFB.tauxCommune,
      tauxInterco: tauxTFB.tauxInterco,
      tauxSyndicat: tauxTFB.tauxSyndicat,
      tauxGemapi: tauxTFB.tauxGemapi,
      tauxTasa: tauxTFB.tauxTasa,
      tauxTse: tauxTFB.tauxTse,
      tauxTEOM: tauxTFB.tauxTEOM,
      tfEstimee,
      intercommunalite: tauxTFB.intercommunalite,
      residencePrincipale: residence_principale,
    });

    return { content: [{ type: "text", text: report }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur simulation : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

// --- Résolution commune ---

async function resolveCommune(
  commune?: string,
  codeInsee?: string,
  codePostal?: string,
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

// --- Fetch taux REI ---

interface TauxREI {
  tauxGlobal: number;
  tauxCommune: number;
  tauxInterco: number;
  tauxSyndicat: number;
  tauxGemapi: number;
  tauxTasa: number;
  tauxTse: number;
  exercice: string;
  intercommunalite: string;
  tauxTEOM: number | null;
}

async function fetchTauxREI(codeInsee: string): Promise<TauxREI | null> {
  const params = new URLSearchParams({
    limit: "1",
    select: "exercice,libcom,q03,taux_global_tfb,taux_plein_teom,e12vote,e22,e32vote,e52,e52a,e52tasa,e52ggemapi",
    where: `insee_com="${sanitize(codeInsee)}"`,
    order_by: "exercice DESC",
  });

  const url = `${REI_API}/fiscalite-locale-des-particuliers/records?${params}`;
  const response = await cachedFetch(url, { ttl: CACHE_TTL.REI });
  if (!response.ok) return null;

  const data = (await response.json()) as { results: Record<string, unknown>[] };
  if (!data.results?.length) return null;

  const r = data.results[0];
  return {
    tauxGlobal: Number(r.taux_global_tfb ?? 0),
    tauxCommune: Number(r.e12vote ?? 0),
    tauxInterco: Number(r.e32vote ?? 0),
    tauxSyndicat: Number(r.e22 ?? 0),
    tauxGemapi: Number(r.e52ggemapi ?? 0),
    tauxTasa: Number(r.e52tasa ?? 0),
    tauxTse: Number(r.e52 ?? 0) + Number(r.e52a ?? 0),
    exercice: String(r.exercice ?? ""),
    intercommunalite: String(r.q03 ?? "N/A"),
    tauxTEOM: r.taux_plein_teom ? Number(r.taux_plein_teom) : null,
  };
}

// --- Fetch DVF prix au m² ---

interface DvfPrixM2 {
  prixM2Median: number;
  nbTransactions: number;
}

async function fetchDvfPrixM2(codeInsee: string, typeBien: string): Promise<DvfPrixM2 | null> {
  const arrondissements = PLM_ARRONDISSEMENTS[codeInsee];
  const codesToQuery = arrondissements ? arrondissements.slice(0, 3) : [codeInsee];
  const dateMin = `${new Date().getFullYear() - 2}-01-01`;
  const allPrixM2: number[] = [];

  for (const code of codesToQuery) {
    const params = new URLSearchParams({
      page: "1",
      page_size: "200",
      code_commune__exact: code,
      nature_mutation__exact: "Vente",
      type_local__exact: typeBien,
      date_mutation__greater: dateMin,
    });

    try {
      const response = await cachedFetch(`${TABULAR_API}?${params}`, { ttl: CACHE_TTL.DVF });
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
  const q1 = allPrixM2[Math.floor(allPrixM2.length * 0.25)];
  const q3 = allPrixM2[Math.floor(allPrixM2.length * 0.75)];
  const iqr = q3 - q1;
  const filtered = allPrixM2.filter((v) => v >= q1 - 3 * iqr && v <= q3 + 3 * iqr);

  if (filtered.length < 3) return null;

  return { prixM2Median: median(filtered), nbTransactions: filtered.length };
}

interface DvfRecord {
  id_mutation: string;
  valeur_fonciere: number | null;
  surface_reelle_bati: number | null;
  type_local: string | null;
}

// --- Estimation du nombre de pièces ---

export function estimerPieces(surface: number, typeBien: string): number {
  const surfaceParPiece = typeBien === "Appartement" ? 20 : 25;
  return Math.max(1, Math.round(surface / surfaceParPiece));
}

// --- Rapport de simulation ---

interface SimulationData {
  communeNom: string;
  communeCode: string;
  exercice: string;
  surface: number;
  surfacePonderee: number;
  typeBien: string;
  nbPieces: number;
  piecesEstimees: boolean;
  anneeConstruction?: number;
  coefEntretien: number;
  labelEntretien: string;
  tarifBase: number;
  ratioDVF: number;
  dvfLabel: string;
  tarifAjuste: number;
  vlcEstimee: number;
  baseImposable: number;
  tauxTFB: number;
  tauxCommune: number;
  tauxInterco: number;
  tauxSyndicat: number;
  tauxGemapi: number;
  tauxTasa: number;
  tauxTse: number;
  tauxTEOM: number | null;
  tfEstimee: number;
  intercommunalite: string;
  residencePrincipale: boolean;
}

// Verifie si le bien est eligible a l'exoneration construction neuve (art. 1383 CGI)
export function getExonerationNeuve(anneeConstruction?: number): { eligible: boolean; anneesFin?: number } {
  if (!anneeConstruction) return { eligible: false };
  const anneeCourante = new Date().getFullYear();
  const anneesFin = anneeConstruction + 2;
  if (anneesFin >= anneeCourante) return { eligible: true, anneesFin };
  return { eligible: false };
}

function buildSimulationReport(d: SimulationData): string {
  const lines: string[] = [];

  lines.push(`\uD83C\uDFE0 **Simulation taxe fonci\u00e8re \u2014 ${d.communeNom} (${d.communeCode})**`);
  lines.push("");

  lines.push("**Caract\u00e9ristiques du bien :**");
  lines.push(`  Type : ${d.typeBien}`);
  lines.push(`  Surface habitable : ${d.surface} m\u00b2`);
  lines.push(`  Nombre de pi\u00e8ces : ${d.nbPieces}${d.piecesEstimees ? " (estim\u00e9)" : ""}`);
  if (d.anneeConstruction) lines.push(`  Ann\u00e9e de construction : ${d.anneeConstruction}`);
  lines.push(`  Surface pond\u00e9r\u00e9e : ${d.surfacePonderee} m\u00b2 (surface + \u00e9quivalences confort)`);
  if (d.residencePrincipale) lines.push(`  R\u00e9sidence principale : oui`);
  lines.push("");

  // Exoneration construction neuve
  const exoNeuve = getExonerationNeuve(d.anneeConstruction);
  if (exoNeuve.eligible) {
    lines.push(`\u2139\uFE0F **Exon\u00e9ration construction neuve (art. 1383 CGI)**`);
    lines.push(`  Ce bien peut b\u00e9n\u00e9ficier d'une exon\u00e9ration de TFB pendant 2 ans (jusqu'au 31/12/${exoNeuve.anneesFin}).`);
    lines.push(`  L'exon\u00e9ration s'applique sur la part communale (certaines communes la suppriment).`);
    lines.push(`  La simulation ci-dessous montre le montant hors exon\u00e9ration.`);
    lines.push("");
  }

  lines.push("**D\u00e9tail du calcul :**");
  lines.push(`  1. Tarif VLC de base (${d.typeBien}) : ${d.tarifBase} \u20ac/m\u00b2/an`);
  lines.push(`  2. Ajustement march\u00e9 local (DVF) : ${d.dvfLabel}`);
  lines.push(`  3. Tarif ajust\u00e9 : ${d.tarifAjuste.toFixed(1)} \u20ac/m\u00b2/an`);
  lines.push(`  4. Coefficient d'entretien : \u00d7${d.coefEntretien.toFixed(2)} (${d.labelEntretien})`);
  lines.push(`  5. VLC estim\u00e9e : ${d.surfacePonderee} m\u00b2 \u00d7 ${d.tarifAjuste.toFixed(1)} \u20ac \u00d7 ${d.coefEntretien.toFixed(2)} = **${formatEuro(d.vlcEstimee)}**/an`);
  lines.push(`  6. Base imposable : ${formatEuro(d.vlcEstimee)} \u00d7 50% = **${formatEuro(d.baseImposable)}**`);
  lines.push("");

  // Decomposition des taux et montants par collectivite
  lines.push(`**D\u00e9composition des taux TFB (${d.communeNom}, ${d.exercice}) :**`);
  const tauxDetails = buildTauxDetails(d);
  for (const t of tauxDetails) {
    if (t.taux > 0) {
      lines.push(`  ${t.label} : ${t.taux.toFixed(2)} % \u2192 **${formatEuro(t.montant)}**`);
    }
  }
  lines.push(`  **Total TFB : ${d.tauxTFB.toFixed(2)} % \u2192 ${formatEuro(d.tfEstimee)}**`);
  lines.push("");

  lines.push(`**\u27A1\uFE0F Taxe fonci\u00e8re estim\u00e9e : ${formatEuro(d.tfEstimee)} / an**`);
  lines.push("");

  if (d.tauxTEOM && d.tauxTEOM > 0) {
    const teom = d.baseImposable * (d.tauxTEOM / 100);
    lines.push(`  + TEOM estim\u00e9e (${d.tauxTEOM} %) : ${formatEuro(teom)} / an`);
    lines.push(`  **= Total TF + TEOM : ${formatEuro(d.tfEstimee + teom)} / an**`);
    lines.push("");
  }

  // T32 -- Scenario abattement RP si residence principale et taux commune > 0
  if (d.residencePrincipale && d.tauxCommune > 0) {
    const abattement = calcAbattementRP(d.baseImposable, d.tauxCommune);
    const tfAvecAbattement = d.tfEstimee - abattement.economie;
    lines.push(`**\uD83D\uDCA1 Sc\u00e9nario : si la commune vote l'abattement RP (art. 1391 B ter CGI) :**`);
    lines.push(`  Abattement de 50% sur la base imposable pour la part communale :`);
    lines.push(`  Part commune : ${formatEuro(abattement.montantAvecAbattement)} (au lieu de ${formatEuro(d.baseImposable * d.tauxCommune / 100)})`);
    lines.push(`  \u00c9conomie : **${formatEuro(abattement.economie)}** / an`);
    lines.push(`  **TF avec abattement : ${formatEuro(tfAvecAbattement)} / an**`);
    lines.push(`  \u2139\uFE0F Cet abattement est facultatif. V\u00e9rifiez aupr\u00e8s de votre mairie s'il est vot\u00e9.`);
    lines.push("");
  }

  // Exonerations possibles
  if (d.residencePrincipale) {
    lines.push("**Exon\u00e9rations possibles (r\u00e9sidence principale) :**");
    lines.push("  Les propri\u00e9taires suivants peuvent \u00eatre exon\u00e9r\u00e9s totalement ou partiellement :");
    lines.push("  \u2014 Personnes de 75 ans et plus sous plafond de revenu fiscal de r\u00e9f\u00e9rence");
    lines.push("  \u2014 Titulaires de l'AAH (allocation aux adultes handicap\u00e9s)");
    lines.push("  \u2014 Titulaires de l'ASPA (allocation de solidarit\u00e9 aux personnes \u00e2g\u00e9es)");
    lines.push("  Ces exon\u00e9rations sont automatiques si les conditions sont remplies.");
    lines.push("");
  }

  lines.push(`**Commune :** ${d.communeNom} (${d.communeCode})`);
  lines.push(`  Intercommunalit\u00e9 : ${d.intercommunalite}`);
  lines.push(`  Exercice fiscal de r\u00e9f\u00e9rence : ${d.exercice}`);
  lines.push("");

  lines.push("\u26A0\uFE0F **Estimation indicative uniquement.**");
  lines.push("  La valeur locative cadastrale r\u00e9elle d\u00e9pend de param\u00e8tres internes DGFiP");
  lines.push("  (tarifs communaux de 1970, classement en cat\u00e9gorie, correctifs) non publi\u00e9s.");
  lines.push("  Le taux TFB et la TEOM sont les vrais taux vot\u00e9s par les collectivit\u00e9s.");
  lines.push("  Seul l'avis d'imposition fait foi.");
  lines.push("");
  lines.push("_Sources : DGFiP REI via data.economie.gouv.fr, DVF via data.gouv.fr_");

  return lines.join("\n");
}

// Decompose le taux global en contributions par collectivite
interface TauxDetail {
  label: string;
  taux: number;
  montant: number;
}

function buildTauxDetails(d: SimulationData): TauxDetail[] {
  const base = d.baseImposable;
  return [
    { label: "Commune", taux: d.tauxCommune, montant: base * d.tauxCommune / 100 },
    { label: "Intercommunalit\u00e9 (EPCI)", taux: d.tauxInterco, montant: base * d.tauxInterco / 100 },
    { label: "Syndicat", taux: d.tauxSyndicat, montant: base * d.tauxSyndicat / 100 },
    { label: "GEMAPI", taux: d.tauxGemapi, montant: base * d.tauxGemapi / 100 },
    { label: "TSE (sp\u00e9cial \u00e9quipement)", taux: d.tauxTse, montant: base * d.tauxTse / 100 },
    { label: "TASA", taux: d.tauxTasa, montant: base * d.tauxTasa / 100 },
  ];
}

// --- Utilitaires ---

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export function formatEuro(value: number): string {
  return value.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

export function sanitize(input: string): string {
  return input.replace(/['"\\]/g, "");
}
