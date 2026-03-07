import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks avant imports
vi.mock("../../utils/cache.js", () => ({
  cachedFetch: vi.fn(),
  CACHE_TTL: { ANNUAIRE: 3600, DVF: 3600, REI: 3600, ZONAGE: 3600 },
}));

import { fetchIvalForCompare } from "../consulter-resultats-lycee.js";
import { fetchAideSocialeForCompare } from "../consulter-aide-sociale.js";
import { cachedFetch } from "../../utils/cache.js";

const mockFetch = vi.mocked(cachedFetch);

function mockOkResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data } as Response;
}

// ---------------------------------------------------------------------------
// fetchIvalForCompare
// ---------------------------------------------------------------------------
describe("fetchIvalForCompare", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne null si aucun lycee dans la commune", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ results: [] }));
    const result = await fetchIvalForCompare("75056");
    expect(result).toBeNull();
  });

  it("retourne le meilleur lycee GT de la commune", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({
        results: [
          {
            annee: "2023",
            libelle_uai: "LYCEE HENRI IV",
            secteur: "PU",
            taux_reu_total: 98.5,
            va_reu_total: 12,
            taux_men_total: 85.3,
          },
          {
            annee: "2023",
            libelle_uai: "LYCEE SAINT-LOUIS",
            secteur: "PU",
            taux_reu_total: 96.0,
            va_reu_total: 8,
            taux_men_total: 80.0,
          },
        ],
      }),
    );

    const result = await fetchIvalForCompare("75056");
    expect(result).not.toBeNull();
    expect(result!.nomLycee).toBe("LYCEE HENRI IV");
    expect(result!.tauxReussite).toBe(98.5);
    expect(result!.valeurAjoutee).toBe(12);
    expect(result!.tauxMentions).toBe(85.3);
    expect(result!.annee).toBe("2023");
    expect(result!.secteur).toBe("PU");
  });

  it("gere va_reu_total null", async () => {
    mockFetch.mockResolvedValueOnce(
      mockOkResponse({
        results: [
          {
            annee: "2023",
            libelle_uai: "LYCEE TEST",
            secteur: "PR",
            taux_reu_total: 90.0,
            va_reu_total: null,
            taux_men_total: 70.0,
          },
        ],
      }),
    );

    const result = await fetchIvalForCompare("69123");
    expect(result).not.toBeNull();
    expect(result!.valeurAjoutee).toBeNull();
    expect(result!.tauxReussite).toBe(90.0);
  });

  it("retourne null si l'API echoue", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await fetchIvalForCompare("75056");
    expect(result).toBeNull();
  });

  it("retourne null si l'API renvoie HTTP 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const result = await fetchIvalForCompare("75056");
    expect(result).toBeNull();
  });

  it("utilise code_commune dans le filtre where", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ results: [] }));
    await fetchIvalForCompare("69123");
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("code_commune");
    expect(url).toContain("69123");
  });
});

// ---------------------------------------------------------------------------
// fetchAideSocialeForCompare
// ---------------------------------------------------------------------------
describe("fetchAideSocialeForCompare", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne null si aucune donnee pour le departement", async () => {
    mockFetch.mockResolvedValueOnce(mockOkResponse({ results: [] }));
    const result = await fetchAideSocialeForCompare("99");
    expect(result).toBeNull();
  });

  it("retourne les foyers RSA, AL et AAH de la derniere annee", async () => {
    const rows = [
      { additional_properties: { prestation: "RSA", nb_foy: 12000, nb_pers: 18000, annee: "2023" } },
      { additional_properties: { prestation: "AL",  nb_foy: 25000, nb_pers: 35000, annee: "2023" } },
      { additional_properties: { prestation: "AAH", nb_foy: 5000,  nb_pers: 5200,  annee: "2023" } },
      { additional_properties: { prestation: "AF",  nb_foy: 8000,  nb_pers: 20000, annee: "2023" } },
    ];
    mockFetch.mockResolvedValueOnce(mockOkResponse({ results: rows }));

    const result = await fetchAideSocialeForCompare("69");
    expect(result).not.toBeNull();
    expect(result!.nbFoyersRSA).toBe(12000);
    expect(result!.nbFoyersAPL).toBe(25000);
    expect(result!.nbFoyersAAH).toBe(5000);
    expect(result!.annee).toBe("2023");
  });

  it("prend la derniere annee disponible si plusieurs annees", async () => {
    const rows = [
      { additional_properties: { prestation: "RSA", nb_foy: 10000, nb_pers: 15000, annee: "2022" } },
      { additional_properties: { prestation: "RSA", nb_foy: 11000, nb_pers: 16000, annee: "2023" } },
    ];
    mockFetch.mockResolvedValueOnce(mockOkResponse({ results: rows }));

    const result = await fetchAideSocialeForCompare("75");
    expect(result!.annee).toBe("2023");
    expect(result!.nbFoyersRSA).toBe(11000);
  });

  it("retourne null pour une prestation absente", async () => {
    const rows = [
      { additional_properties: { prestation: "RSA", nb_foy: 5000, nb_pers: 7000, annee: "2023" } },
    ];
    mockFetch.mockResolvedValueOnce(mockOkResponse({ results: rows }));

    const result = await fetchAideSocialeForCompare("01");
    expect(result!.nbFoyersRSA).toBe(5000);
    expect(result!.nbFoyersAPL).toBeNull();
    expect(result!.nbFoyersAAH).toBeNull();
  });

  it("retourne null si l'API echoue", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Timeout"));
    const result = await fetchAideSocialeForCompare("69");
    expect(result).toBeNull();
  });
});
