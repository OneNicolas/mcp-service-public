import type { ToolResult } from "../types.js";

// --- Bareme IR 2025 (revenus 2024) ---

export const TRANCHES_IR = [
  { min: 0, max: 11_497, taux: 0 },
  { min: 11_497, max: 29_315, taux: 0.11 },
  { min: 29_315, max: 83_823, taux: 0.30 },
  { min: 83_823, max: 180_294, taux: 0.41 },
  { min: 180_294, max: Infinity, taux: 0.45 },
] as const;

// Plafond avantage quotient familial par demi-part
const PLAFOND_QF_DEMI_PART = 1_678;

// Seuils de decote
const SEUIL_DECOTE_CELIBATAIRE = 1_929;
const SEUIL_DECOTE_COUPLE = 3_191;

// CEHR — Contribution Exceptionnelle sur les Hauts Revenus
const CEHR_TRANCHES_SEUL = [
  { min: 250_000, max: 500_000, taux: 0.03 },
  { min: 500_000, max: Infinity, taux: 0.04 },
] as const;

const CEHR_TRANCHES_COUPLE = [
  { min: 500_000, max: 1_000_000, taux: 0.03 },
  { min: 1_000_000, max: Infinity, taux: 0.04 },
] as const;

type Situation = "celibataire" | "marie" | "pacse" | "divorce" | "veuf";

interface SimulerIRArgs {
  revenu_net_imposable: number;
  nb_parts?: number;
  situation?: Situation;
  nb_enfants?: number;
}

/** Calcule le nombre de parts fiscales */
export function calculerNbParts(situation: Situation, nbEnfants: number): number {
  const partsBase = (situation === "marie" || situation === "pacse") ? 2 : 1;

  let partsEnfants = 0;
  if (nbEnfants >= 1) partsEnfants += 0.5;
  if (nbEnfants >= 2) partsEnfants += 0.5;
  if (nbEnfants >= 3) partsEnfants += (nbEnfants - 2) * 1; // 1 part entiere a partir du 3e

  // Parent isole : +0.5 part supplementaire
  const isParentIsole = (situation === "celibataire" || situation === "divorce" || situation === "veuf") && nbEnfants > 0;
  if (isParentIsole) partsEnfants += 0.5;

  return partsBase + partsEnfants;
}

/** Applique le bareme progressif sur un revenu par part */
export function calculerIRParPart(revenuParPart: number): number {
  let impot = 0;
  for (const tranche of TRANCHES_IR) {
    if (revenuParPart <= tranche.min) break;
    const assiette = Math.min(revenuParPart, tranche.max) - tranche.min;
    impot += assiette * tranche.taux;
  }
  return Math.round(impot);
}

/** Determine le TMI (Taux Marginal d'Imposition) */
export function calculerTMI(revenuParPart: number): number {
  let tmi = 0;
  for (const tranche of TRANCHES_IR) {
    if (revenuParPart > tranche.min) tmi = tranche.taux;
  }
  return tmi;
}

/** Calcule le plafonnement du quotient familial */
export function calculerPlafonnementQF(
  revenu: number,
  nbParts: number,
  isCouple: boolean,
): { irAvantPlafond: number; irApresPlafond: number; plafonne: boolean } {
  const partsBase = isCouple ? 2 : 1;
  const demiPartsSupp = (nbParts - partsBase) * 2; // nombre de demi-parts supplementaires

  if (demiPartsSupp <= 0) {
    const ir = calculerIRParPart(revenu / nbParts) * nbParts;
    return { irAvantPlafond: ir, irApresPlafond: ir, plafonne: false };
  }

  const irAvecQF = calculerIRParPart(revenu / nbParts) * nbParts;
  const irSansQF = calculerIRParPart(revenu / partsBase) * partsBase;
  const avantageQF = irSansQF - irAvecQF;
  const plafond = demiPartsSupp * PLAFOND_QF_DEMI_PART;

  if (avantageQF > plafond) {
    return {
      irAvantPlafond: irAvecQF,
      irApresPlafond: irSansQF - plafond,
      plafonne: true,
    };
  }

  return { irAvantPlafond: irAvecQF, irApresPlafond: irAvecQF, plafonne: false };
}

/** Calcule la decote */
export function calculerDecote(
  irBrut: number,
  isCouple: boolean,
): number {
  const seuil = isCouple ? SEUIL_DECOTE_COUPLE : SEUIL_DECOTE_CELIBATAIRE;
  if (irBrut >= seuil) return 0;
  if (irBrut === 0) return 0;

  // Decote = seuil - 45,25% de l'IR brut (bareme 2025)
  const decote = Math.round(seuil - irBrut * 0.4525);
  return Math.max(0, Math.min(decote, irBrut));
}

/** Calcule la CEHR */
export function calculerCEHR(revenu: number, isCouple: boolean): number {
  const tranches = isCouple ? CEHR_TRANCHES_COUPLE : CEHR_TRANCHES_SEUL;
  let cehr = 0;
  for (const tranche of tranches) {
    if (revenu <= tranche.min) break;
    const assiette = Math.min(revenu, tranche.max) - tranche.min;
    cehr += assiette * tranche.taux;
  }
  return Math.round(cehr);
}

/** Formatage euro */
function formatEuro(n: number): string {
  return n.toLocaleString("fr-FR") + " EUR";
}

/** Simulateur IR complet */
export async function simulerImpotRevenu(args: SimulerIRArgs): Promise<ToolResult> {
  const { revenu_net_imposable, situation, nb_enfants = 0 } = args;

  if (!revenu_net_imposable || revenu_net_imposable < 0) {
    return {
      content: [{ type: "text", text: "Le revenu net imposable doit etre un nombre positif." }],
      isError: true,
    };
  }

  // Determiner le nombre de parts
  let nbParts: number;
  if (args.nb_parts && args.nb_parts > 0) {
    nbParts = args.nb_parts;
  } else if (situation) {
    nbParts = calculerNbParts(situation, nb_enfants);
  } else {
    nbParts = 1;
  }

  const isCouple = nbParts >= 2 && (situation === "marie" || situation === "pacse");
  const revenuParPart = revenu_net_imposable / nbParts;

  // 1. IR brut avec QF
  const { irApresPlafond, plafonne } = calculerPlafonnementQF(
    revenu_net_imposable,
    nbParts,
    isCouple,
  );

  // 2. Decote
  const decote = calculerDecote(irApresPlafond, isCouple);
  const irApresDecote = Math.max(0, irApresPlafond - decote);

  // 3. TMI
  const tmi = calculerTMI(revenuParPart);

  // 4. CEHR
  const cehr = calculerCEHR(revenu_net_imposable, isCouple);

  // 5. IR net final
  const irNet = irApresDecote + cehr;

  // 6. Taux moyen
  const tauxMoyen = revenu_net_imposable > 0
    ? ((irNet / revenu_net_imposable) * 100).toFixed(1)
    : "0.0";

  // --- Formatage resultat ---
  const lines: string[] = [
    `# Simulation impot sur le revenu 2025 (revenus 2024)`,
    ``,
    `## Parametres`,
    `- **Revenu net imposable** : ${formatEuro(revenu_net_imposable)}`,
    `- **Nombre de parts** : ${nbParts}${situation ? ` (${situation}, ${nb_enfants} enfant${nb_enfants > 1 ? "s" : ""})` : ""}`,
    `- **Revenu par part** : ${formatEuro(Math.round(revenuParPart))}`,
    ``,
    `## Resultat`,
    `- **TMI (Taux Marginal)** : ${(tmi * 100).toFixed(0)} %`,
    `- **IR brut** : ${formatEuro(irApresPlafond)}`,
  ];

  if (plafonne) {
    lines.push(`- **Plafonnement QF** : applique (plafond ${formatEuro(PLAFOND_QF_DEMI_PART)}/demi-part)`);
  }

  if (decote > 0) {
    lines.push(`- **Decote** : -${formatEuro(decote)}`);
  }

  lines.push(`- **IR net** : ${formatEuro(irApresDecote)}`);

  if (cehr > 0) {
    lines.push(`- **CEHR** : +${formatEuro(cehr)}`);
    lines.push(`- **Total (IR + CEHR)** : ${formatEuro(irNet)}`);
  }

  lines.push(`- **Taux moyen d'imposition** : ${tauxMoyen} %`);

  // Detail bareme
  lines.push(``);
  lines.push(`## Detail du bareme progressif`);
  for (const tranche of TRANCHES_IR) {
    const min = tranche.min;
    const max = tranche.max === Infinity ? "+" : formatEuro(tranche.max);
    const tauxPct = (tranche.taux * 100).toFixed(0);
    const applicable = revenuParPart > min;
    const marker = applicable ? "**→**" : " ";
    lines.push(`${marker} ${tauxPct} % : ${formatEuro(min)} a ${max}`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*Estimation indicative basee sur le bareme 2025 (revenus 2024). Ne tient pas compte des reductions/credits d'impot, revenus exceptionnels, ou situations particulieres. Source : article 197 du CGI.*`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
