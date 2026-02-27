import type { ToolResult } from "../types.js";

// --- Bar\u00e8me \u00e9moluments notaire (arr\u00eat\u00e9 28/02/2020, stable depuis 01/03/2020) ---

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
        ? `Au-del\u00e0 de ${formatEuro(seuil)}`
        : `${formatEuro(seuil)} \u2192 ${formatEuro(plafond)}`,
      montant,
    });

    restant -= trancheMax;
    seuil = plafond;
  }

  return { emolumentsHT: totalHT, emolumentsTTC: totalHT * (1 + TVA_TAUX), detail };
}

export function calculerDMTO(prix: number, type: "ancien" | "neuf", tauxMajore: boolean): number {
  if (type === "neuf") return prix * DMTO_NEUF;
  return prix * (tauxMajore ? DMTO_ANCIEN_MAJORE : DMTO_ANCIEN_NORMAL);
}

export function calculerFraisNotaire(args: {
  prix: number;
  type: "ancien" | "neuf";
  tauxMajore?: boolean;
}): {
  dmto: number;
  emolumentsHT: number;
  emolumentsTTC: number;
  csi: number;
  debours: number;
  total: number;
  pourcentagePrix: number;
} {
  const { prix, type, tauxMajore = false } = args;
  const dmto = calculerDMTO(prix, type, tauxMajore);
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
      content: [{ type: "text", text: "Le prix d'achat doit \u00eatre sup\u00e9rieur \u00e0 0 \u20ac." }],
      isError: true,
    };
  }

  if (!type || (type !== "ancien" && type !== "neuf")) {
    return {
      content: [{ type: "text", text: "Le type de bien doit \u00eatre \"ancien\" ou \"neuf\"." }],
      isError: true,
    };
  }

  const isAncien = type === "ancien";
  const resultNormal = calculerFraisNotaire({ prix, type, tauxMajore: false });
  const resultMajore = isAncien ? calculerFraisNotaire({ prix, type, tauxMajore: true }) : null;
  const { emolumentsHT, emolumentsTTC, detail } = calculerEmoluments(prix);
  const csi = Math.max(CSI_MINIMUM, prix * CSI_TAUX);

  const report = buildReport({
    prix, type, departement,
    emolumentsHT, emolumentsTTC, emolumentsDetail: detail,
    csi, debours: DEBOURS_FORFAIT,
    resultNormal, resultMajore,
  });

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
  resultNormal: ReturnType<typeof calculerFraisNotaire>;
  resultMajore: ReturnType<typeof calculerFraisNotaire> | null;
}

function buildReport(d: ReportData): string {
  const lines: string[] = [];

  lines.push(`\ud83c\udfe0 **Simulation frais de notaire \u2014 Bien ${d.type}**`);
  lines.push("");
  lines.push(`**Prix d'achat : ${formatEuro(d.prix)}**`);
  if (d.departement) lines.push(`  D\u00e9partement : ${d.departement}`);
  lines.push("");

  lines.push("**1. Droits de mutation (DMTO) :**");
  if (d.type === "neuf") {
    lines.push(`  Taxe publicit\u00e9 fonci\u00e8re (neuf) : ${(DMTO_NEUF * 100).toFixed(2)} % = **${formatEuro(d.resultNormal.dmto)}**`);
  } else {
    lines.push(`  Taux normal (${(DMTO_ANCIEN_NORMAL * 100).toFixed(2)} %) : ${formatEuro(d.resultNormal.dmto)}`);
    if (d.resultMajore) {
      lines.push(`  Taux major\u00e9 (${(DMTO_ANCIEN_MAJORE * 100).toFixed(2)} %, 83 d\u00e9partements depuis avril 2025) : ${formatEuro(d.resultMajore.dmto)}`);
    }
    lines.push(`  _Note : les primo-acc\u00e9dants sont exempt\u00e9s du taux major\u00e9._`);
  }
  lines.push("");

  lines.push("**2. \u00c9moluments du notaire (bar\u00e8me d\u00e9gressif r\u00e9glement\u00e9) :**");
  for (const t of d.emolumentsDetail) {
    lines.push(`  ${t.tranche} : ${formatEuro(t.montant)}`);
  }
  lines.push(`  Sous-total HT : ${formatEuro(d.emolumentsHT)}`);
  lines.push(`  TVA (20 %) : ${formatEuro(d.emolumentsTTC - d.emolumentsHT)}`);
  lines.push(`  **Total TTC : ${formatEuro(d.emolumentsTTC)}**`);
  lines.push("");

  lines.push("**3. Autres frais :**");
  lines.push(`  Contribution de s\u00e9curit\u00e9 immobili\u00e8re (0,10 %) : ${formatEuro(d.csi)}`);
  lines.push(`  D\u00e9bours et frais divers (estimation) : ${formatEuro(d.debours)}`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`**\u27a1\ufe0f Estimation frais de notaire (taux normal) : ${formatEuro(d.resultNormal.total)} (${d.resultNormal.pourcentagePrix.toFixed(1)} % du prix)**`);
  if (d.resultMajore) {
    lines.push(`**\u27a1\ufe0f Estimation frais de notaire (taux major\u00e9) : ${formatEuro(d.resultMajore.total)} (${d.resultMajore.pourcentagePrix.toFixed(1)} % du prix)**`);
  }
  lines.push("");

  lines.push("\u26a0\ufe0f **Estimation indicative uniquement.**");
  lines.push("  Les frais r\u00e9els d\u00e9pendent du d\u00e9partement, de la situation de l'acqu\u00e9reur");
  lines.push("  (primo-acc\u00e9dant ou non) et des frais sp\u00e9cifiques au dossier.");
  lines.push("  Le notaire peut accorder une remise de 20 % sur ses \u00e9moluments");
  lines.push("  pour les biens > 100 000 \u20ac. Demandez un devis \u00e0 votre notaire.");
  lines.push("");
  lines.push("_Sources : bar\u00e8me art. A444-91 Code de commerce (arr\u00eat\u00e9 28/02/2020), taux DMTO art. 1594 D CGI_");

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
