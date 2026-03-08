import { describe, it, expect, vi, beforeEach } from "vitest";

// Fixtures realistes basees sur les vraies donnees InserJeunes
const FIXTURE_LYON_LIST = {
  total_count: 2,
  results: [
    {
      uai: "0691723Y",
      libelle: "LP COIFFURE LYON",
      region: "Auvergne-Rhone-Alpes",
      annee: "2022",
      taux_poursuite_etudes: 12,
      taux_emploi_6_mois: 68,
      taux_emploi_6_mois_attendu: 62,
      va_emploi_6_mois: 6,
      part_en_poursuite_d_etudes: 12,
      part_en_emploi_6_mois_apres_la_sortie: 68,
      part_des_autres_situations: 20,
      dont_apprentis_eple: "ensemble",
    },
    {
      uai: "0691234A",
      libelle: "LP AUTOMOBILE LYON",
      region: "Auvergne-Rhone-Alpes",
      annee: "2022",
      taux_poursuite_etudes: 18,
      taux_emploi_6_mois: 72,
      taux_emploi_6_mois_attendu: 70,
      va_emploi_6_mois: 2,
      part_en_poursuite_d_etudes: 18,
      part_en_emploi_6_mois_apres_la_sortie: 72,
      part_des_autres_situations: 10,
      dont_apprentis_eple: "ensemble",
    },
  ],
};

const FIXTURE_UAI_GLOBAL = {
  total_count: 1,
  results: [
    {
      uai: "0691723Y",
      libelle: "LP COIFFURE LYON",
      region: "Auvergne-Rhone-Alpes",
      annee: "2022",
      taux_poursuite_etudes: 12,
      taux_emploi_6_mois: 68,
      taux_emploi_6_mois_attendu: 62,
      va_emploi_6_mois: 6,
      part_en_poursuite_d_etudes: 12,
      part_en_emploi_6_mois_apres_la_sortie: 68,
      part_des_autres_situations: 20,
      dont_apprentis_eple: "ensemble",
    },
  ],
};

const FIXTURE_UAI_FORMATIONS = {
  total_count: 2,
  results: [
    {
      uai: "0691723Y",
      annee: "2022",
      type_diplome: "CAP",
      libelle_formation: "CAP Coiffure",
      taux_poursuite_etudes: 10,
      taux_emploi_6_mois: 70,
      taux_emploi_12_mois: 75,
      taux_emploi_24_mois: 78,
    },
    {
      uai: "0691723Y",
      annee: "2022",
      type_diplome: "BAC PRO",
      libelle_formation: "BAC PRO Metiers de la Coiffure",
      taux_poursuite_etudes: 15,
      taux_emploi_6_mois: 65,
      taux_emploi_12_mois: 72,
      taux_emploi_24_mois: 80,
    },
  ],
};

const FIXTURE_EMPTY = { total_count: 0, results: [] };

// Cree une reponse HTTP-like a partir d'un objet JSON
function mockResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe("consulter-insertion-professionnelle", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("recherche par ville", () => {
    it("retourne des resultats pour Lyon", async () => {
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn().mockResolvedValue(mockResponse(FIXTURE_LYON_LIST)),
        CACHE_TTL: { ANNUAIRE: 3600 },
      }));
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ ville: "Lyon", limit: 3 });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Insertion professionnelle");
    });
  });

  describe("recherche par UAI", () => {
    it("retourne une fiche detaillee avec formations", async () => {
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn()
          .mockResolvedValueOnce(mockResponse(FIXTURE_UAI_GLOBAL))
          .mockResolvedValueOnce(mockResponse(FIXTURE_UAI_FORMATIONS)),
        CACHE_TTL: { ANNUAIRE: 3600 },
      }));
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ uai: "0691723Y" });
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("Coiffure");
      expect(text).toContain("Indicateurs globaux");
    });
  });

  describe("UAI inexistant", () => {
    it("retourne un message propre sans crash", async () => {
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn().mockResolvedValue(mockResponse(FIXTURE_EMPTY)),
        CACHE_TTL: { ANNUAIRE: 3600 },
      }));
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ uai: "0000000X" });
      expect(result.content[0].text).toBeTruthy();
    });
  });

  describe("sans parametres", () => {
    it("retourne une erreur explicative", async () => {
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn(),
        CACHE_TTL: { ANNUAIRE: 3600 },
      }));
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Precisez");
    });
  });

  describe("recherche par code departement", () => {
    it("retourne des resultats pour le 69", async () => {
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn().mockResolvedValue(mockResponse(FIXTURE_LYON_LIST)),
        CACHE_TTL: { ANNUAIRE: 3600 },
      }));
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ code_departement: "69", limit: 3 });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Insertion professionnelle");
    });
  });

  describe("recherche par texte", () => {
    it("retourne des resultats pour coiffure", async () => {
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn().mockResolvedValue(mockResponse(FIXTURE_LYON_LIST)),
        CACHE_TTL: { ANNUAIRE: 3600 },
      }));
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ recherche: "coiffure", limit: 3 });
      expect(result.isError).toBeFalsy();
    });
  });

  describe("erreur HTTP", () => {
    it("retourne une erreur isError:true si l'API echoue", async () => {
      vi.doMock("../../utils/cache.js", () => ({
        cachedFetch: vi.fn().mockResolvedValue(mockResponse({ message: "Internal Server Error" }, false, 500)),
        CACHE_TTL: { ANNUAIRE: 3600 },
      }));
      const { consulterInsertionProfessionnelle } = await import("../consulter-insertion-professionnelle.js");
      const result = await consulterInsertionProfessionnelle({ ville: "Lyon" });
      expect(result.isError).toBe(true);
    });
  });
});
