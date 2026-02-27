import { describe, it, expect } from "vitest";
import {
  classifyQuery,
  extractCommuneName,
  extractTypeLocal,
} from "../rechercher.js";

describe("classifyQuery", () => {
  it("route les requ\u00eates DVF / immobilier", () => {
    expect(classifyQuery("prix immobilier \u00e0 Lyon")).toBe("transactions_dvf");
    expect(classifyQuery("prix au m2 \u00e0 Bordeaux")).toBe("transactions_dvf");
    expect(classifyQuery("acheter un appartement \u00e0 Paris")).toBe("transactions_dvf");
    expect(classifyQuery("combien coute une maison \u00e0 Nantes")).toBe("transactions_dvf");
  });

  it("route les requ\u00eates fiscalit\u00e9 locale", () => {
    expect(classifyQuery("taux foncier \u00e0 Lyon")).toBe("fiscalite_locale");
    expect(classifyQuery("taxe fonci\u00e8re Marseille")).toBe("fiscalite_locale");
    expect(classifyQuery("taux TEOM \u00e0 Bondy")).toBe("fiscalite_locale");
  });

  it("route les requ\u00eates simulation TF", () => {
    expect(classifyQuery("combien de taxe fonci\u00e8re pour un appartement de 60m2 \u00e0 Lyon")).toBe("simulation_tf");
    expect(classifyQuery("estimer ma taxe fonci\u00e8re")).toBe("simulation_tf");
    expect(classifyQuery("simuler TF 80m\u00b2 maison Bordeaux")).toBe("simulation_tf");
  });

  it("route les requ\u00eates doctrine BOFiP", () => {
    expect(classifyQuery("cr\u00e9dit d'imp\u00f4t recherche")).toBe("doctrine_bofip");
    expect(classifyQuery("exon\u00e9ration plus-value immobili\u00e8re")).toBe("doctrine_bofip");
    expect(classifyQuery("r\u00e9gime fiscal micro-entreprise")).toBe("doctrine_bofip");
  });

  it("route par d\u00e9faut vers fiches DILA", () => {
    expect(classifyQuery("renouveler passeport")).toBe("fiches_dila");
    expect(classifyQuery("allocation logement")).toBe("fiches_dila");
    expect(classifyQuery("inscription \u00e9cole")).toBe("fiches_dila");
  });
});

describe("extractCommuneName", () => {
  it("extrait un nom de commune apr\u00e8s '\u00e0'", () => {
    expect(extractCommuneName("prix \u00e0 Lyon")).toBe("LYON");
  });

  it("extrait un nom de commune apr\u00e8s 'de'", () => {
    expect(extractCommuneName("taux de Marseille")).toBe("MARSEILLE");
  });

  it("reconna\u00eet les noms en majuscules", () => {
    expect(extractCommuneName("taux PARIS")).toBe("PARIS");
  });

  it("retourne null si pas de commune trouv\u00e9e", () => {
    expect(extractCommuneName("renouveler passeport")).toBeNull();
  });

  it("ignore les acronymes fiscaux", () => {
    expect(extractCommuneName("taux TFB")).toBeNull();
    expect(extractCommuneName("taux TEOM")).toBeNull();
  });
});

describe("extractTypeLocal", () => {
  it("d\u00e9tecte appartement", () => {
    expect(extractTypeLocal("prix d'un appartement")).toBe("Appartement");
  });

  it("d\u00e9tecte maison", () => {
    expect(extractTypeLocal("acheter une maison")).toBe("Maison");
  });

  it("retourne null si pas de type", () => {
    expect(extractTypeLocal("prix immobilier")).toBeNull();
  });
});
