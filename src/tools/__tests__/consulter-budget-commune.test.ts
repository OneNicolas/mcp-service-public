import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURE_LYON = {
  total_count: 85,
  results: [
    {
      exer: "2024", com_code: "69123", com_name: "Lyon", dep_code: "69", dep_name: "Rhone",
      reg_code: "84", reg_name: "Auvergne-Rhone-Alpes", epci_code: "200046977",
      epci_name: "Metropole de Lyon", tranche_population: "10", rural: "Non",
      type_de_budget: "Budget principal", nomen: "M57",
      agregat: "Recettes totales", montant: 843869605, euros_par_habitant: 1596, ptot: 528550,
    },
    {
      exer: "2024", com_code: "69123", com_name: "Lyon", dep_code: "69", dep_name: "Rhone",
      reg_code: "84", reg_name: "Auvergne-Rhone-Alpes", epci_code: "200046977",
      epci_name: "Metropole de Lyon", tranche_population: "10",
      type_de_budget: "Budget principal", nomen: "M57",
      agregat: "Depenses totales", montant: 858338150, euros_par_habitant: 1623, ptot: 528550,
    },
    {
      exer: "2024", com_code: "69123", com_name: "Lyon", dep_code: "69", dep_name: "Rhone",
      reg_code: "84", reg_name: "Auvergne-Rhone-Alpes", epci_code: "200046977",
      epci_name: "Metropole de Lyon", tranche_population: "10",
      type_de_budget: "Budget principal", nomen: "M57",
      agregat: "Epargne brute", montant: 106041269, euros_par_habitant: 200, ptot: 528550,
    },
    {
      exer: "2024", com_code: "69123", com_name: "Lyon", dep_code: "69", dep_name: "Rhone",
      reg_code: "84", reg_name: "Auvergne-Rhone-Alpes", epci_code: "200046977",
      epci_name: "Metropole de Lyon", tranche_population: "10",
      type_de_budget: "Budget principal", nomen: "M57",
      agregat: "Encours de dette", montant: 319274272, euros_par_habitant: 604, ptot: 528550,
    },
  ],
};

const FIXTURE_EMPTY = { total_count: 0, results: [] };

function mockOk(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

function mockFail(status = 500) {
  return { ok: false, status, json: async () => ({}), text: async () => "Error" };
}

describe("consulter-budget-commune", () => {
  beforeEach(() => { vi.resetModules(); });

  it("retourne le budget de Lyon", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_LYON)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn().mockResolvedValue({ code: "69123", nom: "Lyon" }),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "Lyon" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Lyon");
    expect(result.content[0].text).toContain("Recettes totales");
    expect(result.content[0].text).toContain("Epargne brute");
  });

  it("retourne le budget via code INSEE", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_LYON)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn(),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ code_insee: "69123" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Encours de dette");
  });

  it("retourne le budget via code postal", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_LYON)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn().mockResolvedValue([{ code: "69123", nom: "Lyon" }]),
      resolveNomCommune: vi.fn(),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ code_postal: "69001" });
    expect(result.isError).toBeFalsy();
  });

  it("retourne une erreur si commune introuvable", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn(), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn().mockResolvedValue([]),
      resolveNomCommune: vi.fn().mockResolvedValue(null),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "XYZ_INEXISTANT" });
    expect(result.isError).toBe(true);
  });

  it("retourne une erreur sans parametre", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn(), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({ resolveCodePostal: vi.fn(), resolveNomCommune: vi.fn() }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("code INSEE");
  });

  it("gere une commune sans donnees (resultats vides)", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_EMPTY)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn().mockResolvedValue({ code: "00000", nom: "Inexistant" }),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "Inexistant" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Aucune donnee");
  });

  it("gere une erreur HTTP API", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockFail(503)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn().mockResolvedValue({ code: "69123", nom: "Lyon" }),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "Lyon" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("503");
  });

  it("filtre par annee specifique", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_LYON)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn().mockResolvedValue({ code: "69123", nom: "Lyon" }),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "Lyon", annee: 2024 });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("2024");
  });

  it("gere une exception reseau", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockRejectedValue(new Error("Network error")), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn().mockResolvedValue({ code: "69123", nom: "Lyon" }),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "Lyon" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network error");
  });

  it("affiche l'epargne nette si disponible", async () => {
    const fixtureWithEpargneNette = {
      ...FIXTURE_LYON,
      results: [...FIXTURE_LYON.results, {
        exer: "2024", com_code: "69123", com_name: "Lyon", dep_code: "69", dep_name: "Rhone",
        reg_code: "84", reg_name: "Auvergne-Rhone-Alpes", epci_code: "200046977",
        epci_name: "Metropole de Lyon", tranche_population: "10",
        type_de_budget: "Budget principal", nomen: "M57",
        agregat: "Epargne nette", montant: 67905001, euros_par_habitant: 128, ptot: 528550,
      }],
    };
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(fixtureWithEpargneNette)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn().mockResolvedValue({ code: "69123", nom: "Lyon" }),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "Lyon" });
    expect(result.content[0].text).toContain("Epargne nette");
  });

  it("affiche euros par habitant", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_LYON)), CACHE_TTL: { REI: 3600 } }));
    vi.doMock("../../utils/geo-api.js", () => ({
      resolveCodePostal: vi.fn(),
      resolveNomCommune: vi.fn().mockResolvedValue({ code: "69123", nom: "Lyon" }),
    }));
    const { consulterBudgetCommune } = await import("../consulter-budget-commune.js");
    const result = await consulterBudgetCommune({ commune: "Lyon" });
    expect(result.content[0].text).toMatch(/€\/hab\./);
  });
});
