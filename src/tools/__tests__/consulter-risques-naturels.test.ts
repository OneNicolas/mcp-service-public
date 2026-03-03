import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveToCodeInsee,
  fetchRisques,
  fetchCatNat,
  formatRisquesReport,
  consulterRisquesNaturels,
} from "../consulter-risques-naturels.js";

// Mock cachedFetch
vi.mock("../../utils/cache.js", () => ({
  cachedFetch: vi.fn(),
  CACHE_TTL: { DVF: 86400, GEO_API: 604800, ANNUAIRE: 86400 },
}));

// Mock geo-api
vi.mock("../../utils/geo-api.js", () => ({
  resolveCodePostal: vi.fn(),
  resolveNomCommune: vi.fn(),
  resolveCodeInsee: vi.fn(),
}));

import { cachedFetch } from "../../utils/cache.js";
import { resolveCodePostal, resolveNomCommune, resolveCodeInsee } from "../../utils/geo-api.js";

const mockCachedFetch = cachedFetch as ReturnType<typeof vi.fn>;
const mockResolveCP = resolveCodePostal as ReturnType<typeof vi.fn>;
const mockResolveNom = resolveNomCommune as ReturnType<typeof vi.fn>;
const mockResolveInsee = resolveCodeInsee as ReturnType<typeof vi.fn>;

const SAMPLE_RISQUES = {
  data: [
    {
      code_insee: "75056",
      libelle_commune: "PARIS",
      risques_detail: [
        { num_risque: "113", libelle_risque_long: "Inondation - Par une crue a debordement lent de cours d'eau" },
        { num_risque: "12", libelle_risque_long: "Mouvement de terrain - Tassements differentiels" },
        { num_risque: "215", libelle_risque_long: "Risque industriel" },
      ],
    },
  ],
};

const SAMPLE_CATNAT = {
  data: [
    {
      code_insee: "75056",
      libelle_commune: "PARIS",
      dat_deb: "2024-06-15",
      dat_fin: "2024-06-17",
      dat_pub_arrete: "2024-09-01",
      lib_risque_jo: "Inondations et coulees de boue",
    },
    {
      code_insee: "75056",
      libelle_commune: "PARIS",
      dat_deb: "2023-01-10",
      dat_fin: "2023-01-12",
      dat_pub_arrete: "2023-04-15",
      lib_risque_jo: "Mouvements de terrain differentiels consecutifs a la secheresse",
    },
    {
      code_insee: "75056",
      libelle_commune: "PARIS",
      dat_deb: "2021-07-01",
      dat_fin: "2021-07-02",
      dat_pub_arrete: "2021-10-20",
      lib_risque_jo: "Inondations et coulees de boue",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveToCodeInsee", () => {
  it("utilise le code INSEE direct", async () => {
    mockResolveInsee.mockResolvedValue({ nom: "PARIS", code: "75056" });
    const result = await resolveToCodeInsee({ code_insee: "75056" });
    expect(result.codeInsee).toBe("75056");
    expect(result.nomCommune).toBe("PARIS");
  });

  it("resout un code postal", async () => {
    mockResolveCP.mockResolvedValue([{ nom: "BONDY", code: "93010", codesPostaux: ["93140"] }]);
    const result = await resolveToCodeInsee({ code_postal: "93140" });
    expect(result.codeInsee).toBe("93010");
    expect(result.nomCommune).toBe("BONDY");
  });

  it("resout une commune par nom", async () => {
    mockResolveNom.mockResolvedValue({ nom: "NIMES", code: "30189" });
    const result = await resolveToCodeInsee({ commune: "Nimes" });
    expect(result.codeInsee).toBe("30189");
  });

  it("erreur sans parametre", async () => {
    await expect(resolveToCodeInsee({})).rejects.toThrow("Veuillez preciser");
  });

  it("erreur commune introuvable", async () => {
    mockResolveNom.mockResolvedValue(null);
    await expect(resolveToCodeInsee({ commune: "ZZZ" })).rejects.toThrow("Commune non trouvee");
  });
});

describe("fetchRisques", () => {
  it("recupere les risques pour une commune", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_RISQUES,
    });

    const data = await fetchRisques("75056");
    expect(data).toHaveLength(1);
    expect(data[0].risques_detail).toHaveLength(3);
    expect(mockCachedFetch).toHaveBeenCalledWith(
      expect.stringContaining("code_insee=75056"),
      expect.any(Object),
    );
  });

  it("erreur HTTP", async () => {
    mockCachedFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchRisques("00000")).rejects.toThrow("HTTP 404");
  });
});

describe("fetchCatNat", () => {
  it("recupere les arretes CatNat", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_CATNAT,
    });

    const data = await fetchCatNat("75056");
    expect(data).toHaveLength(3);
  });

  it("retourne vide si pas de donnees", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const data = await fetchCatNat("99999");
    expect(data).toHaveLength(0);
  });
});

describe("formatRisquesReport", () => {
  it("formate un rapport complet avec risques et CatNat", () => {
    const report = formatRisquesReport("PARIS", "75056", SAMPLE_RISQUES.data, SAMPLE_CATNAT.data);

    expect(report).toContain("PARIS");
    expect(report).toContain("75056");
    expect(report).toContain("3 risque(s) identifie(s)");
    expect(report).toContain("Inondation");
    expect(report).toContain("Mouvement de terrain");
    expect(report).toContain("Risque industriel");
    expect(report).toContain("3 au total");
    expect(report).toContain("Georisques");
  });

  it("affiche les 5 derniers CatNat tries par date", () => {
    const report = formatRisquesReport("PARIS", "75056", SAMPLE_RISQUES.data, SAMPLE_CATNAT.data);

    // La premiere ligne du tableau devrait etre le CatNat le plus recent
    expect(report).toContain("01/09/2024");
    expect(report).toContain("Inondations et coulees de boue");
  });

  it("affiche un message si commune sans risques", () => {
    const report = formatRisquesReport("VILLAGE", "01001", [], []);

    expect(report).toContain("Aucun risque naturel");
    expect(report).toContain("Aucun arrete de catastrophe naturelle");
  });

  it("formate correctement les dates ISO", () => {
    const report = formatRisquesReport("PARIS", "75056", [], SAMPLE_CATNAT.data);
    expect(report).toContain("15/06/2024");
    expect(report).toContain("17/06/2024");
  });

  it("indique les anciens arretes si plus de 5", () => {
    const manyCatnat = Array.from({ length: 8 }, (_, i) => ({
      code_insee: "75056",
      libelle_commune: "PARIS",
      dat_deb: `202${i}-01-01`,
      dat_fin: `202${i}-01-02`,
      dat_pub_arrete: `202${i}-03-01`,
      lib_risque_jo: "Inondations",
    }));

    const report = formatRisquesReport("PARIS", "75056", [], manyCatnat);
    expect(report).toContain("3 arrete(s) plus ancien(s)");
  });
});

describe("consulterRisquesNaturels (integration)", () => {
  it("retourne un rapport pour un code INSEE", async () => {
    mockResolveInsee.mockResolvedValue({ nom: "PARIS", code: "75056" });

    let callCount = 0;
    mockCachedFetch.mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes("/risques")) {
        return { ok: true, json: async () => SAMPLE_RISQUES };
      }
      if (url.includes("/catnat")) {
        return { ok: true, json: async () => SAMPLE_CATNAT };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    });

    const result = await consulterRisquesNaturels({ code_insee: "75056" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("PARIS");
    expect(result.content[0].text).toContain("Inondation");
  });

  it("retourne une erreur pour commune introuvable", async () => {
    mockResolveNom.mockResolvedValue(null);

    const result = await consulterRisquesNaturels({ commune: "ZZZInexistant" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Commune non trouvee");
  });

  it("gere les erreurs API gracieusement", async () => {
    mockResolveInsee.mockResolvedValue({ nom: "PARIS", code: "75056" });

    // Risques OK, CatNat en erreur
    mockCachedFetch.mockImplementation(async (url: string) => {
      if (url.includes("/risques")) {
        return { ok: true, json: async () => SAMPLE_RISQUES };
      }
      if (url.includes("/catnat")) {
        throw new Error("timeout");
      }
      return { ok: true, json: async () => ({ data: [] }) };
    });

    const result = await consulterRisquesNaturels({ code_insee: "75056" });
    // Meme avec une erreur sur catnat, le rapport devrait contenir les risques
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Inondation");
    expect(result.content[0].text).toContain("Aucun arrete");
  });
});
