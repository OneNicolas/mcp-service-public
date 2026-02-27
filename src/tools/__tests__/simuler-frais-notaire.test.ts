import { describe, it, expect } from "vitest";
import {
  calculerEmoluments,
  calculerDMTO,
  calculerFraisNotaire,
  getTauxDMTO,
  normalizeDepartement,
} from "../simuler-frais-notaire.js";

describe("calculerEmoluments", () => {
  it("calcule les emoluments pour un bien a 200 000 EUR", () => {
    const result = calculerEmoluments(200_000);
    // 6500x3.870% + 10500x1.596% + 43000x1.064% + 140000x0.799%
    // = 251.55 + 167.58 + 457.52 + 1118.60 = 1995.25 HT
    expect(result.emolumentsHT).toBeCloseTo(1995.25, 0);
    expect(result.emolumentsTTC).toBeCloseTo(1995.25 * 1.2, 0);
  });

  it("calcule les emoluments pour un bien a 100 000 EUR", () => {
    const result = calculerEmoluments(100_000);
    expect(result.emolumentsHT).toBeCloseTo(1196.25, 0);
  });

  it("calcule les emoluments pour un petit bien a 5 000 EUR", () => {
    const result = calculerEmoluments(5_000);
    expect(result.emolumentsHT).toBeCloseTo(193.50, 0);
  });
});

describe("calculerDMTO", () => {
  it("calcule les DMTO au taux normal (5.81%)", () => {
    expect(calculerDMTO(200_000, 0.0581)).toBeCloseTo(11_620, 0);
  });

  it("calcule les DMTO au taux majore (6.32%)", () => {
    expect(calculerDMTO(200_000, 0.0632)).toBeCloseTo(12_640, 0);
  });

  it("calcule les DMTO neuf (0.71%)", () => {
    expect(calculerDMTO(200_000, 0.0071)).toBeCloseTo(1_420, 0);
  });
});

describe("calculerFraisNotaire", () => {
  it("retourne un total coherent pour un bien ancien a 200 000 EUR (taux normal)", () => {
    const result = calculerFraisNotaire({ prix: 200_000, tauxDMTO: 0.0581 });
    expect(result.total).toBeGreaterThan(14_000);
    expect(result.total).toBeLessThan(17_000);
    expect(result.pourcentagePrix).toBeGreaterThan(7);
    expect(result.pourcentagePrix).toBeLessThan(9);
  });

  it("les frais neuf sont inferieurs aux frais ancien", () => {
    const ancien = calculerFraisNotaire({ prix: 200_000, tauxDMTO: 0.0581 });
    const neuf = calculerFraisNotaire({ prix: 200_000, tauxDMTO: 0.0071 });
    expect(neuf.total).toBeLessThan(ancien.total);
  });

  it("les frais majore sont superieurs aux frais normaux", () => {
    const normal = calculerFraisNotaire({ prix: 200_000, tauxDMTO: 0.0581 });
    const majore = calculerFraisNotaire({ prix: 200_000, tauxDMTO: 0.0632 });
    expect(majore.total).toBeGreaterThan(normal.total);
  });
});

// T16 -- Tests taux DMTO par departement
describe("getTauxDMTO", () => {
  it("retourne le taux neuf pour un bien neuf", () => {
    const result = getTauxDMTO("75", "neuf");
    expect(result.taux).toBeCloseTo(0.0071, 4);
    expect(result.isExact).toBe(true);
  });

  it("retourne le taux normal pour Paris (non majore)", () => {
    const result = getTauxDMTO("75", "ancien");
    expect(result.taux).toBeCloseTo(0.0581, 4);
    expect(result.isMajore).toBe(false);
    expect(result.isExact).toBe(true);
  });

  it("retourne le taux majore pour le Val-de-Marne", () => {
    const result = getTauxDMTO("94", "ancien");
    expect(result.taux).toBeCloseTo(0.0632, 4);
    expect(result.isMajore).toBe(true);
    expect(result.isExact).toBe(true);
  });

  it("retourne le taux normal pour l'Isere (38)", () => {
    const result = getTauxDMTO("38", "ancien");
    expect(result.taux).toBeCloseTo(0.0581, 4);
    expect(result.isMajore).toBe(false);
  });

  it("retourne isExact=false sans departement", () => {
    const result = getTauxDMTO(undefined, "ancien");
    expect(result.isExact).toBe(false);
  });
});

describe("normalizeDepartement", () => {
  it("normalise un code 2 chiffres", () => {
    expect(normalizeDepartement("75")).toBe("75");
    expect(normalizeDepartement("1")).toBe("01");
    expect(normalizeDepartement("69")).toBe("69");
  });

  it("normalise un code postal 5 chiffres", () => {
    expect(normalizeDepartement("75001")).toBe("75");
    expect(normalizeDepartement("93140")).toBe("93");
    expect(normalizeDepartement("97100")).toBe("971");
  });

  it("gere la Corse", () => {
    expect(normalizeDepartement("2A")).toBe("2A");
    expect(normalizeDepartement("20000")).toBe("2A");
    expect(normalizeDepartement("20200")).toBe("2B");
  });

  it("gere les DOM", () => {
    expect(normalizeDepartement("971")).toBe("971");
    expect(normalizeDepartement("97200")).toBe("972");
  });

  it("retourne null pour un code invalide", () => {
    expect(normalizeDepartement("abc")).toBeNull();
    expect(normalizeDepartement("999")).toBeNull();
  });
});
