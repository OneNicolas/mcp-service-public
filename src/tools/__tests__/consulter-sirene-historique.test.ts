import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURE_ACTIVES = {
  results: [
    {
      siren: "123456789",
      nom_complet: "BOULANGERIE MARTIN",
      nom_raison_sociale: "BOULANGERIE MARTIN",
      etat_administratif: "A",
      date_creation: "2010-03-15",
      date_fermeture: null,
      activite_principale: "10.71C",
      categorie_entreprise: "PME",
      siege: { adresse: "12 Rue du Pain", code_postal: "69001", libelle_commune: "LYON" },
    },
    {
      siren: "987654321",
      nom_complet: "ARTISAN BOULANGER DUPONT",
      nom_raison_sociale: "ARTISAN BOULANGER DUPONT",
      etat_administratif: "A",
      date_creation: "2018-06-01",
      date_fermeture: null,
      activite_principale: "10.71C",
      categorie_entreprise: null,
      siege: { adresse: "5 Place du Marche", code_postal: "69002", libelle_commune: "LYON" },
    },
  ],
  total_results: 150,
  page: 1,
  per_page: 10,
};

const FIXTURE_CESSEE = {
  results: [
    {
      siren: "111222333",
      nom_complet: "ANCIENNE BOULANGERIE",
      nom_raison_sociale: "ANCIENNE BOULANGERIE",
      etat_administratif: "C",
      date_creation: "2005-01-01",
      date_fermeture: "2020-12-31",
      activite_principale: "10.71C",
      categorie_entreprise: null,
      siege: null,
    },
  ],
  total_results: 45,
  page: 1,
  per_page: 10,
};

const FIXTURE_EMPTY = { results: [], total_results: 0, page: 1, per_page: 10 };

function mockOk(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => "" };
}

function mockFail(status = 500) {
  return { ok: false, status, json: async () => ({}), text: async () => "Error" };
}

describe("consulter-sirene-historique", () => {
  beforeEach(() => { vi.resetModules(); });

  it("retourne des entreprises par code NAF", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_ACTIVES)), CACHE_TTL: { ANNUAIRE: 3600 } }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("BOULANGERIE MARTIN");
    expect(result.content[0].text).toContain("150");
  });

  it("filtre par code postal", async () => {
    vi.doMock("../../utils/cache.js", () => ({
      cachedFetch: vi.fn().mockImplementation((url: string) => {
        expect(url).toContain("code_postal=69001");
        return Promise.resolve(mockOk(FIXTURE_ACTIVES));
      }),
      CACHE_TTL: { ANNUAIRE: 3600 },
    }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C", code_postal: "69001" });
    expect(result.isError).toBeFalsy();
  });

  it("filtre les entreprises cessees", async () => {
    vi.doMock("../../utils/cache.js", () => ({
      cachedFetch: vi.fn().mockImplementation((url: string) => {
        expect(url).toContain("etat_administratif=C");
        return Promise.resolve(mockOk(FIXTURE_CESSEE));
      }),
      CACHE_TTL: { ANNUAIRE: 3600 },
    }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C", etat: "cesse" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Cessée");
    expect(result.content[0].text).toContain("2020");
  });

  it("filtre les entreprises actives", async () => {
    vi.doMock("../../utils/cache.js", () => ({
      cachedFetch: vi.fn().mockImplementation((url: string) => {
        expect(url).toContain("etat_administratif=A");
        return Promise.resolve(mockOk(FIXTURE_ACTIVES));
      }),
      CACHE_TTL: { ANNUAIRE: 3600 },
    }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C", etat: "actif" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Active");
  });

  it("filtre par departement", async () => {
    vi.doMock("../../utils/cache.js", () => ({
      cachedFetch: vi.fn().mockImplementation((url: string) => {
        expect(url).toContain("departement=69");
        return Promise.resolve(mockOk(FIXTURE_ACTIVES));
      }),
      CACHE_TTL: { ANNUAIRE: 3600 },
    }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_departement: "69" });
    expect(result.isError).toBeFalsy();
  });

  it("retourne une erreur sans parametre", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn(), CACHE_TTL: { ANNUAIRE: 3600 } }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("critere");
  });

  it("gere une reponse vide", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_EMPTY)), CACHE_TTL: { ANNUAIRE: 3600 } }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "99.99Z" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Aucune entreprise");
  });

  it("gere une erreur HTTP", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockFail(503)), CACHE_TTL: { ANNUAIRE: 3600 } }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C" });
    expect(result.isError).toBe(true);
  });

  it("gere une exception reseau", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockRejectedValue(new Error("timeout")), CACHE_TTL: { ANNUAIRE: 3600 } }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C" });
    expect(result.isError).toBe(true);
  });

  it("affiche les dates de creation et fermeture", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_CESSEE)), CACHE_TTL: { ANNUAIRE: 3600 } }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C", etat: "cesse" });
    expect(result.content[0].text).toContain("Creation");
    expect(result.content[0].text).toContain("Fermeture");
  });

  it("affiche le libelle NAF connu", async () => {
    vi.doMock("../../utils/cache.js", () => ({ cachedFetch: vi.fn().mockResolvedValue(mockOk(FIXTURE_ACTIVES)), CACHE_TTL: { ANNUAIRE: 3600 } }));
    const { consulterSireneHistorique } = await import("../consulter-sirene-historique.js");
    const result = await consulterSireneHistorique({ code_naf: "10.71C" });
    expect(result.content[0].text).toContain("Boulangerie");
  });
});
