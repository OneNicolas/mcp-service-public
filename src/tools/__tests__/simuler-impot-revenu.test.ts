import { describe, it, expect } from "vitest";
import {
  calculerNbParts,
  calculerIRParPart,
  calculerTMI,
  calculerPlafonnementQF,
  calculerDecote,
  calculerCEHR,
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
