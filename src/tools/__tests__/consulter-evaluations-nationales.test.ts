import { describe, it, expect } from "vitest";
import { extractDeptFromInsee } from "../consulter-evaluations-nationales.js";
import { classifyQuery, extractCodeDepartement, extractNiveauScolaire } from "../rechercher.js";

describe("extractDeptFromInsee", () => {
  it("extrait 2 chiffres pour metropole", () => {
    expect(extractDeptFromInsee("93010")).toBe("93");
    expect(extractDeptFromInsee("75056")).toBe("75");
    expect(extractDeptFromInsee("01001")).toBe("01");
  });

  it("extrait 3 chiffres pour les DOM", () => {
    expect(extractDeptFromInsee("97105")).toBe("971");
    expect(extractDeptFromInsee("97209")).toBe("972");
    expect(extractDeptFromInsee("97611")).toBe("976");
  });

  it("gere la Corse (2A/2B)", () => {
    expect(extractDeptFromInsee("2A004")).toBe("2A");
    expect(extractDeptFromInsee("2B033")).toBe("2B");
  });
});

describe("extractCodeDepartement", () => {
  it("extrait apres 'departement'", () => {
    expect(extractCodeDepartement("evaluations departement 93")).toBe("93");
    expect(extractCodeDepartement("dept 75")).toBe("75");
    expect(extractCodeDepartement("departement 2A")).toBe("2A");
  });

  it("extrait un numero en fin de query", () => {
    expect(extractCodeDepartement("evaluations nationales 93")).toBe("93");
    expect(extractCodeDepartement("scores 6eme 75")).toBe("75");
    expect(extractCodeDepartement("ips departement 971")).toBe("971");
  });

  it("retourne null sans code valide", () => {
    expect(extractCodeDepartement("evaluations nationales")).toBeNull();
    expect(extractCodeDepartement("scores 6eme Bondy")).toBeNull();
  });

  it("rejette les numeros hors plage departement", () => {
    expect(extractCodeDepartement("evaluations nationales 999")).toBeNull();
    expect(extractCodeDepartement("evaluations nationales 0")).toBeNull();
  });
});

describe("extractNiveauScolaire", () => {
  it("detecte 6eme", () => {
    expect(extractNiveauScolaire("scores 6eme")).toBe("6eme");
    expect(extractNiveauScolaire("resultats sixieme")).toBe("6eme");
  });

  it("detecte CE2", () => {
    expect(extractNiveauScolaire("taux maitrise ce2")).toBe("CE2");
  });

  it("retourne null si aucun niveau", () => {
    expect(extractNiveauScolaire("evaluations nationales 93")).toBeNull();
  });
});

describe("classifyQuery — evaluations_nationales patterns", () => {
  const cases: Array<[string, string]> = [
    ["evaluations nationales 93", "evaluations_nationales"],
    ["evaluation nationale departement 75", "evaluations_nationales"],
    ["scores 6eme Seine-Saint-Denis", "evaluations_nationales"],
    ["resultats CE2 Bondy", "evaluations_nationales"],
    ["IPS departement 93", "evaluations_nationales"],
    ["scores 6eme 75", "evaluations_nationales"],
    ["taux de maitrise CE2 departement 93", "evaluations_nationales"],
    ["niveau scolaire departement 44", "evaluations_nationales"],
  ];

  for (const [query, expected] of cases) {
    it(`"${query}" -> ${expected}`, () => {
      expect(classifyQuery(query)).toBe(expected);
    });
  }
});

describe("classifyQuery — non-confusion avec resultats_lycee", () => {
  it("'resultats bac lycee Lyon' reste resultats_lycee", () => {
    expect(classifyQuery("resultats bac lycee Lyon")).toBe("resultats_lycee");
  });

  it("'classement lycee Paris' reste resultats_lycee", () => {
    expect(classifyQuery("classement lycee Paris")).toBe("resultats_lycee");
  });

  it("'meilleurs lycees Bordeaux' reste resultats_lycee", () => {
    expect(classifyQuery("meilleurs lycees Bordeaux")).toBe("resultats_lycee");
  });
});
