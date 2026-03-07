import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/cache.js", () => ({
  cachedFetch: vi.fn(),
  CACHE_TTL: { ANNUAIRE: 3600, DVF: 3600, REI: 3600, ZONAGE: 3600 },
}));

import { rechercherAnnonceLegale } from "../rechercher-annonce-legale.js";
import { cachedFetch } from "../../utils/cache.js";

const mockFetch = vi.mocked(cachedFetch);

const MOCK_ANNONCES = [
  {
    numeroannonce: 12345,
    familleavis: "02",
    familleavis_lib: "Immatriculations",
    commercant: "SARL DUPONT ET FILS",
    registre: "75312345678",
    tribunal: "Tribunal de commerce de Paris",
    ville: "PARIS",
    cp: "75010",
    dateparution: "2024-03-20T00:00:00Z",
    acte: { categorie: "Immatriculation", dateDebutActivite: "2024-03-01" },
  },
  {
    numeroannonce: 67890,
    familleavis: "07",
    familleavis_lib: "Procedures collectives",
    commercant: "SAS MARTIN CONSEIL",
    registre: "69123456789",
    tribunal: "Tribunal de commerce de Lyon",
    ville: "LYON",
    cp: "69001",
    dateparution: "2024-02-15T00:00:00Z",
    jugement: { famille: "Liquidation judiciaire", nature: "Ouverture", date: "2024-02-10" },
  },
];

function mockOkResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response;
}

describe("rechercherAnnonceLegale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne une erreur si aucun critere fourni", async () => {
    const result = await rechercherAnnonceLegale({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Veuillez fournir");
  });

  it("recherche par nom d'entreprise", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_ANNONCES[0]] }),
    );

    const result = await rechercherAnnonceLegale({ nom_entreprise: "DUPONT" });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("BODACC");
    expect(text).toContain("SARL DUPONT ET FILS");
    expect(text).toContain("Immatriculations");
  });

  it("recherche par SIREN", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_ANNONCES[0]] }),
    );

    const result = await rechercherAnnonceLegale({ siren: "753123456" });
    expect(result.isError).toBeFalsy();

    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("753123456");
  });

  it("filtre par type_annonce procedure_collective", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_ANNONCES[1]] }),
    );

    const result = await rechercherAnnonceLegale({
      type_annonce: "procedure_collective",
      departement: "69",
    });
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("Procedures collectives");
    expect(text).toContain("SAS MARTIN CONSEIL");
  });

  it("filtre par departement avec cp LIKE", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_ANNONCES[0]] }),
    );

    await rechercherAnnonceLegale({ departement: "75" });
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("cp");
    expect(url).toContain("75%");
  });

  it("affiche les details de jugement (procedure collective)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_ANNONCES[1]] }),
    );

    const result = await rechercherAnnonceLegale({ nom_entreprise: "MARTIN" });
    const text = result.content[0].text;
    expect(text).toContain("Ouverture");
  });

  it("affiche les details d'acte (immatriculation)", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_ANNONCES[0]] }),
    );

    const result = await rechercherAnnonceLegale({ nom_entreprise: "DUPONT" });
    const text = result.content[0].text;
    expect(text).toContain("Immatriculation");
  });

  it("retourne message vide si aucun resultat", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 0, results: [] }),
    );

    const result = await rechercherAnnonceLegale({ siren: "000000000" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Aucune annonce");
  });

  it("gere les erreurs HTTP", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    } as Response);

    const result = await rechercherAnnonceLegale({ nom_entreprise: "test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Erreur API BODACC");
  });

  it("gere les exceptions reseau", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));

    const result = await rechercherAnnonceLegale({ departement: "75" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Timeout");
  });

  it("utilise search(commercant) pour nom_entreprise", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 1, results: [MOCK_ANNONCES[0]] }),
    );

    await rechercherAnnonceLegale({ nom_entreprise: "DUPONT" });
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("search(commercant");
    expect(url).toContain("DUPONT");
  });

  it("filtre par date_debut et date_fin", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({ total_count: 2, results: MOCK_ANNONCES }),
    );

    await rechercherAnnonceLegale({
      nom_entreprise: "SARL",
      date_debut: "2024-01-01",
      date_fin: "2024-12-31",
    });
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("2024-01-01");
    expect(url).toContain("2024-12-31");
  });
});
