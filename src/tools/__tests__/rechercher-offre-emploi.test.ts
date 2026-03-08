import { describe, it, expect, vi, beforeEach } from "vitest";

const FIXTURE_OFFRES = {
  resultats: [
    {
      id: "196XYZS",
      intitule: "Developpeur TypeScript Senior",
      description: "Nous recherchons un developpeur TypeScript senior pour rejoindre notre equipe produit. Vous travaillerez sur des projets innovants.",
      dateCreation: "2025-03-01T08:00:00Z",
      lieuTravail: { libelle: "Paris 15eme", codePostal: "75015" },
      entreprise: { nom: "OCTO Technology", secteurActiviteLibelle: "Informatique" },
      typeContrat: "CDI",
      typeContratLibelle: "Contrat a duree indeterminee",
      dureeTravailLibelleConverti: "Temps plein",
      experienceLibelle: "3 ans et plus",
      romeLibelle: "Developpement de logiciels",
      salaire: { libelle: "Annuel de 50000 a 70000 EUR" },
      competences: [
        { libelle: "TypeScript" },
        { libelle: "Node.js" },
        { libelle: "API REST" },
      ],
      origineOffre: { urlOrigine: "https://candidat.francetravail.fr/offres/emploi/offre/196XYZS" },
    },
    {
      id: "197ABCD",
      intitule: "Developpeur JavaScript Frontend",
      description: "Rejoignez notre equipe front pour creer des interfaces utilisateur modernes.",
      dateCreation: "2025-03-02T10:30:00Z",
      lieuTravail: { libelle: "Lyon 2eme", codePostal: "69002" },
      entreprise: { nom: "Startup Lyon", secteurActiviteLibelle: "Numerique" },
      typeContrat: "CDD",
      typeContratLibelle: "Contrat a duree determinee",
      dureeTravailLibelleConverti: "Temps plein",
      experienceLibelle: "1 a 3 ans",
      romeLibelle: "Developpement de logiciels",
      salaire: { libelle: "Mensuel de 3000 a 4000 EUR" },
      competences: [
        { libelle: "React" },
        { libelle: "JavaScript" },
      ],
    },
  ],
};

const FIXTURE_EMPTY = { resultats: [] };

const MOCK_TOKEN = { access_token: "mock-token-12345", expires_in: 1499 };

const MOCK_ENV = { FT_CLIENT_ID: "test-client-id", FT_CLIENT_SECRET: "test-secret" };

function mockFetch(
  tokenResp: unknown = MOCK_TOKEN,
  offresResp: unknown = FIXTURE_OFFRES,
  offresOk = true,
  offresStatus = 200,
) {
  let callCount = 0;
  return vi.fn().mockImplementation(async (url: string) => {
    callCount++;
    // Premier appel = auth
    if (callCount === 1 || String(url).includes("oauth2/access_token")) {
      return {
        ok: true,
        status: 200,
        json: async () => tokenResp,
        text: async () => JSON.stringify(tokenResp),
        headers: new Headers(),
      };
    }
    // Deuxieme appel = offres
    return {
      ok: offresOk,
      status: offresStatus,
      json: async () => offresResp,
      text: async () => JSON.stringify(offresResp),
      headers: new Headers({ "Content-Range": "offres 0-1/42" }),
    };
  });
}

describe("rechercher-offre-emploi", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("retourne une erreur sans credentials", async () => {
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "TypeScript" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("FT_CLIENT_ID");
  });

  it("retourne une erreur sans critere de recherche", async () => {
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({}, MOCK_ENV as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("critere");
  });

  it("retourne des offres pour des mots-cles", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "TypeScript" }, MOCK_ENV as any);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("TypeScript Senior");
    expect(result.content[0].text).toContain("OCTO Technology");
    vi.unstubAllGlobals();
  });

  it("affiche le nombre total de resultats", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "TypeScript" }, MOCK_ENV as any);
    expect(result.content[0].text).toContain("42");
    vi.unstubAllGlobals();
  });

  it("affiche les details de l'offre (contrat, salaire, competences)", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "TypeScript" }, MOCK_ENV as any);
    const text = result.content[0].text;
    expect(text).toContain("CDI");
    expect(text).toContain("50000");
    expect(text).toContain("TypeScript");
    expect(text).toContain("196XYZS");
    vi.unstubAllGlobals();
  });

  it("filtre par type de contrat CDI", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = String(url);
      if (String(url).includes("oauth2")) {
        return { ok: true, status: 200, json: async () => MOCK_TOKEN, headers: new Headers() };
      }
      expect(capturedUrl).toContain("typeContrat=CDI");
      return { ok: true, status: 200, json: async () => FIXTURE_OFFRES, headers: new Headers({ "Content-Range": "offres 0-1/10" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    await rechercherOffreEmploi({ mots_cles: "dev", type_contrat: "CDI" }, MOCK_ENV as any);
    vi.unstubAllGlobals();
  });

  it("gere la reponse 204 (aucune offre)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("oauth2")) {
        return { ok: true, status: 200, json: async () => MOCK_TOKEN, headers: new Headers() };
      }
      return { ok: true, status: 204, json: async () => ({}), text: async () => "", headers: new Headers() };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "emploi_inexistant" }, MOCK_ENV as any);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Aucune offre");
    vi.unstubAllGlobals();
  });

  it("gere une erreur HTTP 401", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("oauth2")) {
        return { ok: true, status: 200, json: async () => MOCK_TOKEN, headers: new Headers() };
      }
      return { ok: false, status: 401, json: async () => ({}), text: async () => "Unauthorized", headers: new Headers() };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "dev" }, MOCK_ENV as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("401");
    vi.unstubAllGlobals();
  });

  it("gere un echec d'authentification", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return { ok: false, status: 401, json: async () => ({}), text: async () => "invalid_client", headers: new Headers() };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "dev" }, MOCK_ENV as any);
    expect(result.isError).toBe(true);
    vi.unstubAllGlobals();
  });

  it("filtre par qualification cadre", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = String(url);
      if (String(url).includes("oauth2")) {
        return { ok: true, status: 200, json: async () => MOCK_TOKEN, headers: new Headers() };
      }
      expect(capturedUrl).toContain("qualification=9");
      return { ok: true, status: 200, json: async () => FIXTURE_OFFRES, headers: new Headers({ "Content-Range": "offres 0-1/5" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    await rechercherOffreEmploi({ mots_cles: "directeur", qualification: "cadre" }, MOCK_ENV as any);
    vi.unstubAllGlobals();
  });

  it("gere une exception reseau", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "dev" }, MOCK_ENV as any);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("network error");
    vi.unstubAllGlobals();
  });

  it("affiche le lien vers l'offre", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ mots_cles: "TypeScript" }, MOCK_ENV as any);
    expect(result.content[0].text).toContain("francetravail.fr");
    vi.unstubAllGlobals();
  });

  it("supporte une recherche par departement uniquement", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = String(url);
      if (String(url).includes("oauth2")) {
        return { ok: true, status: 200, json: async () => MOCK_TOKEN, headers: new Headers() };
      }
      expect(capturedUrl).toContain("departement=75");
      return { ok: true, status: 200, json: async () => FIXTURE_OFFRES, headers: new Headers({ "Content-Range": "offres 0-1/100" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rechercherOffreEmploi } = await import("../rechercher-offre-emploi.js");
    const result = await rechercherOffreEmploi({ departement: "75" }, MOCK_ENV as any);
    expect(result.isError).toBeFalsy();
    vi.unstubAllGlobals();
  });
});
