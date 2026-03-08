import { describe, it, expect } from "vitest";
import { suggestAlternative } from "../../utils/suggest-alternative.js";

describe("suggestAlternative", () => {
  it("retourne une suggestion pour consulter_securite", () => {
    const result = suggestAlternative("consulter_securite");
    expect(result).toContain("comparer_communes");
    expect(result).toContain("Alternatives");
  });

  it("retourne une suggestion pour rechercher_marche_public", () => {
    const result = suggestAlternative("rechercher_marche_public");
    expect(result).toContain("rechercher");
    expect(result.length).toBeGreaterThan(0);
  });

  it("retourne plusieurs suggestions pour consulter_acces_soins", () => {
    const result = suggestAlternative("consulter_acces_soins");
    expect(result).toContain("comparer_communes");
  });

  it("retourne une chaine vide pour un outil sans alternative", () => {
    const result = suggestAlternative("outil_inexistant");
    expect(result).toBe("");
  });

  it("retourne une chaine vide pour un outil sans entree dans la map", () => {
    const result = suggestAlternative("simuler_impot_revenu");
    expect(result).toBe("");
  });

  it("accepte un contexte d'erreur optionnel sans planter", () => {
    const result = suggestAlternative("consulter_securite", "code departement invalide");
    expect(result).toBeTruthy();
  });

  it("retourne une suggestion pour consulter_insertion_professionnelle", () => {
    const result = suggestAlternative("consulter_insertion_professionnelle");
    expect(result).toContain("consulter_parcoursup");
    expect(result).toContain("consulter_resultats_lycee");
  });

  it("retourne une suggestion pour rechercher_fiche", () => {
    const result = suggestAlternative("rechercher_fiche");
    expect(result).toContain("rechercher");
    expect(result).toContain("lire_fiche");
  });

  it("retourne une suggestion pour consulter_budget_commune", () => {
    const result = suggestAlternative("consulter_budget_commune");
    expect(result).toContain("comparer_communes");
    expect(result).toContain("consulter_fiscalite_locale");
  });

  it("retourne une suggestion pour rechercher_subvention", () => {
    const result = suggestAlternative("rechercher_subvention");
    expect(result).toContain("rechercher_entreprise");
    expect(result).toContain("rechercher_annonce_legale");
  });

  it("retourne une suggestion pour consulter_sirene_historique", () => {
    const result = suggestAlternative("consulter_sirene_historique");
    expect(result).toContain("rechercher_entreprise");
  });
});
