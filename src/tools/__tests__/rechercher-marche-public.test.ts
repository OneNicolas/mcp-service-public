import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock cachedFetch avant l'import du module
vi.mock("../../utils/cache.js", () => ({
  cachedFetch: vi.fn(),
  CACHE_TTL: { ANNUAIRE: 3600, DVF: 3600, REI: 3600, ZONAGE: 3600 },
}));

import { rechercherMarchePublic } from "../rechercher-marche-public.js";
import { cachedFetch } from "../../utils/cache.js";

const mockFetch = vi.mocked(cachedFetch);

const MOCK_RECORDS = [
  {
    idweb: "23-123456",
    objet: "Travaux de voirie communale - lot 1 enrobe",
    acheteur: "Commune de Rennes",
    code_departement: "35",
    type_avis: "AAC",
    famille: "Travaux",
    dateparution: "2024-03-15T00:00:00Z",
    datelimitereponse: "2024-04-15T00:00:00Z",
    montant: null,
    descripteur_libelle: "Travaux de voirie",
    lieu_execution: "Rennes",
  },
  {
    idweb: "23-654321",
    objet: "Fourniture de materiel informatique",
    acheteur: "Departement du Rhone",
    code_departement: "69",
    type_avis: "APC",
    famille: "Fournitures",
    dateparution: "2024-02-10T00:00:00Z",
    datelimitereponse: null,
    montant: 150000,
    descripteur_libelle: "Materiels informatiques",
    lieu_execution: "Lyon",
  },
];

function mockOkResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

describe("rechercherMarchePublic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne une erreur si aucun critere fourni", async () => {
    const result = await rechercherMarchePublic({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Veuillez fournir");
  });

  it("recherche par mots-cles et retourne des resultats", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 2, results: MOCK_RECORDS }),
    );

    const result = await rechercherMarchePublic({ recherche: "voirie" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("BOAMP");
    expect(text).toContain("Travaux de voirie communale");
    expect(text).toContain("Avis d");
  });

  it("recherche par departement", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_RECORDS[0]] }),
    );

    const result = await rechercherMarchePublic({ departement: "35" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("35");

    // Verifie que le filtre departement est dans l'URL
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("code_departement");
    expect(url).toContain("35");
  });

  it("filtre par type_avis AAC", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_RECORDS[0]] }),
    );

    const result = await rechercherMarchePublic({ type_avis: "AAC", departement: "35" });
    expect(result.isError).toBeFalsy();

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("type_avis");
    expect(url).toContain("AAC");
  });

  it("recherche par acheteur", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_RECORDS[1]] }),
    );

    const result = await rechercherMarchePublic({ acheteur: "Departement du Rhone" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Fourniture de materiel");
  });

  it("affiche le montant quand disponible", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_RECORDS[1]] }),
    );

    const result = await rechercherMarchePublic({ departement: "69" });
    expect(result.content[0].text).toContain("150");
  });

  it("retourne message vide si aucun resultat", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 0, results: [] }),
    );

    const result = await rechercherMarchePublic({ recherche: "inexistant" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Aucun avis");
  });

  it("gere les erreurs HTTP de l'API BOAMP", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    const result = await rechercherMarchePublic({ recherche: "test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Erreur API BOAMP");
  });

  it("gere les exceptions reseau", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await rechercherMarchePublic({ recherche: "test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network failure");
  });

  it("construit l'URL avec order_by dateparution DESC", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_RECORDS[0]] }),
    );

    await rechercherMarchePublic({ recherche: "travaux" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("order_by");
    expect(url).toContain("dateparution");
  });

  it("combine recherche et departement avec AND", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_RECORDS[0]] }),
    );

    await rechercherMarchePublic({ recherche: "voirie", departement: "35" });
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("AND");
    expect(url).toContain("voirie");
    expect(url).toContain("35");
  });
});
