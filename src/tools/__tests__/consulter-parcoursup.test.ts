import { describe, it, expect } from "vitest";
import { normalizeFiliere } from "../consulter-parcoursup.js";
import { classifyQuery, extractFiliereParcoursup } from "../rechercher.js";

describe("normalizeFiliere", () => {
  it("normalise les filieres connues", () => {
    expect(normalizeFiliere("BUT")).toBe("BUT");
    expect(normalizeFiliere("bts")).toBe("BTS");
    expect(normalizeFiliere("licence")).toBe("Licence");
    expect(normalizeFiliere("cpge")).toBe("CPGE");
    expect(normalizeFiliere("prepa")).toBe("CPGE");
    expect(normalizeFiliere("classe preparatoire")).toBe("CPGE");
    expect(normalizeFiliere("PASS")).toBe("PASS");
    expect(normalizeFiliere("LAS")).toBe("LAS");
    expect(normalizeFiliere("ifsi")).toBe("IFSI");
    expect(normalizeFiliere("infirmier")).toBe("IFSI");
    expect(normalizeFiliere("ingenieur")).toBe("Formation d'ingénieur");
    expect(normalizeFiliere("dn made")).toBe("DN MADE");
    expect(normalizeFiliere("dnmade")).toBe("DN MADE");
    expect(normalizeFiliere("dcg")).toBe("DCG");
  });

  it("retourne null pour filiere inconnue", () => {
    expect(normalizeFiliere("yoga")).toBeNull();
    expect(normalizeFiliere("")).toBeNull();
    expect(normalizeFiliere("master")).toBeNull();
  });
});

describe("extractFiliereParcoursup", () => {
  it("detecte BUT", () => {
    expect(extractFiliereParcoursup("BUT informatique Lyon")).toBe("BUT");
  });

  it("detecte BTS", () => {
    expect(extractFiliereParcoursup("BTS comptabilite a Paris")).toBe("BTS");
  });

  it("detecte CPGE et variantes", () => {
    expect(extractFiliereParcoursup("cpge scientifique")).toBe("CPGE");
    expect(extractFiliereParcoursup("prepa HEC Lyon")).toBe("CPGE");
    expect(extractFiliereParcoursup("classe preparatoire")).toBe("CPGE");
  });

  it("detecte Licence", () => {
    expect(extractFiliereParcoursup("licence droit a Bordeaux")).toBe("Licence");
  });

  it("detecte PASS et LAS", () => {
    expect(extractFiliereParcoursup("PASS medecine Paris")).toBe("PASS");
    expect(extractFiliereParcoursup("LAS sciences")).toBe("LAS");
  });

  it("detecte IFSI", () => {
    expect(extractFiliereParcoursup("IFSI Lyon")).toBe("IFSI");
    expect(extractFiliereParcoursup("formation infirmier")).toBe("IFSI");
  });

  it("detecte ingenieur", () => {
    expect(extractFiliereParcoursup("ecole d'ingenieur Lyon")).toBe("ingenieur");
  });

  it("detecte DN MADE", () => {
    expect(extractFiliereParcoursup("DN MADE design")).toBe("DN MADE");
    expect(extractFiliereParcoursup("dnmade graphisme")).toBe("DN MADE");
  });

  it("retourne null sans filiere", () => {
    expect(extractFiliereParcoursup("formations a Lyon")).toBeNull();
    expect(extractFiliereParcoursup("parcoursup informatique")).toBeNull();
  });
});

describe("classifyQuery — parcoursup patterns", () => {
  const cases: Array<[string, string]> = [
    ["parcoursup informatique Lyon", "parcoursup"],
    ["formations parcoursup a Bordeaux", "parcoursup"],
    ["BTS comptabilite a Paris", "parcoursup"],
    ["BUT informatique Lyon", "parcoursup"],
    ["licence droit a Nantes", "parcoursup"],
    ["CPGE scientifique Lyon", "parcoursup"],
    ["prepa HEC a Paris", "parcoursup"],
    ["PASS medecine Montpellier", "parcoursup"],
    ["etudes superieures Lyon", "parcoursup"],
    ["orientation post-bac", "parcoursup"],
    ["ecole d'ingenieur a Toulouse", "parcoursup"],
    ["IFSI dans le 69", "parcoursup"],
    ["selectivite BTS commerce", "parcoursup"],
    ["taux d'acces licence psychologie", "parcoursup"],
    ["formation superieure informatique", "parcoursup"],
  ];

  for (const [query, expected] of cases) {
    it(`"${query}" -> ${expected}`, () => {
      expect(classifyQuery(query)).toBe(expected);
    });
  }

  // Verifier que les faux positifs ne matchent pas
  const nonParcoursup: Array<[string, string]> = [
    ["ecoles primaires a Bondy", "etablissement_scolaire"],
    ["resultats lycee Lacassagne Lyon", "resultats_lycee"],
    ["evaluations nationales 93", "evaluations_nationales"],
    ["taxe fonciere Lyon", "fiscalite_locale"],
    ["prix immobilier a Bondy", "transactions_dvf"],
  ];

  for (const [query, expected] of nonParcoursup) {
    it(`"${query}" ne matche PAS parcoursup -> ${expected}`, () => {
      expect(classifyQuery(query)).toBe(expected);
    });
  }
});
