import { describe, it, expect } from "vitest";
import {
  getSurfacePonderee,
  getCoefEntretien,
  estimerPieces,
  formatEuro,
  sanitize,
} from "../simuler-taxe-fonciere.js";

describe("getSurfacePonderee", () => {
  it("ajoute les \u00e9quivalences confort (2m\u00b2/pi\u00e8ce + 12m\u00b2 sanitaires)", () => {
    expect(getSurfacePonderee(70, 3)).toBe(70 + 3 * 2 + 12);
  });

  it("fonctionne pour un studio (1 pi\u00e8ce)", () => {
    expect(getSurfacePonderee(25, 1)).toBe(25 + 1 * 2 + 12);
  });
});

describe("getCoefEntretien", () => {
  it("retourne 1.0 standard si pas d'ann\u00e9e", () => {
    const result = getCoefEntretien();
    expect(result.coef).toBe(1.0);
  });

  it("retourne 1.15 pour construction r\u00e9cente (>= 2010)", () => {
    expect(getCoefEntretien(2020).coef).toBe(1.15);
    expect(getCoefEntretien(2010).coef).toBe(1.15);
  });

  it("retourne 1.05 pour 1990-2009", () => {
    expect(getCoefEntretien(1995).coef).toBe(1.05);
    expect(getCoefEntretien(1990).coef).toBe(1.05);
  });

  it("retourne 1.00 pour 1970-1989", () => {
    expect(getCoefEntretien(1980).coef).toBe(1.0);
    expect(getCoefEntretien(1970).coef).toBe(1.0);
  });

  it("retourne 0.90 pour avant 1970", () => {
    expect(getCoefEntretien(1950).coef).toBe(0.9);
    expect(getCoefEntretien(1969).coef).toBe(0.9);
  });
});

describe("estimerPieces", () => {
  it("estime les pi\u00e8ces d'un appartement (20m\u00b2/pi\u00e8ce)", () => {
    expect(estimerPieces(60, "Appartement")).toBe(3);
    expect(estimerPieces(25, "Appartement")).toBe(1);
    expect(estimerPieces(100, "Appartement")).toBe(5);
  });

  it("estime les pi\u00e8ces d'une maison (25m\u00b2/pi\u00e8ce)", () => {
    expect(estimerPieces(75, "Maison")).toBe(3);
    expect(estimerPieces(125, "Maison")).toBe(5);
  });

  it("retourne au minimum 1 pi\u00e8ce", () => {
    expect(estimerPieces(5, "Appartement")).toBe(1);
  });
});

describe("formatEuro", () => {
  it("formate un montant en euros", () => {
    const result = formatEuro(1234);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("\u20ac");
  });

  it("arrondit \u00e0 l'entier", () => {
    const result = formatEuro(1234.567);
    expect(result).not.toContain("567");
  });
});

describe("sanitize", () => {
  it("supprime les caract\u00e8res dangereux pour les requ\u00eates", () => {
    expect(sanitize("test'value")).toBe("testvalue");
    expect(sanitize('test"value')).toBe("testvalue");
    expect(sanitize("test\\value")).toBe("testvalue");
  });

  it("laisse passer les caract\u00e8res normaux", () => {
    expect(sanitize("75056")).toBe("75056");
    expect(sanitize("PARIS")).toBe("PARIS");
  });
});
