import { describe, it, expect } from "vitest";
import {
  getSurfacePonderee,
  getCoefEntretien,
  estimerPieces,
  getExonerationNeuve,
  calcAbattementRP,
  formatEuro,
  sanitize,
} from "../simuler-taxe-fonciere.js";

describe("getSurfacePonderee", () => {
  it("ajoute les equivalences confort (2m2/piece + 12m2 sanitaires)", () => {
    expect(getSurfacePonderee(70, 3)).toBe(70 + 3 * 2 + 12);
  });

  it("fonctionne pour un studio (1 piece)", () => {
    expect(getSurfacePonderee(25, 1)).toBe(25 + 1 * 2 + 12);
  });
});

describe("getCoefEntretien", () => {
  const anneeCourante = new Date().getFullYear();

  it("retourne 1.0 standard si pas d'annee", () => {
    const result = getCoefEntretien();
    expect(result.coef).toBe(1.0);
  });

  // T32 -- 8 tranches basees sur l'age du bien
  it("retourne 1.20 pour un bien neuf (moins de 2 ans)", () => {
    expect(getCoefEntretien(anneeCourante).coef).toBe(1.20);
    expect(getCoefEntretien(anneeCourante - 1).coef).toBe(1.20);
  });

  it("retourne 1.15 pour un bien de moins de 10 ans", () => {
    expect(getCoefEntretien(anneeCourante - 5).coef).toBe(1.15);
    expect(getCoefEntretien(anneeCourante - 9).coef).toBe(1.15);
  });

  it("retourne 1.10 pour un bien de 10-20 ans", () => {
    expect(getCoefEntretien(anneeCourante - 11).coef).toBe(1.10);
    expect(getCoefEntretien(anneeCourante - 20).coef).toBe(1.10);
  });

  it("retourne 1.05 pour un bien de 20-35 ans", () => {
    expect(getCoefEntretien(anneeCourante - 25).coef).toBe(1.05);
    expect(getCoefEntretien(anneeCourante - 35).coef).toBe(1.05);
  });

  it("retourne 1.00 pour un bien de 35-55 ans", () => {
    expect(getCoefEntretien(anneeCourante - 40).coef).toBe(1.00);
    expect(getCoefEntretien(anneeCourante - 55).coef).toBe(1.00);
  });

  it("retourne 0.95 pour un bien de 55-75 ans", () => {
    expect(getCoefEntretien(anneeCourante - 60).coef).toBe(0.95);
    expect(getCoefEntretien(anneeCourante - 75).coef).toBe(0.95);
  });

  it("retourne 0.90 pour un bien de 75-100 ans", () => {
    expect(getCoefEntretien(anneeCourante - 80).coef).toBe(0.90);
    expect(getCoefEntretien(anneeCourante - 100).coef).toBe(0.90);
  });

  it("retourne 0.85 pour un bien de plus de 100 ans", () => {
    expect(getCoefEntretien(anneeCourante - 120).coef).toBe(0.85);
    expect(getCoefEntretien(1850).coef).toBe(0.85);
  });
});

describe("estimerPieces", () => {
  it("estime les pieces d'un appartement (20m2/piece)", () => {
    expect(estimerPieces(60, "Appartement")).toBe(3);
    expect(estimerPieces(25, "Appartement")).toBe(1);
    expect(estimerPieces(100, "Appartement")).toBe(5);
  });

  it("estime les pieces d'une maison (25m2/piece)", () => {
    expect(estimerPieces(75, "Maison")).toBe(3);
    expect(estimerPieces(125, "Maison")).toBe(5);
  });

  it("retourne au minimum 1 piece", () => {
    expect(estimerPieces(5, "Appartement")).toBe(1);
  });
});

describe("getExonerationNeuve", () => {
  it("retourne non eligible sans annee de construction", () => {
    expect(getExonerationNeuve().eligible).toBe(false);
  });

  it("retourne non eligible pour une construction ancienne", () => {
    expect(getExonerationNeuve(2010).eligible).toBe(false);
  });

  it("retourne eligible pour une construction des 2 dernieres annees", () => {
    const anneeCourante = new Date().getFullYear();
    const result = getExonerationNeuve(anneeCourante - 1);
    expect(result.eligible).toBe(true);
    expect(result.anneesFin).toBe(anneeCourante + 1);
  });

  it("retourne eligible pour une construction de cette annee", () => {
    const anneeCourante = new Date().getFullYear();
    const result = getExonerationNeuve(anneeCourante);
    expect(result.eligible).toBe(true);
    expect(result.anneesFin).toBe(anneeCourante + 2);
  });

  it("retourne non eligible si annee_construction + 2 < annee courante", () => {
    const anneeCourante = new Date().getFullYear();
    expect(getExonerationNeuve(anneeCourante - 3).eligible).toBe(false);
  });
});

// T32 -- Tests abattement RP
describe("calcAbattementRP", () => {
  it("calcule l'economie de 50% sur la part communale", () => {
    const result = calcAbattementRP(1000, 20);
    // Part commune sans abattement : 1000 * 20% = 200
    // Part commune avec abattement : 500 * 20% = 100
    expect(result.montantAvecAbattement).toBe(100);
    expect(result.economie).toBe(100);
  });

  it("fonctionne avec un taux commune a 0", () => {
    const result = calcAbattementRP(1000, 0);
    expect(result.montantAvecAbattement).toBe(0);
    expect(result.economie).toBe(0);
  });

  it("calcule correctement sur une base realiste", () => {
    // Base imposable 2500 EUR, taux commune 15.5%
    const result = calcAbattementRP(2500, 15.5);
    const partSans = 2500 * 15.5 / 100;    // 387.50
    const partAvec = 1250 * 15.5 / 100;    // 193.75
    expect(result.montantAvecAbattement).toBeCloseTo(partAvec, 2);
    expect(result.economie).toBeCloseTo(partSans - partAvec, 2);
  });
});

describe("formatEuro", () => {
  it("formate un montant en euros", () => {
    const result = formatEuro(1234);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("\u20ac");
  });

  it("arrondit a l'entier", () => {
    const result = formatEuro(1234.567);
    expect(result).not.toContain("567");
  });
});

describe("sanitize", () => {
  it("supprime les caracteres dangereux pour les requetes", () => {
    expect(sanitize("test'value")).toBe("testvalue");
    expect(sanitize('test"value')).toBe("testvalue");
    expect(sanitize("test\\value")).toBe("testvalue");
  });

  it("laisse passer les caracteres normaux", () => {
    expect(sanitize("75056")).toBe("75056");
    expect(sanitize("PARIS")).toBe("PARIS");
  });
});
