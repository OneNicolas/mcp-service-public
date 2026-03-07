import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractDeptFromInsee } from "../consulter-acces-soins.js";

describe("consulter-acces-soins", () => {
  describe("extractDeptFromInsee", () => {
    it("extrait departement metropole", () => {
      expect(extractDeptFromInsee("75056")).toBe("75");
      expect(extractDeptFromInsee("93010")).toBe("93");
      expect(extractDeptFromInsee("01001")).toBe("01");
      expect(extractDeptFromInsee("69123")).toBe("69");
    });

    it("extrait departement Corse", () => {
      expect(extractDeptFromInsee("2A004")).toBe("2A");
      expect(extractDeptFromInsee("2B033")).toBe("2B");
    });

    it("extrait departement DOM", () => {
      expect(extractDeptFromInsee("97105")).toBe("971");
      expect(extractDeptFromInsee("97209")).toBe("972");
      expect(extractDeptFromInsee("97302")).toBe("973");
      expect(extractDeptFromInsee("97411")).toBe("974");
      expect(extractDeptFromInsee("97608")).toBe("976");
    });
  });

  // Tests de formatage et logique pure (avec mock reseau)
  describe("formatage rapport", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("gere un departement sans donnees", async () => {
      // Mock cachedFetch pour simuler une reponse vide de data.ameli.fr
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn().mockResolvedValue({ results: [], total_count: 0 }),
      }));
      const { consulterAccesSoins } = await import("../consulter-acces-soins.js");
      const result = await consulterAccesSoins({ code_departement: "00" });
      // Departement inexistant : doit retourner un message (pas un crash)
      expect(result.content[0].text).toBeTruthy();
    });
  });
});
