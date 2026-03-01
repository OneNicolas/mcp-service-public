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

// CEHR -- Contribution Exceptionnelle sur les Hauts Revenus
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
  revenus_fonciers?: number;
  regime_foncier?: "micro" | "reel";
  revenus_capitaux?: number;
  regime_capitaux?: "pfu" | "bareme";
  micro_bic?: number;
  micro_bnc?: number;
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

// --- T31 : Abattements micro-regimes et PFU ---

const ABATTEMENT_MICRO_FONCIER = 0.30;
const ABATTEMENT_MICRO_BIC = 0.50;
const ABATTEMENT_MICRO_BNC = 0.34;

const TAUX_PFU_IR = 0.128;   // 12,8% IR
const TAUX_PS = 0.172;        // 17,2% prelevements sociaux

/** Calcule le revenu foncier net selon le regime */
export function calculerRevenuFoncierNet(brut: number, regime: "micro" | "reel"): number {
  if (regime === "micro") {
    return Math.max(0, Math.round(brut * (1 - ABATTEMENT_MICRO_FONCIER)));
  }
  // Reel : montant deja net (peut etre negatif = deficit foncier)
  return Math.round(brut);
}

/** Calcule le revenu micro-BIC net (abattement 50%) */
export function calculerMicroBicNet(brut: number): number {
  return Math.max(0, Math.round(brut * (1 - ABATTEMENT_MICRO_BIC)));
}

/** Calcule le revenu micro-BNC net (abattement 34%) */
export function calculerMicroBncNet(brut: number): number {
  return Math.max(0, Math.round(brut * (1 - ABATTEMENT_MICRO_BNC)));
}

/** Calcule la flat tax (PFU) sur les revenus de capitaux */
export function calculerPFU(montant: number): { ir: number; ps: number; total: number } {
  const ir = Math.round(montant * TAUX_PFU_IR);
  const ps = Math.round(montant * TAUX_PS);
  return { ir, ps, total: ir + ps };
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

  // --- T31 : Revenus complementaires integres au bareme ---
  const detailRevenus: string[] = [];
  let revenuComplementaire = 0;

  // Revenus fonciers
  if (args.revenus_fonciers && args.revenus_fonciers !== 0) {
    const regime = args.regime_foncier ?? "micro";
    const net = calculerRevenuFoncierNet(args.revenus_fonciers, regime);
    revenuComplementaire += net;
    if (regime === "micro") {
      detailRevenus.push(`- **Revenus fonciers** : ${formatEuro(args.revenus_fonciers)} brut -> ${formatEuro(net)} net (micro-foncier, abattement 30 %)`);
    } else if (net < 0) {
      detailRevenus.push(`- **Deficit foncier** : ${formatEuro(net)} (regime reel, imputable sur le revenu global dans la limite de 10 700 EUR)`);
    } else {
      detailRevenus.push(`- **Revenus fonciers** : ${formatEuro(net)} net (regime reel)`);
    }
  }

  // Micro-BIC
  if (args.micro_bic && args.micro_bic > 0) {
    const net = calculerMicroBicNet(args.micro_bic);
    revenuComplementaire += net;
    detailRevenus.push(`- **Micro-BIC** : ${formatEuro(args.micro_bic)} CA -> ${formatEuro(net)} net (abattement 50 %)`);
  }

  // Micro-BNC
  if (args.micro_bnc && args.micro_bnc > 0) {
    const net = calculerMicroBncNet(args.micro_bnc);
    revenuComplementaire += net;
    detailRevenus.push(`- **Micro-BNC** : ${formatEuro(args.micro_bnc)} recettes -> ${formatEuro(net)} net (abattement 34 %)`);
  }

  // Revenus capitaux au bareme (integres au revenu global)
  let capitauxAuBareme = 0;
  if (args.revenus_capitaux && args.revenus_capitaux > 0 && args.regime_capitaux === "bareme") {
    capitauxAuBareme = args.revenus_capitaux;
    revenuComplementaire += capitauxAuBareme;
    detailRevenus.push(`- **Revenus de capitaux (bareme)** : ${formatEuro(capitauxAuBareme)} integres au revenu global (+17,2 % PS a part)`);
  }

  // Revenu total soumis au bareme
  const revenuTotal = Math.max(0, revenu_net_imposable + revenuComplementaire);
  const revenuParPart = revenuTotal / nbParts;

  // --- PFU (flat tax) calcule a part ---
  let pfuDetail: { ir: number; ps: number; total: number } | null = null;
  if (args.revenus_capitaux && args.revenus_capitaux > 0 && (args.regime_capitaux ?? "pfu") === "pfu") {
    pfuDetail = calculerPFU(args.revenus_capitaux);
  }

  // PS sur capitaux au bareme
  let psCapitauxBareme = 0;
  if (capitauxAuBareme > 0) {
    psCapitauxBareme = Math.round(capitauxAuBareme * 0.172);
  }

  // 1. IR brut avec QF
  const { irApresPlafond, plafonne } = calculerPlafonnementQF(
    revenuTotal,
    nbParts,
    isCouple,
  );

  // 2. Decote
  const decote = calculerDecote(irApresPlafond, isCouple);
  const irApresDecote = Math.max(0, irApresPlafond - decote);

  // 3. TMI
  const tmi = calculerTMI(revenuParPart);

  // 4. CEHR (sur le revenu fiscal de reference, inclut capitaux PFU)
  const rfrPourCEHR = revenuTotal + (pfuDetail ? args.revenus_capitaux! : 0);
  const cehr = calculerCEHR(rfrPourCEHR, isCouple);

  // 5. Total
  const irBareme = irApresDecote + cehr;
  const pfuTotal = pfuDetail?.total ?? 0;
  const irNet = irBareme + pfuTotal + psCapitauxBareme;

  // 6. Taux moyen (sur l'ensemble des revenus)
  const revenuTotalPourTaux = revenuTotal + (pfuDetail ? args.revenus_capitaux! : 0);
  const tauxMoyen = revenuTotalPourTaux > 0
    ? ((irNet / revenuTotalPourTaux) * 100).toFixed(1)
    : "0.0";

  // --- Formatage resultat ---
  const lines: string[] = [
    `# Simulation impot sur le revenu 2025 (revenus 2024)`,
    ``,
    `## Parametres`,
    `- **Revenu net imposable (salaires/pensions)** : ${formatEuro(revenu_net_imposable)}`,
  ];

  if (detailRevenus.length > 0) {
    lines.push(...detailRevenus);
    lines.push(`- **Revenu total soumis au bareme** : ${formatEuro(revenuTotal)}`);
  }

  if (pfuDetail) {
    lines.push(`- **Revenus de capitaux (PFU)** : ${formatEuro(args.revenus_capitaux!)} taxes a 30 % (hors bareme)`);
  }

  lines.push(`- **Nombre de parts** : ${nbParts}${situation ? ` (${situation}, ${nb_enfants} enfant${nb_enfants > 1 ? "s" : ""})` : ""}`);
  lines.push(`- **Revenu par part** : ${formatEuro(Math.round(revenuParPart))}`);
  lines.push(``);
  lines.push(`## Resultat`);
  lines.push(`- **TMI (Taux Marginal)** : ${(tmi * 100).toFixed(0)} %`);
  lines.push(`- **IR brut** : ${formatEuro(irApresPlafond)}`);

  if (plafonne) {
    lines.push(`- **Plafonnement QF** : applique (plafond ${formatEuro(PLAFOND_QF_DEMI_PART)}/demi-part)`);
  }

  if (decote > 0) {
    lines.push(`- **Decote** : -${formatEuro(decote)}`);
  }

  lines.push(`- **IR net (bareme)** : ${formatEuro(irApresDecote)}`);

  if (cehr > 0) {
    lines.push(`- **CEHR** : +${formatEuro(cehr)}`);
  }

  if (pfuDetail) {
    lines.push(`- **PFU (flat tax)** : ${formatEuro(pfuDetail.total)} (IR ${formatEuro(pfuDetail.ir)} + PS ${formatEuro(pfuDetail.ps)})`);
  }

  if (psCapitauxBareme > 0) {
    lines.push(`- **PS capitaux (bareme)** : ${formatEuro(psCapitauxBareme)}`);
  }

  lines.push(`- **Total a payer** : ${formatEuro(irNet)}`);
  lines.push(`- **Taux moyen d'imposition** : ${tauxMoyen} %`);

  // Detail bareme
  lines.push(``);
  lines.push(`## Detail du bareme progressif`);
  for (const tranche of TRANCHES_IR) {
    const min = tranche.min;
    const max = tranche.max === Infinity ? "+" : formatEuro(tranche.max);
    const tauxPct = (tranche.taux * 100).toFixed(0);
    const applicable = revenuParPart > min;
    const marker = applicable ? ">>>" : "   ";
    lines.push(`${marker} ${tauxPct} % : ${formatEuro(min)} a ${max}`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`*Estimation indicative basee sur le bareme 2025 (revenus 2024). Ne tient pas compte des reductions/credits d'impot, revenus exceptionnels, prelevement a la source deja verse, ou situations particulieres. Source : article 197 du CGI.*`);

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
