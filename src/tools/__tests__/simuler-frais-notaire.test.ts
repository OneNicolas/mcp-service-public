import { describe, it, expect } from "vitest";
import {
  calculerEmoluments,
  calculerDMTO,
  calculerFraisNotaire,
} from "../simuler-frais-notaire.js";

describe("calculerEmoluments", () => {
  it("calcule les \u00e9moluments pour un bien \u00e0 200 000 \u20ac", () => {
    const result = calculerEmoluments(200_000);
    // 6500\u00d73.870% + 10500\u00d71.596% + 43000\u00d71.064% + 140000\u00d70.799%
    // = 251.55 + 167.58 + 457.52 + 1118.60 = 1995.25 HT
    expect(result.emolumentsHT).toBeCloseTo(1995.25, 0);
    expect(result.emolumentsTTC).toBeCloseTo(1995.25 * 1.2, 0);
  });

  it("calcule les \u00e9moluments pour un bien \u00e0 100 000 \u20ac", () => {
    const result = calculerEmoluments(100_000);
    // 6500\u00d73.870% + 10500\u00d71.596% + 43000\u00d71.064% + 40000\u00d70.799%
    // = 251.55 + 167.58 + 457.52 + 319.60 = 1196.25 HT
    expect(result.emolumentsHT).toBeCloseTo(1196.25, 0);
  });

  it("calcule les \u00e9moluments pour un petit bien \u00e0 5 000 \u20ac", () => {
    const result = calculerEmoluments(5_000);
    // 5000\u00d73.870% = 193.50 HT
    expect(result.emolumentsHT).toBeCloseTo(193.50, 0);
  });
});

describe("calculerDMTO", () => {
  it("calcule les DMTO ancien au taux normal (5.81%)", () => {
    expect(calculerDMTO(200_000, "ancien", false)).toBeCloseTo(11_620, 0);
  });

  it("calcule les DMTO ancien au taux major\u00e9 (6.32%)", () => {
    expect(calculerDMTO(200_000, "ancien", true)).toBeCloseTo(12_640, 0);
  });

  it("calcule les DMTO neuf (0.71%)", () => {
    expect(calculerDMTO(200_000, "neuf", false)).toBeCloseTo(1_420, 0);
  });
});

describe("calculerFraisNotaire", () => {
  it("retourne un total coh\u00e9rent pour un bien ancien \u00e0 200 000 \u20ac", () => {
    const result = calculerFraisNotaire({ prix: 200_000, type: "ancien" });
    expect(result.total).toBeGreaterThan(14_000);
    expect(result.total).toBeLessThan(17_000);
    expect(result.pourcentagePrix).toBeGreaterThan(7);
    expect(result.pourcentagePrix).toBeLessThan(9);
  });

  it("les frais neuf sont inf\u00e9rieurs aux frais ancien", () => {
    const ancien = calculerFraisNotaire({ prix: 200_000, type: "ancien" });
    const neuf = calculerFraisNotaire({ prix: 200_000, type: "neuf" });
    expect(neuf.total).toBeLessThan(ancien.total);
  });
});
