import { describe, it, expect } from "vitest";
import {
  classifyQuery,
  extractCommuneName,
  extractCodePostal,
  extractTypeLocal,
  extractPrix,
  extractTypeAchat,
} from "../rechercher.js";

describe("classifyQuery", () => {
  it("route les requetes DVF / immobilier", () => {
    expect(classifyQuery("prix immobilier a Lyon")).toBe("transactions_dvf");
    expect(classifyQuery("prix au m2 a Bordeaux")).toBe("transactions_dvf");
    expect(classifyQuery("acheter un appartement a Paris")).toBe("transactions_dvf");
    expect(classifyQuery("combien coute une maison a Nantes")).toBe("transactions_dvf");
  });

  it("route les requetes fiscalite locale", () => {
    expect(classifyQuery("taux foncier a Lyon")).toBe("fiscalite_locale");
    expect(classifyQuery("taxe fonciere Marseille")).toBe("fiscalite_locale");
    expect(classifyQuery("taux TEOM a Bondy")).toBe("fiscalite_locale");
  });

  it("route les requetes simulation TF", () => {
    expect(classifyQuery("combien de taxe fonciere pour un appartement de 60m2 a Lyon")).toBe("simulation_tf");
    expect(classifyQuery("estimer ma taxe fonciere")).toBe("simulation_tf");
    expect(classifyQuery("simuler TF 80m² maison Bordeaux")).toBe("simulation_tf");
  });

  it("route les requetes doctrine BOFiP", () => {
    expect(classifyQuery("credit d'impot recherche")).toBe("doctrine_bofip");
    expect(classifyQuery("exoneration plus-value immobiliere")).toBe("doctrine_bofip");
    expect(classifyQuery("regime fiscal micro-entreprise")).toBe("doctrine_bofip");
  });

  it("route par defaut vers fiches DILA", () => {
    expect(classifyQuery("renouveler passeport")).toBe("fiches_dila");
    expect(classifyQuery("allocation logement")).toBe("fiches_dila");
    expect(classifyQuery("inscription ecole")).toBe("fiches_dila");
  });

  // T15 -- Frais de notaire
  it("route les requetes frais de notaire", () => {
    expect(classifyQuery("frais de notaire pour 250000 euros")).toBe("simulation_frais_notaire");
    expect(classifyQuery("combien de frais notaire")).toBe("simulation_frais_notaire");
    expect(classifyQuery("simuler frais de notaire ancien")).toBe("simulation_frais_notaire");
    expect(classifyQuery("droits de mutation achat")).toBe("simulation_frais_notaire");
    expect(classifyQuery("DMTO sur un bien")).toBe("simulation_frais_notaire");
    expect(classifyQuery("cout notaire 300000")).toBe("simulation_frais_notaire");
    expect(classifyQuery("emoluments notaire")).toBe("simulation_frais_notaire");
    expect(classifyQuery("frais d'acquisition immobilier")).toBe("simulation_frais_notaire");
  });

  // T15 -- Zonage immobilier
  it("route les requetes zonage immobilier", () => {
    expect(classifyQuery("zone Pinel Lyon")).toBe("zonage_immobilier");
    expect(classifyQuery("zone ABC de Bordeaux")).toBe("zonage_immobilier");
    expect(classifyQuery("PTZ eligible a Nantes")).toBe("zonage_immobilier");
    expect(classifyQuery("zonage immobilier Paris")).toBe("zonage_immobilier");
    expect(classifyQuery("zone tendue Marseille")).toBe("zonage_immobilier");
    expect(classifyQuery("Denormandie eligible Lille")).toBe("zonage_immobilier");
    expect(classifyQuery("zone B1 commune")).toBe("zonage_immobilier");
  });

  // T24 -- Simulation IR
  it("route les requetes simulation IR", () => {
    expect(classifyQuery("simuler impot sur le revenu")).toBe("simulation_ir");
    expect(classifyQuery("calculer mon IR")).toBe("simulation_ir");
    expect(classifyQuery("bareme progressif impot")).toBe("simulation_ir");
    expect(classifyQuery("quotient familial")).toBe("simulation_ir");
  });

  // Priorite : frais notaire avant DVF
  it("priorise frais notaire sur DVF quand les deux matchent", () => {
    expect(classifyQuery("frais de notaire achat immobilier")).toBe("simulation_frais_notaire");
    expect(classifyQuery("droits de mutation vente")).toBe("simulation_frais_notaire");
  });
});

describe("extractCommuneName", () => {
  it("extrait un nom de commune apres 'a'", () => {
    expect(extractCommuneName("prix a Lyon")).toBe("LYON");
  });

  it("extrait un nom de commune apres 'de'", () => {
    expect(extractCommuneName("taux de Marseille")).toBe("MARSEILLE");
  });

  it("reconnait les noms en majuscules", () => {
    expect(extractCommuneName("taux PARIS")).toBe("PARIS");
  });

  it("retourne null si pas de commune trouvee", () => {
    expect(extractCommuneName("renouveler passeport")).toBeNull();
  });

  it("ignore les acronymes fiscaux", () => {
    expect(extractCommuneName("taux TFB")).toBeNull();
    expect(extractCommuneName("taux TEOM")).toBeNull();
  });

  // T15 -- Nouveaux acronymes ignores
  it("ignore les acronymes immobiliers", () => {
    expect(extractCommuneName("taux DMTO")).toBeNull();
    expect(extractCommuneName("PTZ eligible")).toBeNull();
    expect(extractCommuneName("zone ABC")).toBeNull();
  });

  // T23 -- Commune en debut de phrase
  it("detecte une commune en debut de phrase", () => {
    expect(extractCommuneName("Bondy taxe fonciere")).toBe("BONDY");
    expect(extractCommuneName("Lyon prix immobilier")).toBe("LYON");
    expect(extractCommuneName("Marseille taux foncier")).toBe("MARSEILLE");
  });

  // T23 -- Noms composes
  it("detecte les noms composes avec tiret", () => {
    expect(extractCommuneName("taux a Saint-Denis")).toBe("SAINT-DENIS");
    expect(extractCommuneName("Saint-Denis taux")).toBe("SAINT-DENIS");
    expect(extractCommuneName("Fontenay-sous-Bois fiscalite")).toBe("FONTENAY-SOUS-BOIS");
  });

  // T23 -- Prefixes Le/La/Les
  it("detecte les communes avec prefixe Le/La/Les", () => {
    expect(extractCommuneName("prix a Le Mans")).toBe("LE MANS");
  });
});

// T23 -- Tests extractCodePostal
describe("extractCodePostal", () => {
  it("extrait un code postal 5 chiffres", () => {
    expect(extractCodePostal("93140 taxe fonciere")).toBe("93140");
    expect(extractCodePostal("taxe fonciere 75001")).toBe("75001");
  });

  it("retourne null sans code postal", () => {
    expect(extractCodePostal("taxe fonciere Lyon")).toBeNull();
  });

  it("retourne null pour un nombre hors plage CP", () => {
    expect(extractCodePostal("250000 euros")).toBeNull();
    expect(extractCodePostal("00100 test")).toBeNull();
  });

  it("extrait un CP DOM-TOM", () => {
    expect(extractCodePostal("97400 reunion")).toBe("97400");
  });
});

describe("extractTypeLocal", () => {
  it("detecte appartement", () => {
    expect(extractTypeLocal("prix d'un appartement")).toBe("Appartement");
  });

  it("detecte maison", () => {
    expect(extractTypeLocal("acheter une maison")).toBe("Maison");
  });

  it("retourne null si pas de type", () => {
    expect(extractTypeLocal("prix immobilier")).toBeNull();
  });
});

// T15 -- Tests extractPrix
describe("extractPrix", () => {
  it("extrait un prix avec symbole euro", () => {
    expect(extractPrix("frais de notaire pour 250000€")).toBe(250000);
  });

  it("extrait un prix avec 'euros'", () => {
    expect(extractPrix("frais notaire 300000 euros")).toBe(300000);
  });

  it("extrait un prix avec espaces (format FR)", () => {
    expect(extractPrix("250 000€ de frais")).toBe(250000);
  });

  it("extrait un prix en k", () => {
    expect(extractPrix("notaire pour 250k")).toBe(250000);
  });

  it("extrait un nombre nu > 10000", () => {
    expect(extractPrix("frais notaire 350000 ancien")).toBe(350000);
  });

  it("retourne null sans prix", () => {
    expect(extractPrix("frais de notaire")).toBeNull();
  });

  it("retourne null pour petit nombre", () => {
    expect(extractPrix("frais notaire 50")).toBeNull();
  });
});

// T15 -- Tests extractTypeAchat
describe("extractTypeAchat", () => {
  it("detecte ancien", () => {
    expect(extractTypeAchat("achat ancien 250000")).toBe("ancien");
  });

  it("detecte neuf", () => {
    expect(extractTypeAchat("bien neuf 300000")).toBe("neuf");
  });

  it("detecte VEFA comme neuf", () => {
    expect(extractTypeAchat("achat VEFA")).toBe("neuf");
  });

  it("retourne null si absent", () => {
    expect(extractTypeAchat("frais notaire 250000")).toBeNull();
  });
});
