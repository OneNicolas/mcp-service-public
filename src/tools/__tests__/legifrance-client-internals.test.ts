import { describe, it, expect } from "vitest";
import {
  flattenCodeResults,
  buildLegiLink,
  formatTimestampMs,
  type PisteResult,
} from "../../utils/legifrance-client.js";

// -----------------------------------------------------------------------
// flattenCodeResults
// -----------------------------------------------------------------------

describe("flattenCodeResults", () => {
  it("retourne un tableau vide pour une entree vide", () => {
    expect(flattenCodeResults([])).toEqual([]);
  });

  it("aplatit les articles d'un texte LODA avec metadata parent", () => {
    const input: PisteResult[] = [
      {
        id: "LEGITEXT000006069414",
        titre: "Loi n 78-17 du 6 janvier 1978 relative a l informatique",
        nature: "LOI",
        dateTexte: "1978-01-06",
        sections: [
          {
            id: "LEGISCTA000006085959",
            title: "Chapitre Ier",
            extracts: [
              {
                type: "articles",
                id: "LEGIARTI000006528097",
                num: "1",
                title: "Article 1",
                values: ["<mark>informatique</mark> doit etre au service"],
                legalStatus: "VIGUEUR",
              },
            ],
          },
        ],
      },
    ];

    const result = flattenCodeResults(input);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("LEGIARTI000006528097");
    expect(result[0].cid).toBe("LEGIARTI000006528097");
    expect(result[0].num).toBe("1");
    // Metadata du texte parent propagees
    expect(result[0].titre).toBe("Loi n 78-17 du 6 janvier 1978 relative a l informatique");
    expect(result[0].nature).toBe("LOI");
    expect(result[0].dateTexte).toBe("1978-01-06");
    // Balises <mark> nettoyees
    expect(result[0].texte).toBe("informatique doit etre au service");
    expect(result[0].etatJuridique).toBe("VIGUEUR");
  });

  it("ignore les extracts dont type !== articles", () => {
    const input: PisteResult[] = [
      {
        id: "LEGITEXT000001",
        sections: [
          {
            extracts: [
              { type: "sommaire", id: "S1", num: "1", values: ["contenu"] },
              { type: "articles", id: "A1", num: "2", values: ["article valide"], legalStatus: "VIGUEUR" },
            ],
          },
        ],
      },
    ];

    const result = flattenCodeResults(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("A1");
  });

  it("utilise titreLong du parent si titre est absent", () => {
    const input: PisteResult[] = [
      {
        id: "LEGITEXT000001",
        titreLong: "Titre long de la loi",
        sections: [
          {
            extracts: [
              { type: "articles", id: "A1", num: "1", values: ["texte"], legalStatus: "VIGUEUR" },
            ],
          },
        ],
      },
    ];

    const result = flattenCodeResults(input);
    expect(result[0].titre).toBe("Titre long de la loi");
  });

  it("fallback sur extract.title si le parent n a pas de titre", () => {
    const input: PisteResult[] = [
      {
        id: "LEGITEXT000001",
        sections: [
          {
            extracts: [
              { type: "articles", id: "A1", num: "1", title: "Titre article", values: ["texte"], legalStatus: "VIGUEUR" },
            ],
          },
        ],
      },
    ];

    const result = flattenCodeResults(input);
    expect(result[0].titre).toBe("Titre article");
  });

  it("retourne l item tel quel si pas de sections (fallback article plat)", () => {
    const item: PisteResult = { id: "LEGIARTI000001", num: "L1", titre: "Article plat" };
    const result = flattenCodeResults([item]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(item);
  });

  it("nettoie les balises mark et le prefixe [... ]", () => {
    const input: PisteResult[] = [
      {
        id: "LEGITEXT000001",
        sections: [
          {
            extracts: [
              {
                type: "articles",
                id: "A1",
                values: ["[... ] debut <mark>mot</mark> fin"],
                legalStatus: "VIGUEUR",
              },
            ],
          },
        ],
      },
    ];

    const result = flattenCodeResults(input);
    expect(result[0].texte).toBe("debut mot fin");
  });

  it("laisse texte undefined si le contenu est vide apres nettoyage", () => {
    const input: PisteResult[] = [
      {
        id: "LEGITEXT000001",
        sections: [
          {
            extracts: [
              { type: "articles", id: "A1", values: [""], legalStatus: "VIGUEUR" },
            ],
          },
        ],
      },
    ];

    const result = flattenCodeResults(input);
    expect(result[0].texte).toBeUndefined();
  });

  it("aplatit plusieurs sections et plusieurs extracts", () => {
    const input: PisteResult[] = [
      {
        id: "LEGITEXT000001",
        titre: "Code civil",
        nature: "CODE",
        sections: [
          {
            extracts: [
              { type: "articles", id: "A1", num: "1", values: ["premier"], legalStatus: "VIGUEUR" },
              { type: "articles", id: "A2", num: "2", values: ["deuxieme"], legalStatus: "VIGUEUR" },
            ],
          },
          {
            extracts: [
              { type: "articles", id: "A3", num: "3", values: ["troisieme"], legalStatus: "ABROGE" },
            ],
          },
        ],
      },
    ];

    const result = flattenCodeResults(input);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.num)).toEqual(["1", "2", "3"]);
    expect(result.every((r) => r.titre === "Code civil")).toBe(true);
    expect(result.every((r) => r.nature === "CODE")).toBe(true);
  });
});

// -----------------------------------------------------------------------
// buildLegiLink
// -----------------------------------------------------------------------

describe("buildLegiLink", () => {
  it("texte_legal : utilise cid avec loda/article_lc/", () => {
    const r: PisteResult = { id: "LEGIARTI000001", cid: "LEGIARTI000001" };
    expect(buildLegiLink(r, "texte_legal")).toBe(
      "https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000001",
    );
  });

  it("texte_legal : prefere cid sur id", () => {
    const r: PisteResult = { id: "LEGITEXT000001", cid: "LEGIARTI000099" };
    expect(buildLegiLink(r, "texte_legal")).toContain("LEGIARTI000099");
  });

  it("code : utilise cid avec codes/article_lc/", () => {
    const r: PisteResult = { id: "LEGIARTI000035640828", cid: "LEGIARTI000035640828" };
    expect(buildLegiLink(r, "code")).toBe(
      "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000035640828",
    );
  });

  it("jurisprudence : utilise r.id (JURITEXT) et non cid", () => {
    const r: PisteResult = { id: "JURITEXT000028227978", cid: "JURITEXT000028227978" };
    expect(buildLegiLink(r, "jurisprudence")).toBe(
      "https://www.legifrance.gouv.fr/juri/id/JURITEXT000028227978",
    );
  });

  it("jurisprudence : utilise r.id meme si cid differe", () => {
    const r: PisteResult = { id: "JURITEXT000028227978", cid: "AUTRE000001" };
    expect(buildLegiLink(r, "jurisprudence")).toContain("JURITEXT000028227978");
    expect(buildLegiLink(r, "jurisprudence")).not.toContain("AUTRE000001");
  });

  it("jorf : utilise cid avec jorf/id/", () => {
    const r: PisteResult = { id: "JORFTEXT000049441002", cid: "JORFTEXT000049441002" };
    expect(buildLegiLink(r, "jorf")).toBe(
      "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000049441002",
    );
  });

  it("retourne null si id et cid sont absents (texte_legal)", () => {
    expect(buildLegiLink({}, "texte_legal")).toBeNull();
  });

  it("retourne null si id et cid sont absents (jurisprudence)", () => {
    expect(buildLegiLink({}, "jurisprudence")).toBeNull();
  });
});

// -----------------------------------------------------------------------
// formatTimestampMs
// -----------------------------------------------------------------------

describe("formatTimestampMs", () => {
  it("retourne une chaine vide pour undefined", () => {
    expect(formatTimestampMs(undefined)).toBe("");
  });

  it("convertit un timestamp ms valide en contenant l annee", () => {
    // 1546819200000 = janvier 2019
    const result = formatTimestampMs("1546819200000");
    expect(result).toMatch(/2019/);
  });

  it("retourne la string telle quelle si deja une date ISO", () => {
    expect(formatTimestampMs("2023-01-25")).toBe("2023-01-25");
  });

  it("retourne la valeur 0 telle quelle (valeur invalide)", () => {
    expect(formatTimestampMs("0")).toBe("0");
  });

  it("retourne la string telle quelle si non numerique", () => {
    expect(formatTimestampMs("non-numerique")).toBe("non-numerique");
  });

  it("convertit un timestamp ms recent", () => {
    // 1674604800000 = janvier 2023
    const result = formatTimestampMs("1674604800000");
    expect(result).toMatch(/2023/);
  });

  it("convertit 1384214400000 en contenant 2013", () => {
    // 1384214400000 = novembre 2013 (date de l arret JURITEXT000028227978)
    const result = formatTimestampMs("1384214400000");
    expect(result).toMatch(/2013/);
  });
});
