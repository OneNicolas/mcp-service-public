import { describe, it, expect } from "vitest";

describe("consulter-insertion-professionnelle", () => {
  describe("recherche par ville", () => {
    it("retourne des resultats pour Lyon", async () => {
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ ville: "Lyon", limit: 3 });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Insertion professionnelle");
    });
  });

  describe("recherche par UAI", () => {
    it("retourne une fiche detaillee avec formations", async () => {
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      // Lycee pro Coiffure Lyon (connu dans le dataset)
      const result = await consulterInsertionProfessionnelle({ uai: "0691723Y" });
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("Coiffure");
      expect(text).toContain("Indicateurs globaux");
    });
  });

  describe("UAI inexistant", () => {
    it("retourne un message propre sans crash", async () => {
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ uai: "0000000X" });
      expect(result.content[0].text).toBeTruthy();
      // Pas de crash
    });
  });

  describe("sans parametres", () => {
    it("retourne une erreur explicative", async () => {
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Precisez");
    });
  });

  describe("recherche par code departement", () => {
    it("retourne des resultats pour le 69", async () => {
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ code_departement: "69", limit: 3 });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Insertion professionnelle");
    });
  });

  describe("recherche par texte", () => {
    it("retourne des resultats pour coiffure", async () => {
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ recherche: "coiffure", limit: 3 });
      expect(result.isError).toBeFalsy();
    });
  });
});
