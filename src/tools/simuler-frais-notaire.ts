import type { ToolResult } from "../types.js";

// --- Bareme emoluments notaire (arrete 28/02/2020, stable depuis 01/03/2020) ---

const TRANCHES_EMOLUMENTS = [
  { plafond: 6_500, taux: 0.03870 },
  { plafond: 17_000, taux: 0.01596 },
  { plafond: 60_000, taux: 0.01064 },
  { plafond: Infinity, taux: 0.00799 },
];

const TVA_TAUX = 0.20;
const CSI_TAUX = 0.001;
const CSI_MINIMUM = 15;
const DEBOURS_FORFAIT = 1_200;

const DMTO_ANCIEN_NORMAL = 0.0581;
const DMTO_ANCIEN_MAJORE = 0.0632;
const DMTO_NEUF = 0.0071;

// T16 -- Departements ayant conserve le taux normal (4,50 % departemental = 5,81 % total)
// Tous les autres (83 departements) sont au taux majore (5,00 % = 6,32 %) depuis avril 2025
// Source : LF 2025 art. 116 (art. 1594 D CGI), deliberations departementales
// Mise a jour : fevrier 2026
const DEPARTEMENTS_TAUX_NORMAL = new Set([
  "01",  // Ain
  "2A",  // Corse-du-Sud
  "2B",  // Haute-Corse
  "22",  // Cotes-d'Armor
  "29",  // Finistere
  "35",  // Ille-et-Vilaine
  "38",  // Isere
  "42",  // Loire
  "44",  // Loire-Atlantique
  "50",  // Manche
  "51",  // Marne
  "56",  // Morbihan
  "63",  // Puy-de-Dome
  "69",  // Rhone / Metropole de Lyon
  "75",  // Paris
  "972", // Martinique
  "973", // Guyane
  "976", // Mayotte
]);

/** T16 -- Determine le taux DMTO applicable selon le departement */
export function getTauxDMTO(departement: string | undefined, type: "ancien" | "neuf"): {
  taux: number;
  isMajore: boolean;
  isExact: boolean;
} {
  if (type === "neuf") {
    return { taux: DMTO_NEUF, isMajore: false, isExact: true };
  }

  if (!departement) {
    return { taux: DMTO_ANCIEN_NORMAL, isMajore: false, isExact: false };
  }

  const dep = normalizeDepartement(departement);
  if (!dep) {
    return { taux: DMTO_ANCIEN_NORMAL, isMajore: false, isExact: false };
  }

  const isNormal = DEPARTEMENTS_TAUX_NORMAL.has(dep);
  return {
    taux: isNormal ? DMTO_ANCIEN_NORMAL : DMTO_ANCIEN_MAJORE,
    isMajore: !isNormal,
    isExact: true,
  };
}

/** Normalise un code departement (accepte "69", "2A", "971", "Rhone", etc.) */
export function normalizeDepartement(input: string): string | null {
  const trimmed = input.trim().toUpperCase();

  // Code postal 5 chiffres -> extraire departement
  if (/^\d{5}$/.test(trimmed)) {
    const prefix2 = trimmed.slice(0, 2);
    if (prefix2 === "97" || prefix2 === "98") return trimmed.slice(0, 3);
    if (prefix2 === "20") {
      const cp = parseInt(trimmed, 10);
      return cp < 20200 ? "2A" : "2B";
    }
    return prefix2;
  }

  // Code departement direct
  if (/^\d{1,3}$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (num >= 1 && num <= 95) return String(num).padStart(2, "0");
    if (num >= 971 && num <= 976) return String(num);
    return null;
  }
  if (/^2[AB]$/i.test(trimmed)) return trimmed;

  return null;
}

// --- Exports pour les tests ---

export function calculerEmoluments(prix: number): {
  emolumentsHT: number;
  emolumentsTTC: number;
  detail: { tranche: string; montant: number }[];
} {
  let restant = prix;
  let seuil = 0;
  let totalHT = 0;
  const detail: { tranche: string; montant: number }[] = [];

  for (const { plafond, taux } of TRANCHES_EMOLUMENTS) {
    const trancheMax = plafond === Infinity ? restant : Math.min(restant, plafond - seuil);
    if (trancheMax <= 0) break;

    const montant = trancheMax * taux;
    totalHT += montant;
    detail.push({
      tranche: plafond === Infinity
        ? `Au-dela de ${formatEuro(seuil)}`
        : `${formatEuro(seuil)} → ${formatEuro(plafond)}`,
      montant,
    });

    restant -= trancheMax;
    seuil = plafond;
  }

  return { emolumentsHT: totalHT, emolumentsTTC: totalHT * (1 + TVA_TAUX), detail };
}

export function calculerDMTO(prix: number, taux: number): number {
  return prix * taux;
}

export function calculerFraisNotaire(args: {
  prix: number;
  tauxDMTO: number;
}): {
  dmto: number;
  emolumentsHT: number;
  emolumentsTTC: number;
  csi: number;
  debours: number;
  total: number;
  pourcentagePrix: number;
} {
  const { prix, tauxDMTO } = args;
  const dmto = calculerDMTO(prix, tauxDMTO);
  const { emolumentsHT, emolumentsTTC } = calculerEmoluments(prix);
  const csi = Math.max(CSI_MINIMUM, prix * CSI_TAUX);
  const total = dmto + emolumentsTTC + csi + DEBOURS_FORFAIT;

  return {
    dmto,
    emolumentsHT,
    emolumentsTTC,
    csi,
    debours: DEBOURS_FORFAIT,
    total,
    pourcentagePrix: (total / prix) * 100,
  };
}

// --- Interface ---

interface SimulerFraisNotaireArgs {
  prix: number;
  type: "ancien" | "neuf";
  departement?: string;
}

// --- Fonction principale ---

export async function simulerFraisNotaire(args: SimulerFraisNotaireArgs): Promise<ToolResult> {
  const { prix, type, departement } = args;

  if (!prix || prix <= 0) {
    return {
      content: [{ type: "text", text: "Le prix d'achat doit etre superieur a 0 €." }],
      isError: true,
    };
  }

  if (!type || (type !== "ancien" && type !== "neuf")) {
    return {
      content: [{ type: "text", text: "Le type de bien doit etre \"ancien\" ou \"neuf\"." }],
      isError: true,
    };
  }

  const dmtoInfo = getTauxDMTO(departement, type);
  const { emolumentsHT, emolumentsTTC, detail } = calculerEmoluments(prix);
  const csi = Math.max(CSI_MINIMUM, prix * CSI_TAUX);

  let report: string;

  if (type === "neuf") {
    const result = calculerFraisNotaire({ prix, tauxDMTO: DMTO_NEUF });
    report = buildReport({
      prix, type, departement,
      emolumentsHT, emolumentsTTC, emolumentsDetail: detail,
      csi, debours: DEBOURS_FORFAIT,
      dmtoInfo,
      resultPrincipal: result,
      resultAlternatif: null,
    });
  } else if (dmtoInfo.isExact) {
    // T16 -- Departement connu : afficher uniquement le taux reel
    const result = calculerFraisNotaire({ prix, tauxDMTO: dmtoInfo.taux });
    report = buildReport({
      prix, type, departement,
      emolumentsHT, emolumentsTTC, emolumentsDetail: detail,
      csi, debours: DEBOURS_FORFAIT,
      dmtoInfo,
      resultPrincipal: result,
      resultAlternatif: null,
    });
  } else {
    // Pas de departement : afficher les deux hypotheses
    const resultNormal = calculerFraisNotaire({ prix, tauxDMTO: DMTO_ANCIEN_NORMAL });
    const resultMajore = calculerFraisNotaire({ prix, tauxDMTO: DMTO_ANCIEN_MAJORE });
    report = buildReport({
      prix, type, departement,
      emolumentsHT, emolumentsTTC, emolumentsDetail: detail,
      csi, debours: DEBOURS_FORFAIT,
      dmtoInfo,
      resultPrincipal: resultNormal,
      resultAlternatif: resultMajore,
    });
  }

  return { content: [{ type: "text", text: report }] };
}

// --- Rapport ---

interface ReportData {
  prix: number;
  type: "ancien" | "neuf";
  departement?: string;
  emolumentsHT: number;
  emolumentsTTC: number;
  emolumentsDetail: { tranche: string; montant: number }[];
  csi: number;
  debours: number;
  dmtoInfo: ReturnType<typeof getTauxDMTO>;
  resultPrincipal: ReturnType<typeof calculerFraisNotaire>;
  resultAlternatif: ReturnType<typeof calculerFraisNotaire> | null;
}

function buildReport(d: ReportData): string {
  const lines: string[] = [];

  lines.push(`🏠 **Simulation frais de notaire — Bien ${d.type}**`);
  lines.push("");
  lines.push(`**Prix d'achat : ${formatEuro(d.prix)}**`);
  if (d.departement) lines.push(`  Departement : ${d.departement}`);
  lines.push("");

  lines.push("**1. Droits de mutation (DMTO) :**");
  if (d.type === "neuf") {
    lines.push(`  Taxe publicite fonciere (neuf) : ${(DMTO_NEUF * 100).toFixed(2)} % = **${formatEuro(d.resultPrincipal.dmto)}**`);
  } else if (d.dmtoInfo.isExact) {
    const label = d.dmtoInfo.isMajore ? "majore" : "normal";
    lines.push(`  Taux ${label} (${(d.dmtoInfo.taux * 100).toFixed(2)} %) : **${formatEuro(d.resultPrincipal.dmto)}**`);
    if (d.dmtoInfo.isMajore) {
      lines.push(`  _Taux majore applicable dans ce departement (LF 2025, temporaire 2025-2027)._`);
      lines.push(`  _Les primo-accedants sont exemptes du taux majore._`);
    }
  } else {
    lines.push(`  Taux normal (${(DMTO_ANCIEN_NORMAL * 100).toFixed(2)} %) : ${formatEuro(d.resultPrincipal.dmto)}`);
    if (d.resultAlternatif) {
      lines.push(`  Taux majore (${(DMTO_ANCIEN_MAJORE * 100).toFixed(2)} %, 83 departements depuis avril 2025) : ${formatEuro(d.resultAlternatif.dmto)}`);
    }
    lines.push(`  _Precisez le departement pour obtenir le taux exact._`);
    lines.push(`  _Les primo-accedants sont exemptes du taux majore._`);
  }
  lines.push("");

  lines.push("**2. Emoluments du notaire (bareme degressif reglemente) :**");
  for (const t of d.emolumentsDetail) {
    lines.push(`  ${t.tranche} : ${formatEuro(t.montant)}`);
  }
  lines.push(`  Sous-total HT : ${formatEuro(d.emolumentsHT)}`);
  lines.push(`  TVA (20 %) : ${formatEuro(d.emolumentsTTC - d.emolumentsHT)}`);
  lines.push(`  **Total TTC : ${formatEuro(d.emolumentsTTC)}**`);
  lines.push("");

  lines.push("**3. Autres frais :**");
  lines.push(`  Contribution de securite immobiliere (0,10 %) : ${formatEuro(d.csi)}`);
  lines.push(`  Debours et frais divers (estimation) : ${formatEuro(d.debours)}`);
  lines.push("");

  lines.push("---");
  lines.push("");

  if (d.dmtoInfo.isExact || d.type === "neuf") {
    lines.push(`**➡️ Estimation frais de notaire : ${formatEuro(d.resultPrincipal.total)} (${d.resultPrincipal.pourcentagePrix.toFixed(1)} % du prix)**`);
  } else {
    lines.push(`**➡️ Estimation frais de notaire (taux normal) : ${formatEuro(d.resultPrincipal.total)} (${d.resultPrincipal.pourcentagePrix.toFixed(1)} % du prix)**`);
    if (d.resultAlternatif) {
      lines.push(`**➡️ Estimation frais de notaire (taux majore) : ${formatEuro(d.resultAlternatif.total)} (${d.resultAlternatif.pourcentagePrix.toFixed(1)} % du prix)**`);
    }
  }
  lines.push("");

  lines.push("⚠️ **Estimation indicative uniquement.**");
  lines.push("  Les frais reels dependent du departement, de la situation de l'acquereur");
  lines.push("  (primo-accedant ou non) et des frais specifiques au dossier.");
  lines.push("  Le notaire peut accorder une remise de 20 % sur ses emoluments");
  lines.push("  pour les biens > 100 000 €. Demandez un devis a votre notaire.");
  lines.push("");
  lines.push("_Sources : bareme art. A444-91 Code de commerce (arrete 28/02/2020), taux DMTO art. 1594 D CGI, LF 2025 art. 116_");

  return lines.join("\n");
}

// --- Utilitaires ---

function formatEuro(value: number): string {
  return value.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}
