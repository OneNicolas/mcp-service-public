import { describe, it, expect } from "vitest";
import {
  getSurfacePonderee,
  getCoefEntretien,
  estimerPieces,
  formatEuro,
  sanitize,
} from "../simuler-taxe-fonciere.js";

describe("getSurfacePonderee", () => {
  it("ajoute les équivalences confort (2m²/pièce + 12m² sanitaires)", () => {
    expect(getSurfacePonderee(70, 3)).toBe(70 + 3 * 2 + 12);
  });

  it("fonctionne pour un studio (1 pièce)", () => {
    expect(getSurfacePonderee(25, 1)).toBe(25 + 1 * 2 + 12);
  });
});

describe("getCoefEntretien", () => {
  it("retourne 1.0 standard si pas d'année", () => {
    const result = getCoefEntretien();
    expect(result.coef).toBe(1.0);
  });

  it("retourne 1.15 pour construction récente (>= 2010)", () => {
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
  it("estime les pièces d'un appartement (20m²/pièce)", () => {
    expect(estimerPieces(60, "Appartement")).toBe(3);
    expect(estimerPieces(25, "Appartement")).toBe(1);
    expect(estimerPieces(100, "Appartement")).toBe(5);
  });

  it("estime les pièces d'une maison (25m²/pièce)", () => {
    expect(estimerPieces(75, "Maison")).toBe(3);
    expect(estimerPieces(125, "Maison")).toBe(5);
  });

  it("retourne au minimum 1 pièce", () => {
    expect(estimerPieces(5, "Appartement")).toBe(1);
  });
});

describe("formatEuro", () => {
  it("formate un montant en euros", () => {
    const result = formatEuro(1234);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("€");
  });

  it("arrondit à l'entier", () => {
    const result = formatEuro(1234.567);
    expect(result).not.toContain("567");
  });
});

describe("sanitize", () => {
  it("supprime les caractères dangereux pour les requêtes", () => {
    expect(sanitize("test'value")).toBe("testvalue");
    expect(sanitize('test"value')).toBe("testvalue");
    expect(sanitize("test\\value")).toBe("testvalue");
  });

  it("laisse passer les caractères normaux", () => {
    expect(sanitize("75056")).toBe("75056");
    expect(sanitize("PARIS")).toBe("PARIS");
  });
});
