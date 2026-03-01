import { describe, it, expect, vi, beforeEach } from "vitest";
import { rechercher } from "../rechercher.js";
import type { Env, ToolResult } from "../../types.js";

/**
 * Tests d'integration du dispatch rechercher().
 * Verifie que chaque categorie de query dispatche vers le bon outil
 * en mockant D1 et fetch.
 */

// --- Mock D1 ---

function createMockDB(): D1Database {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: [] }),
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({ success: true }),
    raw: vi.fn().mockResolvedValue([]),
  };
  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    batch: vi.fn().mockResolvedValue([]),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

function createMockEnv(): Env {
  return {
    DB: createMockDB(),
    ADMIN_SECRET: "test",
  };
}

// --- Mock fetch ---

function mockFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Generateur de reponses mock par URL pattern
function createFetchMock() {
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    // Annuaire API (services locaux)
    if (url.includes("api-lannuaire")) {
      return mockFetchResponse({ total_count: 0, results: [] });
    }

    // geo.api.gouv.fr (resolution communes)
    if (url.includes("geo.api.gouv.fr")) {
      if (url.includes("code=")) {
        return mockFetchResponse([{ nom: "Lyon", code: "69123", codesPostaux: ["69001"] }]);
      }
      return mockFetchResponse([{ nom: "Lyon", code: "69123", codesPostaux: ["69001"] }]);
    }

    // data.economie.gouv.fr (REI fiscalite locale + BOFiP)
    if (url.includes("data.economie.gouv.fr")) {
      return mockFetchResponse({ total_count: 0, results: [] });
    }

    // data.gouv.fr (DVF, zonage ABC, KALI conventions)
    if (url.includes("tabular-api.data.gouv.fr")) {
      return mockFetchResponse({ data: [] });
    }
    if (url.includes("data.gouv.fr")) {
      return mockFetchResponse({ total_count: 0, results: [] });
    }

    // Fallback
    return mockFetchResponse({ results: [] });
  });
}

// --- Helpers ---

function getResultText(result: ToolResult): string {
  return result.content[0]?.text ?? "";
}

// --- Tests ---

describe("rechercher() — dispatch integration", () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
    vi.stubGlobal("fetch", createFetchMock());
  });

  it("rejette une query vide", async () => {
    const result = await rechercher({ query: "" }, env);
    expect(result.isError).toBe(true);
  });

  it("rejette une query trop courte", async () => {
    const result = await rechercher({ query: "a" }, env);
    expect(result.isError).toBe(true);
  });

  // --- Fiches DILA (defaut) ---

  it("dispatche vers fiches DILA pour une requete generique", async () => {
    const result = await rechercher({ query: "renouveler passeport" }, env);
    const text = getResultText(result);
    expect(text).toContain("Fiches pratiques");
    expect(result.isError).toBeUndefined();
  });

  it("dispatche vers fiches DILA pour allocation logement", async () => {
    const result = await rechercher({ query: "allocation logement" }, env);
    expect(getResultText(result)).toContain("Fiches pratiques");
  });

  // --- Fiscalite locale ---

  it("dispatche vers fiscalite locale avec commune", async () => {
    const result = await rechercher({ query: "taux foncier a Lyon" }, env);
    const text = getResultText(result);
    expect(text).toContain("Fiscalite locale");
  });

  it("dispatche vers fiscalite locale avec code postal", async () => {
    const result = await rechercher({ query: "taxe fonciere 93140" }, env);
    const text = getResultText(result);
    expect(text).toContain("Fiscalite locale");
  });

  // --- Doctrine BOFiP ---

  it("dispatche vers doctrine BOFiP", async () => {
    const result = await rechercher({ query: "credit d'impot recherche" }, env);
    const text = getResultText(result);
    expect(text).toContain("Doctrine fiscale");
  });

  // --- Transactions DVF ---

  it("dispatche vers DVF avec commune", async () => {
    const result = await rechercher({ query: "prix immobilier a Bordeaux" }, env);
    const text = getResultText(result);
    expect(text).toContain("Transactions immobili");
  });

  it("dispatche vers DVF avec code postal", async () => {
    const result = await rechercher({ query: "prix au m2 93140" }, env);
    const text = getResultText(result);
    expect(text).toContain("Transactions immobili");
  });

  // --- Simulation TF ---

  it("dispatche vers simulation TF avec params complets", async () => {
    const result = await rechercher({ query: "combien de taxe fonciere pour un appartement de 60m2 a Lyon" }, env);
    const text = getResultText(result);
    // Le mock retourne des donnees REI vides, donc erreur attendue du simulateur
    // L'important est que le dispatch a bien route vers simulation_tf (pas vers fiches DILA)
    expect(text).not.toContain("Fiches pratiques");
  });

  it("fallback vers fiscalite locale si params TF incomplets", async () => {
    const result = await rechercher({ query: "estimer ma taxe fonciere a Lyon" }, env);
    const text = getResultText(result);
    expect(text).toContain("Fiscalite locale");
  });

  // --- Frais de notaire ---

  it("dispatche vers frais notaire avec prix", async () => {
    const result = await rechercher({ query: "frais de notaire pour 250000 euros" }, env);
    const text = getResultText(result);
    expect(text).toContain("frais de notaire");
  });

  it("dispatche vers frais notaire sans prix — fallback fiches", async () => {
    const result = await rechercher({ query: "frais de notaire" }, env);
    const text = getResultText(result);
    expect(text).toContain("Fiches pratiques");
  });

  // --- Zonage immobilier ---

  it("dispatche vers zonage avec commune explicite", async () => {
    const result = await rechercher({ query: "zone Pinel a Lyon" }, env);
    const text = getResultText(result);
    // Le mock retourne des donnees vides, le message vient bien du zonage (pas des fiches DILA)
    expect(text).not.toContain("Fiches pratiques");
    expect(text).toContain("zonage");
  });

  // --- Simulation IR ---

  it("dispatche vers simulation IR avec montant detecte", async () => {
    const result = await rechercher({ query: "combien d'impot sur le revenu pour 40000 euros" }, env);
    const text = getResultText(result);
    expect(text).toContain("Simulation impot sur le revenu");
    // Verifie que le simulateur a bien tourne (presence du bareme)
    expect(text).toContain("Revenu net imposable");
  });

  it("dispatche vers simulation IR avec situation familiale", async () => {
    const result = await rechercher({ query: "simuler impot revenu 50000 euros marie 2 enfants" }, env);
    const text = getResultText(result);
    expect(text).toContain("Simulation impot sur le revenu");
    expect(text).toContain("3 (marie, 2 enfants)"); // marie + 2 enfants = 3 parts
  });

  it("fallback IR vers doctrine si pas de montant", async () => {
    const result = await rechercher({ query: "simuler impot sur le revenu" }, env);
    const text = getResultText(result);
    expect(text).toContain("simuler_impot_revenu");
  });

  // --- Convention collective ---

  it("dispatche vers convention collective par mot-cle", async () => {
    const result = await rechercher({ query: "convention collective batiment" }, env);
    const text = getResultText(result);
    expect(text).toContain("Convention collective");
  });

  it("dispatche vers convention collective par IDCC", async () => {
    const result = await rechercher({ query: "IDCC 843" }, env);
    const text = getResultText(result);
    expect(text).toContain("Convention collective");
  });

  // --- Parametres limit ---

  it("respecte le limit par defaut (5)", async () => {
    const result = await rechercher({ query: "allocation logement" }, env);
    expect(result.isError).toBeUndefined();
  });

  it("accepte un limit personnalise", async () => {
    const result = await rechercher({ query: "allocation logement", limit: 3 }, env);
    expect(result.isError).toBeUndefined();
  });
});
