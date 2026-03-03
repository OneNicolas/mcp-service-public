import { describe, it, expect } from "vitest";
import { parseEducationResults } from "../comparer-communes.js";

describe("parseEducationResults — edge cases", () => {
  it("retourne null pour results vide", () => {
    expect(parseEducationResults([])).toBeNull();
  });

  it("retourne null pour results sans type_etablissement", () => {
    const results = [{ some_field: "value" }];
    expect(parseEducationResults(results as any)).toBeNull();
  });

  it("retourne null si aucun type connu (seulement Medico-social)", () => {
    const results = [
      { type_etablissement: "Medico-social", nb: 5 },
    ];
    expect(parseEducationResults(results)).toBeNull();
  });

  it("gere les doublons de type correctement (dernier ecrase)", () => {
    const results = [
      { type_etablissement: "Ecole", nb: 10 },
      { type_etablissement: "Ecole", nb: 5 },
      { type_etablissement: "Coll\u00e8ge", nb: 3 },
    ];
    const parsed = parseEducationResults(results);
    expect(parsed).not.toBeNull();
    // Le dernier "Ecole" ecrase le premier
    expect(parsed!.ecoles).toBe(5);
    expect(parsed!.colleges).toBe(3);
  });

  it("compte correctement ecoles + colleges + lycees", () => {
    const results = [
      { type_etablissement: "Ecole", nb: 20 },
      { type_etablissement: "Coll\u00e8ge", nb: 8 },
      { type_etablissement: "Lyc\u00e9e", nb: 4 },
    ];
    const parsed = parseEducationResults(results);
    expect(parsed).not.toBeNull();
    expect(parsed!.ecoles).toBe(20);
    expect(parsed!.colleges).toBe(8);
    expect(parsed!.lycees).toBe(4);
  });

  it("ignore les types inconnus et retourne les types connus", () => {
    const results = [
      { type_etablissement: "Service Administratif", nb: 2 },
      { type_etablissement: "Coll\u00e8ge", nb: 6 },
      { type_etablissement: "Information et orientation", nb: 1 },
    ];
    const parsed = parseEducationResults(results);
    expect(parsed).not.toBeNull();
    expect(parsed!.ecoles).toBe(0);
    expect(parsed!.colleges).toBe(6);
    expect(parsed!.lycees).toBe(0);
  });

  it("gere nb manquant (default 0)", () => {
    const results = [
      { type_etablissement: "Ecole" },
      { type_etablissement: "Lyc\u00e9e", nb: 3 },
    ];
    const parsed = parseEducationResults(results);
    expect(parsed).not.toBeNull();
    expect(parsed!.ecoles).toBe(0);
    expect(parsed!.lycees).toBe(3);
  });
});
