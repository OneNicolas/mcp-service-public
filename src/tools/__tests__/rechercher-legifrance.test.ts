import { describe, it, expect, vi, beforeEach } from "vitest";
import { rechercherTexteLegal } from "../rechercher-texte-legal.js";
import { rechercherCodeJuridique } from "../rechercher-code-juridique.js";
import { rechercherJurisprudence } from "../rechercher-jurisprudence.js";

// Mock du client Legifrance PISTE
vi.mock("../../utils/legifrance-client.js", () => ({
  searchLoda: vi.fn(),
  searchCode: vi.fn(),
  searchJuri: vi.fn(),
  LegifranceClientError: class LegifranceClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LegifranceClientError";
    }
  },
}));

import { searchLoda, searchCode, searchJuri, LegifranceClientError } from "../../utils/legifrance-client.js";

const mockSearchLoda = searchLoda as ReturnType<typeof vi.fn>;
const mockSearchCode = searchCode as ReturnType<typeof vi.fn>;
const mockSearchJuri = searchJuri as ReturnType<typeof vi.fn>;

const MOCK_ENV = {
  DB: {} as D1Database,
  ADMIN_SECRET: "secret",
  PISTE_CLIENT_ID: "test-client-id",
  PISTE_CLIENT_SECRET: "test-client-secret",
};

const SAMPLE_TEXTE_LEGAL_RESULT = `RESULTATS (2 sur 42 total) :

=== 1 ===
Titre : Loi n 78-17 du 6 janvier 1978 relative a l'informatique, aux fichiers et aux libertes
Nature : LOI
Numero : 78-17
Date : 1978-01-06
Lien : https://www.legifrance.gouv.fr/loda/id/LEGITEXT000006068624`;

const SAMPLE_CODE_RESULT = `RESULTATS (3 sur 15 total) :

=== 1 ===
Titre : Obligation de securite de l'employeur
Article : L4121-1
Lien : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000035640828`;

const SAMPLE_JURISPRUDENCE_RESULT = `RESULTATS (2 sur 8 total) :

=== 1 ===
Titre : Arret chambre sociale 25 janvier 2023
Juridiction : Cour de cassation
Formation : CHAMBRE_SOCIALE
Numero : 21-20.345
Date : 2023-01-25
Solution : Rejet
Lien : https://www.legifrance.gouv.fr/juri/id/JURITEXT000047012345`;

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// rechercherTexteLegal
// ============================================================

describe("rechercherTexteLegal", () => {
  it("retourne isError si recherche vide", async () => {
    const result = await rechercherTexteLegal({ recherche: "" }, MOCK_ENV);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("termes de recherche");
  });

  it("retourne isError si recherche trop courte", async () => {
    const result = await rechercherTexteLegal({ recherche: "x" }, MOCK_ENV);
    expect(result.isError).toBe(true);
  });

  it("retourne isError si env manquant", async () => {
    const result = await rechercherTexteLegal({ recherche: "test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Configuration");
  });

  it("appelle searchLoda avec les bons arguments", async () => {
    mockSearchLoda.mockResolvedValueOnce(SAMPLE_TEXTE_LEGAL_RESULT);

    await rechercherTexteLegal({ recherche: "protection donnees", limit: 3 }, MOCK_ENV);

    expect(mockSearchLoda).toHaveBeenCalledWith("test-client-id", "test-client-secret", {
      query: "protection donnees",
      champ: "ALL",
      typeRecherche: "TOUS_LES_MOTS_DANS_UN_CHAMP",
      pageSize: 3,
    });
  });

  it("utilise champ NUM_ARTICLE si specifie", async () => {
    mockSearchLoda.mockResolvedValueOnce(SAMPLE_TEXTE_LEGAL_RESULT);

    await rechercherTexteLegal({ recherche: "article 7", champ: "NUM_ARTICLE" }, MOCK_ENV);

    expect(mockSearchLoda).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ champ: "NUM_ARTICLE" }),
    );
  });

  it("limite pageSize a 20", async () => {
    mockSearchLoda.mockResolvedValueOnce(SAMPLE_TEXTE_LEGAL_RESULT);

    await rechercherTexteLegal({ recherche: "contrat", limit: 999 }, MOCK_ENV);

    expect(mockSearchLoda).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ pageSize: 20 }),
    );
  });

  it("retourne le texte avec header et source PISTE", async () => {
    mockSearchLoda.mockResolvedValueOnce(SAMPLE_TEXTE_LEGAL_RESULT);

    const result = await rechercherTexteLegal({ recherche: "donnees personnelles" }, MOCK_ENV);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("donnees personnelles");
    expect(result.content[0].text).toContain("PISTE");
    expect(result.content[0].text).toContain("legifrance.gouv.fr");
  });

  it("retourne isError sur LegifranceClientError", async () => {
    mockSearchLoda.mockRejectedValueOnce(new LegifranceClientError("OAuth2 PISTE echec"));

    const result = await rechercherTexteLegal({ recherche: "test" }, MOCK_ENV);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("OAuth2 PISTE");
  });

  it("retourne isError sur erreur generique", async () => {
    mockSearchLoda.mockRejectedValueOnce(new Error("Network error"));

    const result = await rechercherTexteLegal({ recherche: "test" }, MOCK_ENV);

    expect(result.isError).toBe(true);
  });
});

// ============================================================
// rechercherCodeJuridique
// ============================================================

describe("rechercherCodeJuridique", () => {
  it("retourne isError si recherche vide", async () => {
    const result = await rechercherCodeJuridique({ recherche: "", code: "Code civil" }, MOCK_ENV);
    expect(result.isError).toBe(true);
  });

  it("retourne isError si code vide", async () => {
    const result = await rechercherCodeJuridique({ recherche: "contrat", code: "" }, MOCK_ENV);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("preciser un code");
  });

  it("retourne isError si env manquant", async () => {
    const result = await rechercherCodeJuridique({ recherche: "test", code: "Code civil" });
    expect(result.isError).toBe(true);
  });

  it("appelle searchCode avec les bons arguments", async () => {
    mockSearchCode.mockResolvedValueOnce(SAMPLE_CODE_RESULT);

    await rechercherCodeJuridique({ recherche: "contrat de travail", code: "Code du travail", limit: 8 }, MOCK_ENV);

    expect(mockSearchCode).toHaveBeenCalledWith("test-client-id", "test-client-secret", {
      query: "contrat de travail",
      champ: "ALL",
      typeRecherche: "TOUS_LES_MOTS_DANS_UN_CHAMP",
      pageSize: 8,
      codeName: "Code du travail",
    });
  });

  it("inclut champ NUM_ARTICLE dans l'appel si specifie", async () => {
    mockSearchCode.mockResolvedValueOnce(SAMPLE_CODE_RESULT);

    await rechercherCodeJuridique({ recherche: "1242", code: "Code civil", champ: "NUM_ARTICLE" }, MOCK_ENV);

    expect(mockSearchCode).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ champ: "NUM_ARTICLE" }),
    );
  });

  it("retourne le texte avec header et source PISTE", async () => {
    mockSearchCode.mockResolvedValueOnce(SAMPLE_CODE_RESULT);

    const result = await rechercherCodeJuridique({ recherche: "responsabilite civile", code: "Code civil" }, MOCK_ENV);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Code civil");
    expect(result.content[0].text).toContain("PISTE");
  });

  it("propose des codes courants sur LegifranceClientError", async () => {
    mockSearchCode.mockRejectedValueOnce(new LegifranceClientError("Code inconnu"));

    const result = await rechercherCodeJuridique({ recherche: "test", code: "Code civil" }, MOCK_ENV);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Code civil");
  });
});

// ============================================================
// rechercherJurisprudence
// ============================================================

describe("rechercherJurisprudence", () => {
  it("retourne isError si recherche trop courte", async () => {
    const result = await rechercherJurisprudence({ recherche: "ab" }, MOCK_ENV);
    expect(result.isError).toBe(true);
  });

  it("retourne isError si env manquant", async () => {
    const result = await rechercherJurisprudence({ recherche: "test jurisprudence" });
    expect(result.isError).toBe(true);
  });

  it("appelle searchJuri sans filtre si juridiction = Toutes", async () => {
    mockSearchJuri.mockResolvedValueOnce(SAMPLE_JURISPRUDENCE_RESULT);

    await rechercherJurisprudence({ recherche: "licenciement abusif" }, MOCK_ENV);

    expect(mockSearchJuri).toHaveBeenCalledWith("test-client-id", "test-client-secret", {
      query: "licenciement abusif",
      pageSize: 5,
      juridiction: undefined,
      publicationBulletin: undefined,
    });
  });

  it("utilise fond CAPP si juridiction = Cours d'appel", async () => {
    mockSearchJuri.mockResolvedValueOnce(SAMPLE_JURISPRUDENCE_RESULT);

    await rechercherJurisprudence({ recherche: "clause abusive", juridiction: "Cours d'appel" }, MOCK_ENV);

    expect(mockSearchJuri).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ juridiction: "CAPP" }),
    );
  });

  it("inclut publication_bulletin T uniquement pour Cour de cassation", async () => {
    mockSearchJuri.mockResolvedValueOnce(SAMPLE_JURISPRUDENCE_RESULT);

    await rechercherJurisprudence({
      recherche: "harcelement",
      juridiction: "Cour de cassation",
      publie_bulletin: true,
    }, MOCK_ENV);

    expect(mockSearchJuri).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ publicationBulletin: "T" }),
    );
  });

  it("ignore publie_bulletin si juridiction n'est pas Cour de cassation", async () => {
    mockSearchJuri.mockResolvedValueOnce(SAMPLE_JURISPRUDENCE_RESULT);

    await rechercherJurisprudence({
      recherche: "expulsion",
      juridiction: "Cours d'appel",
      publie_bulletin: true,
    }, MOCK_ENV);

    expect(mockSearchJuri).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ publicationBulletin: undefined }),
    );
  });

  it("retourne le texte avec header et source PISTE", async () => {
    mockSearchJuri.mockResolvedValueOnce(SAMPLE_JURISPRUDENCE_RESULT);

    const result = await rechercherJurisprudence({ recherche: "licenciement", limit: 3 }, MOCK_ENV);

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Jurisprudence");
    expect(result.content[0].text).toContain("PISTE");
  });

  it("retourne isError sur LegifranceClientError", async () => {
    mockSearchJuri.mockRejectedValueOnce(new LegifranceClientError("Timeout"));

    const result = await rechercherJurisprudence({ recherche: "test jurisprudence" }, MOCK_ENV);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Timeout");
  });
});
