import { describe, it, expect } from "vitest";
import { sanitizeFtsQuery } from "../rechercher-fiche.js";

describe("sanitizeFtsQuery", () => {
  it("laisse une query simple intacte", () => {
    expect(sanitizeFtsQuery("passeport renouvellement")).toBe("passeport renouvellement");
  });

  it("supprime les guillemets", () => {
    expect(sanitizeFtsQuery('"allocation logement"')).toBe("allocation logement");
  });

  it("supprime les parentheses", () => {
    expect(sanitizeFtsQuery("(passeport) ou (carte)")).toBe("passeport ou carte");
  });

  it("supprime les operateurs booleens FTS5", () => {
    expect(sanitizeFtsQuery("passeport AND carte")).toBe("passeport carte");
    expect(sanitizeFtsQuery("logement OR allocation")).toBe("logement allocation");
    expect(sanitizeFtsQuery("NOT passeport")).toBe("passeport");
  });

  // Les operateurs booleens doivent etre des mots entiers
  it("preserve les mots contenant des operateurs", () => {
    expect(sanitizeFtsQuery("notification android")).toBe("notification android");
    expect(sanitizeFtsQuery("mandataire")).toBe("mandataire");
  });

  it("supprime le tiret en debut de mot", () => {
    expect(sanitizeFtsQuery("-passeport")).toBe("passeport");
  });

  it("supprime les etoiles (prefixe/suffixe)", () => {
    expect(sanitizeFtsQuery("pass* renouvellement")).toBe("pass renouvellement");
    expect(sanitizeFtsQuery("*port")).toBe("port");
  });

  it("supprime les deux-points (separateur colonne)", () => {
    expect(sanitizeFtsQuery("titre:passeport")).toBe("titrepasseport");
  });

  it("normalise les espaces multiples", () => {
    expect(sanitizeFtsQuery("  passeport   carte  ")).toBe("passeport carte");
  });

  it("retourne le premier mot si la query nettoyee est vide", () => {
    expect(sanitizeFtsQuery("--- *** ()")).toBe("");
    expect(sanitizeFtsQuery('"" AND OR')).toBe("");
    expect(sanitizeFtsQuery('"" ()')).toBe("");
  });

  it("gere les caracteres speciaux melanges", () => {
    expect(sanitizeFtsQuery('"carte (d\'identite)" AND renouvellement')).toBe(
      "carte d'identite renouvellement"
    );
  });

  it("gere les accents", () => {
    expect(sanitizeFtsQuery("securite sociale")).toBe("securite sociale");
    expect(sanitizeFtsQuery("declaration previsionnelle")).toBe("declaration previsionnelle");
  });

  it("gere NEAR comme operateur FTS5", () => {
    expect(sanitizeFtsQuery("passeport NEAR carte")).toBe("passeport carte");
  });
});
