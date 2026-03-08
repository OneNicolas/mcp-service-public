import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURE_SUBVENTIONS = {
  data: [
    {
      nomAttribuant: "Commune de Lyon",
      idAttribuant: "21690123100011",
      dateConvention: "2023-03-15",
      referenceDecision: "DEL-2023-145",
      nomBeneficiaire: "Association Sportive Lyonnaise",
      idBeneficiaire: "",
      rnaBeneficiaire: "W691234567",
      objet: "Financement des activites sportives pour les jeunes",
      montant: 45000,
      nature: "Aide",
      conditionsVersement: "En une fois",
      dispositifAide: "",
    },
    {
      nomAttribuant: "Metropole de Lyon",
      idAttribuant: "20004697700013",
      dateConvention: "2023-06-01",
      referenceDecision: "DEL-M-2023-89",
      nomBeneficiaire: "Association Culturelle du Rhone",
      idBeneficiaire: "",
      rnaBeneficiaire: "W691098765",
      objet: "Programme culturel annuel 2023",
      montant: 125000,
      nature: "Aide",
      conditionsVersement: "En deux versements",
      dispositifAide: "Culture et patrimoine",
    },
  ],
  total: 42,
};

const FIXTURE_EMPTY = { data: [], total: 0 };

function mockOk(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => "" };
}

function mockFail(status = 500) {
  return { ok: false, status, json: async () => ({}), text: async () => "Error" };
}

describe("rechercher-subvention", () => {
  beforeEach(() => { vi.resetModules(); });

  it("retourne des subventions pour un beneficiaire", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_SUBVENTIONS)), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "Association Sportive" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Subventions");
    expect(result.content[0].text).toContain("Association Sportive Lyonnaise");
    expect(result.content[0].text).toContain("45");
  });

  it("retourne des subventions pour un attribuant", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_SUBVENTIONS)), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ attribuant: "Metropole de Lyon" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Association Culturelle du Rhone");
    expect(result.content[0].text).toContain("125");
  });

  it("retourne des subventions pour un objet", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_SUBVENTIONS)), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ objet: "culturel" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Programme culturel");
  });

  it("retourne une erreur sans parametre", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn(), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("critere");
  });

  it("gere l'absence de resultats", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_EMPTY)), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "XYZ_INCONNU" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Aucune subvention");
  });

  it("gere une erreur HTTP", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockFail(503)), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "Test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("503");
  });

  it("filtre par montant minimum", async () => {
    vi.doMock("../../utils/cache.js", () => ({
      cachedFetch: vi.fn().mockImplementation((url: string) => {
        expect(url).toContain("montant__gte=50000");
        return Promise.resolve(mockOk(FIXTURE_SUBVENTIONS));
      }),
      CACHE_TTL: { DVF: 3600 },
    }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "Association", montant_min: 50000 });
    expect(result.isError).toBeFalsy();
  });

  it("filtre par annee", async () => {
    vi.doMock("../../utils/cache.js", () => ({
      cachedFetch: vi.fn().mockImplementation((url: string) => {
        expect(url).toContain("dateConvention__gte=2023-01-01");
        return Promise.resolve(mockOk(FIXTURE_SUBVENTIONS));
      }),
      CACHE_TTL: { DVF: 3600 },
    }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "Association", annee: 2023 });
    expect(result.isError).toBeFalsy();
  });

  it("affiche le montant total", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_SUBVENTIONS)), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "Association" });
    expect(result.content[0].text).toContain("Montant total");
  });

  it("gere une exception reseau", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockRejectedValue(new Error("timeout")), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "Test" });
    expect(result.isError).toBe(true);
  });

  it("affiche le RNA si disponible", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_SUBVENTIONS)), CACHE_TTL: { DVF: 3600 } }));
    const { rechercherSubvention } = await import("../rechercher-subvention.js");
    const result = await rechercherSubvention({ beneficiaire: "Association" });
    expect(result.content[0].text).toContain("W691");
  });
});
