import { describe, it, expect } from "vitest";
import {
  calculerNbParts,
  calculerIRParPart,
  calculerTMI,
  calculerPlafonnementQF,
  calculerDecote,
  calculerCEHR,
  calculerRevenuFoncierNet,
  calculerMicroBicNet,
  calculerMicroBncNet,
  calculerPFU,
  simulerImpotRevenu,
} from "../simuler-impot-revenu.js";

describe("calculerNbParts", () => {
  it("celibataire sans enfant = 1 part", () => {
    expect(calculerNbParts("celibataire", 0)).toBe(1);
  });

  it("marie sans enfant = 2 parts", () => {
    expect(calculerNbParts("marie", 0)).toBe(2);
  });

  it("pacse sans enfant = 2 parts", () => {
    expect(calculerNbParts("pacse", 0)).toBe(2);
  });

  it("marie 2 enfants = 3 parts", () => {
    expect(calculerNbParts("marie", 2)).toBe(3);
  });

  it("marie 3 enfants = 4 parts", () => {
    expect(calculerNbParts("marie", 3)).toBe(4);
  });

  it("celibataire 1 enfant = 2 parts (parent isole +0.5)", () => {
    expect(calculerNbParts("celibataire", 1)).toBe(2);
  });

  it("divorce 2 enfants = 2.5 parts (parent isole +0.5)", () => {
    expect(calculerNbParts("divorce", 2)).toBe(2.5);
  });

  it("veuf 1 enfant = 2 parts (parent isole +0.5)", () => {
    expect(calculerNbParts("veuf", 1)).toBe(2);
  });
});

describe("calculerIRParPart", () => {
  it("revenu 0 = IR 0", () => {
    expect(calculerIRParPart(0)).toBe(0);
  });

  it("revenu dans la 1ere tranche (< 11497) = IR 0", () => {
    expect(calculerIRParPart(10_000)).toBe(0);
  });

  it("revenu 30 000 — tranches 0% + 11%", () => {
    // 0% sur 0-11497 = 0
    // 11% sur 11497-29315 = 1959.98
    // 30% sur 29315-30000 = 205.5
    // Total = 2165.48 arrondi 2165
    expect(calculerIRParPart(30_000)).toBe(2165);
  });

  it("revenu 50 000 — tranches 0% + 11% + 30%", () => {
    // 0% sur 0-11497 = 0
    // 11% sur 11497-29315 = 1959.98
    // 30% sur 29315-50000 = 6205.5
    // Total = 8165.48 arrondi 8165
    expect(calculerIRParPart(50_000)).toBe(8165);
  });
});

describe("calculerTMI", () => {
  it("TMI 0% pour revenu < 11497", () => {
    expect(calculerTMI(10_000)).toBe(0);
  });

  it("TMI 11% pour revenu 20000", () => {
    expect(calculerTMI(20_000)).toBe(0.11);
  });

  it("TMI 30% pour revenu 50000", () => {
    expect(calculerTMI(50_000)).toBe(0.30);
  });

  it("TMI 41% pour revenu 100000", () => {
    expect(calculerTMI(100_000)).toBe(0.41);
  });

  it("TMI 45% pour revenu 200000", () => {
    expect(calculerTMI(200_000)).toBe(0.45);
  });
});

describe("calculerDecote", () => {
  it("pas de decote si IR >= seuil", () => {
    expect(calculerDecote(2000, false)).toBe(0);
  });

  it("pas de decote si IR = 0", () => {
    expect(calculerDecote(0, false)).toBe(0);
  });

  it("decote pour celibataire avec IR faible", () => {
    // decote = 1929 - 1000 * 0.4525 = 1929 - 452.5 = 1476.5 arrondi 1477
    expect(calculerDecote(1000, false)).toBe(1000); // plafonnee a l'IR
  });

  it("decote pour couple avec IR sous seuil", () => {
    const decote = calculerDecote(2000, true);
    // 3191 - 2000 * 0.4525 = 3191 - 905 = 2286
    // min(2286, 2000) = 2000 (plafonnee a l'IR)
    expect(decote).toBe(2000);
  });
});

describe("calculerCEHR", () => {
  it("pas de CEHR sous 250k (celibataire)", () => {
    expect(calculerCEHR(200_000, false)).toBe(0);
  });

  it("CEHR celibataire 300k = 3% sur 50k", () => {
    expect(calculerCEHR(300_000, false)).toBe(1500);
  });

  it("CEHR celibataire 600k = 3% sur 250k + 4% sur 100k", () => {
    // 3% * 250000 = 7500
    // 4% * 100000 = 4000
    expect(calculerCEHR(600_000, false)).toBe(11500);
  });

  it("pas de CEHR sous 500k (couple)", () => {
    expect(calculerCEHR(400_000, true)).toBe(0);
  });

  it("CEHR couple 700k = 3% sur 200k", () => {
    expect(calculerCEHR(700_000, true)).toBe(6000);
  });
});

describe("calculerPlafonnementQF", () => {
  it("pas de plafonnement sans demi-parts supplementaires", () => {
    const result = calculerPlafonnementQF(50_000, 1, false);
    expect(result.plafonne).toBe(false);
  });

  it("pas de plafonnement pour couple sans enfants", () => {
    const result = calculerPlafonnementQF(60_000, 2, true);
    expect(result.plafonne).toBe(false);
  });
});

// T31 -- Revenus fonciers
describe("calculerRevenuFoncierNet", () => {
  it("micro-foncier : abattement 30%", () => {
    expect(calculerRevenuFoncierNet(10_000, "micro")).toBe(7_000);
  });

  it("micro-foncier : minimum 0", () => {
    expect(calculerRevenuFoncierNet(0, "micro")).toBe(0);
  });

  it("reel positif : montant passe directement", () => {
    expect(calculerRevenuFoncierNet(8_000, "reel")).toBe(8_000);
  });

  it("reel negatif : deficit foncier", () => {
    expect(calculerRevenuFoncierNet(-5_000, "reel")).toBe(-5_000);
  });
});

// T31 -- Micro-BIC / Micro-BNC
describe("calculerMicroBicNet", () => {
  it("abattement 50%", () => {
    expect(calculerMicroBicNet(20_000)).toBe(10_000);
  });

  it("minimum 0", () => {
    expect(calculerMicroBicNet(0)).toBe(0);
  });
});

describe("calculerMicroBncNet", () => {
  it("abattement 34%", () => {
    expect(calculerMicroBncNet(10_000)).toBe(6_600);
  });

  it("minimum 0", () => {
    expect(calculerMicroBncNet(0)).toBe(0);
  });
});

// T31 -- PFU
describe("calculerPFU", () => {
  it("flat tax 30% sur 10000", () => {
    const result = calculerPFU(10_000);
    expect(result.ir).toBe(1_280);   // 12.8%
    expect(result.ps).toBe(1_720);   // 17.2%
    expect(result.total).toBe(3_000); // 30%
  });

  it("flat tax sur 0", () => {
    const result = calculerPFU(0);
    expect(result.total).toBe(0);
  });
});

// Normalise tous les types d'espaces (insecables, narrow no-break, etc.) en espaces simples
function norm(s: string): string {
  return s.replace(/[\s\u00A0\u202F\u2007\u2009]+/g, " ");
}

// T31 -- Integration revenus complementaires dans le simulateur
describe("simulerImpotRevenu -- revenus complementaires", () => {
  it("integre les revenus fonciers micro au bareme", async () => {
    const result = await simulerImpotRevenu({
      revenu_net_imposable: 40_000,
      revenus_fonciers: 10_000,
      regime_foncier: "micro",
    });
    const text = norm(result.content[0].text);
    expect(text).toContain("micro-foncier");
    expect(text).toContain("7 000 EUR net");
    expect(text).toContain("47 000 EUR");
  });

  it("integre le PFU hors bareme", async () => {
    const result = await simulerImpotRevenu({
      revenu_net_imposable: 40_000,
      revenus_capitaux: 10_000,
      regime_capitaux: "pfu",
    });
    const text = norm(result.content[0].text);
    expect(text).toContain("PFU");
    expect(text).toContain("3 000 EUR");
  });

  it("integre capitaux au bareme + PS", async () => {
    const result = await simulerImpotRevenu({
      revenu_net_imposable: 40_000,
      revenus_capitaux: 10_000,
      regime_capitaux: "bareme",
    });
    const text = norm(result.content[0].text);
    expect(text).toContain("bareme");
    expect(text).toContain("50 000 EUR");
    expect(text).toContain("PS capitaux");
  });

  it("integre micro-BIC au bareme", async () => {
    const result = await simulerImpotRevenu({
      revenu_net_imposable: 30_000,
      micro_bic: 20_000,
    });
    const text = norm(result.content[0].text);
    expect(text).toContain("Micro-BIC");
    expect(text).toContain("10 000 EUR net");
    expect(text).toContain("40 000 EUR");
  });

  it("integre micro-BNC au bareme", async () => {
    const result = await simulerImpotRevenu({
      revenu_net_imposable: 30_000,
      micro_bnc: 10_000,
    });
    const text = norm(result.content[0].text);
    expect(text).toContain("Micro-BNC");
    expect(text).toContain("6 600 EUR net");
  });
});
