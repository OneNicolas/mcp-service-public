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

// Coefficient d'entretien selon l'ancienneté (art. 324 Q annexe III CGI)
export function getCoefEntretien(anneeConstruction?: number): { coef: number; label: string } {
  if (!anneeConstruction) return { coef: 1.0, label: "standard (non précisé)" };
  if (anneeConstruction >= 2010) return { coef: 1.15, label: "bon état (construction récente)" };
  if (anneeConstruction >= 1990) return { coef: 1.05, label: "assez bon état" };
  if (anneeConstruction >= 1970) return { coef: 1.00, label: "état normal" };
  return { coef: 0.90, label: "vétuste (avant 1970)" };
}

// Équivalences superficielles standard pour éléments de confort (art. 324 L annexe III CGI)
export function getSurfacePonderee(surface: number, nbPieces: number): number {
  const equivalencesConfort = nbPieces * 2 + 12;
  return surface + equivalencesConfort;
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
      content: [{ type: "text", text: "La surface habitable doit être supérieure à 0 m²." }],
      isError: true,
    };
  }

  if (!type_bien || !TARIF_BASE[type_bien]) {
    return {
      content: [{ type: "text", text: "Le type de bien doit être \"Maison\" ou \"Appartement\"." }],
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
          text: `Impossible de récupérer le taux de taxe foncière pour ${resolved.nom} (${resolved.code}). Les données REI ne sont peut-être pas disponibles pour cette commune.`,
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
    let dvfLabel = "non disponible (tarif national moyen appliqué)";
    if (dvfData && dvfData.prixM2Median > 0 && dvfData.nbTransactions >= 5) {
      const prixNational = PRIX_M2_NATIONAL[type_bien];
      ratioDVF = Math.max(0.5, Math.min(2.5, dvfData.prixM2Median / prixNational));
      dvfLabel = `${formatEuro(dvfData.prixM2Median)}/m² local vs ${formatEuro(prixNational)}/m² national → ratio ×${ratioDVF.toFixed(2)} (${dvfData.nbTransactions} transactions)`;
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

  lines.push(`\uD83C\uDFE0 **Simulation taxe foncière — ${d.communeNom} (${d.communeCode})**`);
  lines.push("");

  lines.push("**Caractéristiques du bien :**");
  lines.push(`  Type : ${d.typeBien}`);
  lines.push(`  Surface habitable : ${d.surface} m²`);
  lines.push(`  Nombre de pièces : ${d.nbPieces}${d.piecesEstimees ? " (estimé)" : ""}`);
  if (d.anneeConstruction) lines.push(`  Année de construction : ${d.anneeConstruction}`);
  lines.push(`  Surface pondérée : ${d.surfacePonderee} m² (surface + équivalences confort)`);
  if (d.residencePrincipale) lines.push(`  Résidence principale : oui`);
  lines.push("");

  // Exoneration construction neuve
  const exoNeuve = getExonerationNeuve(d.anneeConstruction);
  if (exoNeuve.eligible) {
    lines.push(`\u2139\uFE0F **Exonération construction neuve (art. 1383 CGI)**`);
    lines.push(`  Ce bien peut bénéficier d'une exonération de TFB pendant 2 ans (jusqu'au 31/12/${exoNeuve.anneesFin}).`);
    lines.push(`  L'exonération s'applique sur la part communale (certaines communes la suppriment).`);
    lines.push(`  La simulation ci-dessous montre le montant hors exonération.`);
    lines.push("");
  }

  lines.push("**Détail du calcul :**");
  lines.push(`  1. Tarif VLC de base (${d.typeBien}) : ${d.tarifBase} €/m²/an`);
  lines.push(`  2. Ajustement marché local (DVF) : ${d.dvfLabel}`);
  lines.push(`  3. Tarif ajusté : ${d.tarifAjuste.toFixed(1)} €/m²/an`);
  lines.push(`  4. Coefficient d'entretien : ×${d.coefEntretien.toFixed(2)} (${d.labelEntretien})`);
  lines.push(`  5. VLC estimée : ${d.surfacePonderee} m² × ${d.tarifAjuste.toFixed(1)} € × ${d.coefEntretien.toFixed(2)} = **${formatEuro(d.vlcEstimee)}**/an`);
  lines.push(`  6. Base imposable : ${formatEuro(d.vlcEstimee)} × 50% = **${formatEuro(d.baseImposable)}**`);
  lines.push("");

  // Decomposition des taux et montants par collectivite
  lines.push(`**Décomposition des taux TFB (${d.communeNom}, ${d.exercice}) :**`);
  const tauxDetails = buildTauxDetails(d);
  for (const t of tauxDetails) {
    if (t.taux > 0) {
      lines.push(`  ${t.label} : ${t.taux.toFixed(2)} % → **${formatEuro(t.montant)}**`);
    }
  }
  lines.push(`  **Total TFB : ${d.tauxTFB.toFixed(2)} % → ${formatEuro(d.tfEstimee)}**`);
  lines.push("");

  lines.push(`**➡️ Taxe foncière estimée : ${formatEuro(d.tfEstimee)} / an**`);
  lines.push("");

  if (d.tauxTEOM && d.tauxTEOM > 0) {
    const teom = d.baseImposable * (d.tauxTEOM / 100);
    lines.push(`  + TEOM estimée (${d.tauxTEOM} %) : ${formatEuro(teom)} / an`);
    lines.push(`  **= Total TF + TEOM : ${formatEuro(d.tfEstimee + teom)} / an**`);
    lines.push("");
  }

  // Exonerations possibles
  if (d.residencePrincipale) {
    lines.push("**Exonérations possibles (résidence principale) :**");
    lines.push("  Les propriétaires suivants peuvent être exonérés totalement ou partiellement :");
    lines.push("  — Personnes de 75 ans et plus sous plafond de revenu fiscal de référence");
    lines.push("  — Titulaires de l'AAH (allocation aux adultes handicapés)");
    lines.push("  — Titulaires de l'ASPA (allocation de solidarité aux personnes âgées)");
    lines.push("  Ces exonérations sont automatiques si les conditions sont remplies.");
    lines.push("");
  }

  lines.push(`**Commune :** ${d.communeNom} (${d.communeCode})`);
  lines.push(`  Intercommunalité : ${d.intercommunalite}`);
  lines.push(`  Exercice fiscal de référence : ${d.exercice}`);
  lines.push("");

  lines.push("⚠️ **Estimation indicative uniquement.**");
  lines.push("  La valeur locative cadastrale réelle dépend de paramètres internes DGFiP");
  lines.push("  (tarifs communaux de 1970, classement en catégorie, correctifs) non publiés.");
  lines.push("  Le taux TFB et la TEOM sont les vrais taux votés par les collectivités.");
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
    { label: "Intercommunalité (EPCI)", taux: d.tauxInterco, montant: base * d.tauxInterco / 100 },
    { label: "Syndicat", taux: d.tauxSyndicat, montant: base * d.tauxSyndicat / 100 },
    { label: "GEMAPI", taux: d.tauxGemapi, montant: base * d.tauxGemapi / 100 },
    { label: "TSE (spécial équipement)", taux: d.tauxTse, montant: base * d.tauxTse / 100 },
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
