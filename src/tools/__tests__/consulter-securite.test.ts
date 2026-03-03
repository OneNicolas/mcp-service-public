import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveCodeDepartement,
  fetchSecuriteData,
  formatSecuriteReport,
  consulterSecurite,
} from "../consulter-securite.js";

// Mock cachedFetch
vi.mock("../../utils/cache.js", () => ({
  cachedFetch: vi.fn(),
  CACHE_TTL: { DVF: 86400, GEO_API: 604800, ANNUAIRE: 86400 },
}));

// Mock geo-api
vi.mock("../../utils/geo-api.js", () => ({
  resolveCodePostal: vi.fn(),
  resolveNomCommune: vi.fn(),
}));

import { cachedFetch } from "../../utils/cache.js";
import { resolveCodePostal, resolveNomCommune } from "../../utils/geo-api.js";

const mockCachedFetch = cachedFetch as ReturnType<typeof vi.fn>;
const mockResolveCP = resolveCodePostal as ReturnType<typeof vi.fn>;
const mockResolveNom = resolveNomCommune as ReturnType<typeof vi.fn>;

const SAMPLE_ROWS_2024 = [
  {
    Code_departement: "75",
    annee: 2024,
    indicateur: "Cambriolages de logement",
    unite_de_compte: "nombre de victimes",
    nombre: 12500,
    taux_pour_mille: 5.72,
    insee_pop: 2187526,
  },
  {
    Code_departement: "75",
    annee: 2024,
    indicateur: "Vols sans violence contre des personnes",
    unite_de_compte: "nombre de victimes",
    nombre: 45000,
    taux_pour_mille: 20.57,
    insee_pop: 2187526,
  },
  {
    Code_departement: "75",
    annee: 2024,
    indicateur: "Violences physiques intrafamiliales",
    unite_de_compte: "nombre de victimes",
    nombre: 8900,
    taux_pour_mille: 4.07,
    insee_pop: 2187526,
  },
];

const SAMPLE_ROWS_2023 = [
  {
    Code_departement: "75",
    annee: 2023,
    indicateur: "Cambriolages de logement",
    unite_de_compte: "nombre de victimes",
    nombre: 14000,
    taux_pour_mille: 6.40,
    insee_pop: 2187526,
  },
  {
    Code_departement: "75",
    annee: 2023,
    indicateur: "Vols sans violence contre des personnes",
    unite_de_compte: "nombre de victimes",
    nombre: 43000,
    taux_pour_mille: 19.66,
    insee_pop: 2187526,
  },
  {
    Code_departement: "75",
    annee: 2023,
    indicateur: "Violences physiques intrafamiliales",
    unite_de_compte: "nombre de victimes",
    nombre: 8900,
    taux_pour_mille: 4.07,
    insee_pop: 2187526,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCodeDepartement", () => {
  it("retourne le code departement direct", async () => {
    const result = await resolveCodeDepartement({ code_departement: "75" });
    expect(result).toBe("75");
  });

  it("resout un code postal vers un departement", async () => {
    mockResolveCP.mockResolvedValue([{ nom: "PARIS", code: "75056", codesPostaux: ["75001"] }]);
    const result = await resolveCodeDepartement({ code_postal: "75001" });
    expect(result).toBe("75");
  });

  it("resout une commune vers un departement", async () => {
    mockResolveNom.mockResolvedValue({ nom: "LYON", code: "69123" });
    const result = await resolveCodeDepartement({ commune: "Lyon" });
    expect(result).toBe("69");
  });

  it("gere la Corse 2A/2B", async () => {
    const result = await resolveCodeDepartement({ code_departement: "2a" });
    expect(result).toBe("2A");
  });

  it("erreur sans parametre", async () => {
    await expect(resolveCodeDepartement({})).rejects.toThrow("Veuillez preciser");
  });

  it("erreur commune introuvable", async () => {
    mockResolveNom.mockResolvedValue(null);
    await expect(resolveCodeDepartement({ commune: "Inexistant" })).rejects.toThrow("Commune non trouvee");
  });
});

describe("fetchSecuriteData", () => {
  it("recupere les donnees pour un departement", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [...SAMPLE_ROWS_2024, ...SAMPLE_ROWS_2023] }),
    });

    const rows = await fetchSecuriteData("75");
    expect(rows).toHaveLength(6);
    expect(mockCachedFetch).toHaveBeenCalledWith(
      expect.stringContaining("Code_departement__exact=75"),
      expect.any(Object),
    );
  });

  it("filtre par annee si fournie", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [...SAMPLE_ROWS_2024, ...SAMPLE_ROWS_2023] }),
    });

    const rows = await fetchSecuriteData("75", 2024);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.annee === 2024)).toBe(true);
  });

  it("retourne vide pour un departement sans donnees", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const rows = await fetchSecuriteData("99");
    expect(rows).toHaveLength(0);
  });

  it("erreur HTTP", async () => {
    mockCachedFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchSecuriteData("75")).rejects.toThrow("HTTP 500");
  });
});

describe("formatSecuriteReport", () => {
  it("formate un rapport avec donnees", () => {
    const allRows = [...SAMPLE_ROWS_2024, ...SAMPLE_ROWS_2023];
    const report = formatSecuriteReport("75", allRows);

    expect(report).toContain("Departement 75");
    expect(report).toContain("2024");
    expect(report).toContain("Cambriolages de logement");
    expect(report).toContain("Vols sans violence");
    expect(report).toContain("SSMSI");
    expect(report).toContain("Ministere de l'Interieur");
  });

  it("affiche l'evolution vs annee precedente", () => {
    const allRows = [...SAMPLE_ROWS_2024, ...SAMPLE_ROWS_2023];
    const report = formatSecuriteReport("75", allRows);

    // Cambriolages : 12500 vs 14000 = -10.7%
    expect(report).toMatch(/-10\.\d+ %/);
  });

  it("affiche stable si variation < 0.5%", () => {
    const allRows = [...SAMPLE_ROWS_2024, ...SAMPLE_ROWS_2023];
    const report = formatSecuriteReport("75", allRows);

    // Violences intrafamiliales : 8900 vs 8900 = 0%
    expect(report).toContain("stable");
  });

  it("gere un departement sans donnees", () => {
    const report = formatSecuriteReport("99", []);
    expect(report).toContain("Aucune donnee");
  });

  it("affiche les faits marquants (top 3)", () => {
    const report = formatSecuriteReport("75", SAMPLE_ROWS_2024);
    expect(report).toContain("Faits marquants");
  });

  it("respecte le tri par taux decroissant", () => {
    const report = formatSecuriteReport("75", SAMPLE_ROWS_2024);
    const lines = report.split("\n");
    const tableLines = lines.filter((l) => l.startsWith("| ") && !l.startsWith("| Indicateur") && !l.startsWith("| ---"));
    // Le premier indicateur devrait etre celui avec le taux le plus eleve (Vols sans violence)
    expect(tableLines[0]).toContain("Vols sans violence");
  });
});

describe("consulterSecurite (integration)", () => {
  it("retourne un rapport pour un departement", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: SAMPLE_ROWS_2024 }),
    });

    const result = await consulterSecurite({ code_departement: "75" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Departement 75");
  });

  it("retourne une erreur pour commune introuvable", async () => {
    mockResolveNom.mockResolvedValue(null);

    const result = await consulterSecurite({ commune: "ZZZInexistant" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Commune non trouvee");
  });

  it("resout un code postal et retourne les donnees", async () => {
    mockResolveCP.mockResolvedValue([{ nom: "BONDY", code: "93010", codesPostaux: ["93140"] }]);
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: SAMPLE_ROWS_2024.map((r) => ({ ...r, Code_departement: "93" })) }),
    });

    const result = await consulterSecurite({ code_postal: "93140" });
    expect(result.isError).toBeUndefined();
  });

  it("filtre par annee specifique", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [...SAMPLE_ROWS_2024, ...SAMPLE_ROWS_2023] }),
    });

    const result = await consulterSecurite({ code_departement: "75", annee: 2023 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("2023");
  });
});
