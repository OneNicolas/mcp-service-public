import { describe, it, expect } from "vitest";
import {
  classifyQuery,
  extractCommuneName,
  extractCodePostal,
  extractTypeLocal,
  extractPrix,
  extractTypeAchat,
  extractRevenuIR,
  extractSituationFamiliale,
  extractNbEnfants,
  extractIDCC,
  extractSiret,
  extractSiren,
  extractTypeEtablissement,
  extractTypeTexteJorf,
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

  // T28 -- Convention collective
  it("route les requetes convention collective", () => {
    expect(classifyQuery("convention collective batiment")).toBe("convention_collective");
    expect(classifyQuery("IDCC 843")).toBe("convention_collective");
    expect(classifyQuery("accord de branche metallurgie")).toBe("convention_collective");
    expect(classifyQuery("convention boulangerie")).toBe("convention_collective");
    expect(classifyQuery("idcc 3248")).toBe("convention_collective");
    expect(classifyQuery("convention collective restauration")).toBe("convention_collective");
    expect(classifyQuery("syntec convention")).toBe("convention_collective");
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

// T28 -- Tests extractRevenuIR
describe("extractRevenuIR", () => {
  it("extrait un revenu avec euros", () => {
    expect(extractRevenuIR("impot pour 40000 euros")).toBe(40000);
  });

  it("extrait un revenu avec symbole euro", () => {
    expect(extractRevenuIR("combien d'IR pour 55000\u20ac")).toBe(55000);
  });

  it("extrait un revenu en k", () => {
    expect(extractRevenuIR("simuler IR 40k")).toBe(40000);
  });

  it("extrait un revenu avec espace FR", () => {
    expect(extractRevenuIR("impot 42 000 euros")).toBe(42000);
  });

  it("retourne null sans montant", () => {
    expect(extractRevenuIR("simuler impot sur le revenu")).toBeNull();
  });

  it("retourne null pour montant trop petit", () => {
    expect(extractRevenuIR("impot 500 euros")).toBeNull();
  });

  it("extrait un nombre nu en contexte IR", () => {
    expect(extractRevenuIR("simuler IR 40000")).toBe(40000);
  });
});

// T28 -- Tests extractSituationFamiliale
describe("extractSituationFamiliale", () => {
  it("detecte marie", () => {
    expect(extractSituationFamiliale("marie 2 enfants")).toBe("marie");
  });

  it("detecte pacse", () => {
    expect(extractSituationFamiliale("pacse sans enfant")).toBe("pacse");
  });

  it("detecte celibataire", () => {
    expect(extractSituationFamiliale("celibataire")).toBe("celibataire");
  });

  it("detecte seul comme celibataire", () => {
    expect(extractSituationFamiliale("seul 40000 euros")).toBe("celibataire");
  });

  it("detecte couple comme marie", () => {
    expect(extractSituationFamiliale("couple 2 enfants")).toBe("marie");
  });

  it("detecte divorce", () => {
    expect(extractSituationFamiliale("divorcee 1 enfant")).toBe("divorce");
  });

  it("retourne null si absent", () => {
    expect(extractSituationFamiliale("impot 40000 euros")).toBeNull();
  });
});

// T28 -- Tests extractNbEnfants
describe("extractNbEnfants", () => {
  it("extrait le nombre d'enfants", () => {
    expect(extractNbEnfants("marie 2 enfants")).toBe(2);
  });

  it("extrait 1 enfant", () => {
    expect(extractNbEnfants("1 enfant")).toBe(1);
  });

  it("detecte sans enfant", () => {
    expect(extractNbEnfants("sans enfant")).toBe(0);
  });

  it("retourne null si absent", () => {
    expect(extractNbEnfants("impot 40000 euros")).toBeNull();
  });
});

// T28 -- Tests extractIDCC
describe("extractIDCC", () => {
  it("extrait IDCC avec prefixe", () => {
    expect(extractIDCC("IDCC 843")).toBe("843");
  });

  it("extrait IDCC colle", () => {
    expect(extractIDCC("idcc3248")).toBe("3248");
  });

  it("extrait IDCC apres convention", () => {
    expect(extractIDCC("convention 1234")).toBe("1234");
  });

  it("retourne null sans IDCC", () => {
    expect(extractIDCC("convention collective batiment")).toBeNull();
  });
});

// T32 -- Classification recherche entreprise
describe("classifyQuery — recherche entreprise", () => {
  it("detecte un SIRET 14 chiffres", () => {
    expect(classifyQuery("41816609600069")).toBe("recherche_entreprise");
  });

  it("detecte un SIRET avec espaces", () => {
    expect(classifyQuery("418 166 096 00069")).toBe("recherche_entreprise");
  });

  it("detecte mot-cle siret", () => {
    expect(classifyQuery("SIRET de l'entreprise Acme")).toBe("recherche_entreprise");
  });

  it("detecte mot-cle siren", () => {
    expect(classifyQuery("SIREN 418166096")).toBe("recherche_entreprise");
  });

  it("detecte convention + entreprise", () => {
    expect(classifyQuery("convention collective de l'entreprise Acme")).toBe("recherche_entreprise");
  });

  it("ne confond pas un code postal avec un SIREN", () => {
    expect(classifyQuery("taxe fonciere 75001")).not.toBe("recherche_entreprise");
  });
});

describe("extractSiret", () => {
  it("extrait un SIRET 14 chiffres", () => {
    expect(extractSiret("SIRET 41816609600069")).toBe("41816609600069");
  });

  it("extrait un SIRET avec espaces", () => {
    expect(extractSiret("418 166 096 00069")).toBe("41816609600069");
  });

  it("retourne null sans SIRET", () => {
    expect(extractSiret("entreprise Acme")).toBeNull();
  });
});

describe("extractSiren", () => {
  it("extrait un SIREN 9 chiffres", () => {
    expect(extractSiren("SIREN 418166096")).toBe("418166096");
  });

  it("retourne null sans SIREN", () => {
    expect(extractSiren("entreprise Acme")).toBeNull();
  });
});

// T37 -- Edge cases : requetes ambigues
describe("classifyQuery — edge cases ambigus", () => {
  it("priorise SIRET quand convention + SIRET coexistent", () => {
    expect(classifyQuery("convention collective entreprise SIRET 41816609600069")).toBe("recherche_entreprise");
  });

  it("priorise entreprise quand SIRET 14 chiffres avec espaces + convention", () => {
    expect(classifyQuery("convention 418 166 096 00069")).toBe("recherche_entreprise");
  });

  it("route convention collective sans SIRET ni entreprise", () => {
    expect(classifyQuery("convention collective du batiment")).toBe("convention_collective");
  });

  it("route fiscalite meme avec un mot immobilier ambigu", () => {
    expect(classifyQuery("taxe fonciere a Lyon")).toBe("fiscalite_locale");
  });

  it("route DVF quand prix immobilier explicite", () => {
    expect(classifyQuery("prix immobilier a Lyon")).toBe("transactions_dvf");
  });

  it("route simulation TF avant fiscalite quand surface mentionnee", () => {
    expect(classifyQuery("combien de taxe fonciere pour 60m2 a Lyon")).toBe("simulation_tf");
  });

  it("route zonage avant DVF quand Pinel mentionne", () => {
    expect(classifyQuery("zone Pinel prix immobilier Lyon")).toBe("zonage_immobilier");
  });

  it("route frais notaire avant DVF meme avec mot immobilier", () => {
    expect(classifyQuery("frais de notaire achat immobilier 250000")).toBe("simulation_frais_notaire");
  });
});

// T37 -- Edge cases : requetes courtes ou vagues
describe("classifyQuery — requetes courtes", () => {
  it("route un seul mot fiscal vers BOFiP", () => {
    expect(classifyQuery("TVA")).toBe("doctrine_bofip");
  });

  it("route une requete tres courte vers fiches par defaut", () => {
    expect(classifyQuery("bonjour")).toBe("fiches_dila");
  });

  it("route un seul mot administratif vers fiches", () => {
    expect(classifyQuery("passeport")).toBe("fiches_dila");
  });

  it("route IDCC seul comme convention collective", () => {
    expect(classifyQuery("IDCC")).toBe("convention_collective");
  });
});

// T37 -- Edge cases : requetes avec fautes de frappe
describe("classifyQuery — tolerance fautes de frappe", () => {
  it("reconnait taxe fonciere avec accent", () => {
    expect(classifyQuery("taxe fonci\u00e8re \u00e0 Marseille")).toBe("fiscalite_locale");
  });

  it("reconnait convention sans accent", () => {
    expect(classifyQuery("convention collective metallurgie")).toBe("convention_collective");
  });

  it("reconnait simuler avec typo er/ez", () => {
    expect(classifyQuery("simuler impot sur le revenu")).toBe("simulation_ir");
  });

  it("reconnait SIRET en minuscules", () => {
    expect(classifyQuery("siret de l'entreprise Acme")).toBe("recherche_entreprise");
  });

  it("reconnait frais notaire en majuscules", () => {
    expect(classifyQuery("FRAIS DE NOTAIRE 300000")).toBe("simulation_frais_notaire");
  });
});

// T37 -- Edge cases : requetes mixtes multi-domaines
describe("classifyQuery — requetes mixtes", () => {
  it("priorise simulation TF quand taxe fonciere + combien + surface", () => {
    expect(classifyQuery("combien de taxe fonciere pour une maison de 120m2 a Nantes")).toBe("simulation_tf");
  });

  it("route vers DVF quand acheter + maison + commune", () => {
    expect(classifyQuery("acheter une maison a Rennes")).toBe("transactions_dvf");
  });

  it("ne confond pas code postal avec SIRET", () => {
    expect(classifyQuery("taxe fonciere 93140")).toBe("fiscalite_locale");
  });

  it("ne confond pas un prix avec un code postal", () => {
    expect(classifyQuery("frais notaire 250000 euros ancien")).toBe("simulation_frais_notaire");
  });

  it("route vers fiches quand aucun pattern specifique", () => {
    expect(classifyQuery("comment inscrire mon enfant a l'ecole")).toBe("fiches_dila");
  });

  it("route IR avec situation familiale complete", () => {
    expect(classifyQuery("combien d'impot sur le revenu pour 50000 euros marie 2 enfants")).toBe("simulation_ir");
  });
});

// T29 -- Patterns resultats lycee (IVAL)
describe("classifyQuery — resultats lycee", () => {
  it("route les requetes IVAL explicites", () => {
    expect(classifyQuery("IVAL lycees de Lyon")).toBe("resultats_lycee");
    expect(classifyQuery("ival")).toBe("resultats_lycee");
  });

  it("route les resultats et classements", () => {
    expect(classifyQuery("resultats des lycees a Bordeaux")).toBe("resultats_lycee");
    expect(classifyQuery("classement lycees Paris")).toBe("resultats_lycee");
    expect(classifyQuery("palmares des lycees")).toBe("resultats_lycee");
  });

  it("route les taux de reussite bac", () => {
    expect(classifyQuery("taux de reussite au bac Lyon")).toBe("resultats_lycee");
    expect(classifyQuery("taux de mentions lycee Lacassagne")).toBe("resultats_lycee");
  });

  it("route les meilleurs lycees", () => {
    expect(classifyQuery("meilleur lycee a Nantes")).toBe("resultats_lycee");
    expect(classifyQuery("top lycees Marseille")).toBe("resultats_lycee");
  });

  it("route la valeur ajoutee lycee", () => {
    expect(classifyQuery("valeur ajoutee lycee a Toulouse")).toBe("resultats_lycee");
  });
});

// T28 -- Patterns etablissement scolaire
describe("classifyQuery — education", () => {
  it("route les recherches d'ecoles par commune", () => {
    expect(classifyQuery("ecoles a Lyon")).toBe("etablissement_scolaire");
    expect(classifyQuery("ecoles de Bondy")).toBe("etablissement_scolaire");
  });

  it("route les recherches de colleges", () => {
    expect(classifyQuery("colleges a Marseille")).toBe("etablissement_scolaire");
    expect(classifyQuery("college public dans le 93")).toBe("etablissement_scolaire");
  });

  it("route les recherches de lycees", () => {
    expect(classifyQuery("lycees de Bordeaux")).toBe("etablissement_scolaire");
    expect(classifyQuery("lycee prive a Nantes")).toBe("etablissement_scolaire");
  });

  it("route les etablissements scolaires", () => {
    expect(classifyQuery("etablissements scolaires a Toulouse")).toBe("etablissement_scolaire");
    expect(classifyQuery("quels lycees a Strasbourg")).toBe("etablissement_scolaire");
  });

  it("route l'annuaire et la liste d'etablissements", () => {
    expect(classifyQuery("liste des ecoles de Lille")).toBe("etablissement_scolaire");
    expect(classifyQuery("trouver un college a Rennes")).toBe("etablissement_scolaire");
  });

  it("ne confond pas avec les fiches demarches scolaires", () => {
    // "inscrire mon enfant" n'a pas de pattern ecole+commune
    expect(classifyQuery("comment inscrire mon enfant a l'ecole")).toBe("fiches_dila");
  });
});

// T28 -- extractTypeEtablissement
describe("extractTypeEtablissement", () => {
  it("extrait ecole et variantes", () => {
    expect(extractTypeEtablissement("ecoles a Lyon")).toBe("ecole");
    expect(extractTypeEtablissement("maternelle a Paris")).toBe("ecole");
    expect(extractTypeEtablissement("elementaire a Bondy")).toBe("ecole");
    expect(extractTypeEtablissement("primaire a Nantes")).toBe("ecole");
  });

  it("extrait college", () => {
    expect(extractTypeEtablissement("college public Marseille")).toBe("college");
    expect(extractTypeEtablissement("les colleges de Lyon")).toBe("college");
  });

  it("extrait lycee", () => {
    expect(extractTypeEtablissement("lycee a Bordeaux")).toBe("lycee");
    expect(extractTypeEtablissement("lycées de Toulouse")).toBe("lycee");
  });

  it("retourne null sans type explicite", () => {
    expect(extractTypeEtablissement("etablissements a Lyon")).toBeNull();
    expect(extractTypeEtablissement("scolarite a Paris")).toBeNull();
  });
});

// T47 -- acces_soins dispatch
describe("classifyQuery — acces_soins", () => {
  it("route les requetes acces aux soins", () => {
    expect(classifyQuery("acces aux soins a Lyon")).toBe("acces_soins");
    expect(classifyQuery("densite medecins generalistes departement 93")).toBe("acces_soins");
    expect(classifyQuery("medecin traitant a Bondy")).toBe("acces_soins");
    expect(classifyQuery("desert medical en Seine-Saint-Denis")).toBe("acces_soins");
    expect(classifyQuery("zone sous-dotee medecins")).toBe("acces_soins");
    expect(classifyQuery("patientele moyenne generalistes")).toBe("acces_soins");
  });

  it("route les specialistes", () => {
    expect(classifyQuery("nombre ophtalmologues a Paris")).toBe("acces_soins");
    expect(classifyQuery("effectif dermatologues departement 75")).toBe("acces_soins");
    expect(classifyQuery("densite pediatres en Isere")).toBe("acces_soins");
  });

  it("route demographie medicale et offre de soins", () => {
    expect(classifyQuery("demographie medicale departement 69")).toBe("acces_soins");
    expect(classifyQuery("offre de soins a Marseille")).toBe("acces_soins");
    expect(classifyQuery("primo-installations medecins generalistes")).toBe("acces_soins");
  });
});

// T48 -- insertion_pro dispatch
describe("classifyQuery — insertion_pro", () => {
  it("route les requetes insertion professionnelle", () => {
    expect(classifyQuery("insertion professionnelle lycee pro Lyon")).toBe("insertion_pro");
    expect(classifyQuery("inserjeunes")).toBe("insertion_pro");
    expect(classifyQuery("taux d'emploi apres un bac pro")).toBe("insertion_pro");
  });

  it("route devenir des lyceens et apprentis", () => {
    expect(classifyQuery("devenir des lyceens professionnels")).toBe("insertion_pro");
    expect(classifyQuery("que deviennent les apprentis")).toBe("insertion_pro");
  });

  it("route debouches et poursuite d'etudes voie pro", () => {
    expect(classifyQuery("debouches apres un CAP coiffure")).toBe("insertion_pro");
    expect(classifyQuery("poursuite d'etudes apres bac pro")).toBe("insertion_pro");
    expect(classifyQuery("emploi 6 mois apres sortie BTS")).toBe("insertion_pro");
  });

  it("ne confond pas avec Parcoursup ou education", () => {
    expect(classifyQuery("formation BTS informatique sur Parcoursup")).toBe("parcoursup");
    expect(classifyQuery("lycees a Lyon")).toBe("etablissement_scolaire");
  });
});

// T55 -- securite dispatch
describe("classifyQuery -- securite", () => {
  it("route les requetes securite/delinquance", () => {
    expect(classifyQuery("delinquance a Lyon")).toBe("securite");
    expect(classifyQuery("criminalite departement 93")).toBe("securite");
    expect(classifyQuery("securite a Marseille")).toBe("securite");
    expect(classifyQuery("insecurite Paris")).toBe("securite");
  });

  it("route les requetes avec indicateurs specifiques", () => {
    expect(classifyQuery("cambriolages par commune a Lyon")).toBe("securite");
    expect(classifyQuery("taux de delinquance departement 93")).toBe("securite");
    expect(classifyQuery("homicides statistiques departement 75")).toBe("securite");
  });
});

// T55 -- risques naturels dispatch
describe("classifyQuery -- risques_naturels", () => {
  it("route les requetes risques naturels", () => {
    expect(classifyQuery("risques naturels a Nimes")).toBe("risques_naturels");
    expect(classifyQuery("risques technologiques commune Rouen")).toBe("risques_naturels");
  });

  it("route les requetes CatNat", () => {
    expect(classifyQuery("arretes catastrophe naturelle Paris")).toBe("risques_naturels");
    expect(classifyQuery("catnat commune de Nimes")).toBe("risques_naturels");
  });

  it("route les risques specifiques", () => {
    expect(classifyQuery("zone inondable commune de Vaison-la-Romaine")).toBe("risques_naturels");
    expect(classifyQuery("georisques Lyon")).toBe("risques_naturels");
    expect(classifyQuery("retrait-gonflement argile")).toBe("risques_naturels");
  });

  it("ne confond pas avec d'autres categories", () => {
    expect(classifyQuery("securite a Paris")).toBe("securite");
    expect(classifyQuery("prix immobilier a Nimes")).toBe("transactions_dvf");
  });
});

// T61 -- jurisprudence dispatch
describe("classifyQuery -- jurisprudence", () => {
  it("route les requetes jurisprudence", () => {
    expect(classifyQuery("jurisprudence licenciement abusif")).toBe("jurisprudence");
    expect(classifyQuery("arret cour de cassation contrat")).toBe("jurisprudence");
    expect(classifyQuery("cour d'appel Paris expulsion")).toBe("jurisprudence");
    expect(classifyQuery("tribunal de commerce liquidation")).toBe("jurisprudence");
  });

  it("ne confond pas avec d'autres categories", () => {
    expect(classifyQuery("prix immobilier Paris")).toBe("transactions_dvf");
    expect(classifyQuery("convention collective batiment")).toBe("convention_collective");
  });
});

// T61 -- code juridique dispatch
describe("classifyQuery -- code_juridique", () => {
  it("route les requetes code juridique", () => {
    expect(classifyQuery("code civil article 1242")).toBe("code_juridique");
    expect(classifyQuery("code du travail conge")).toBe("code_juridique");
    expect(classifyQuery("code penal vol qualifie")).toBe("code_juridique");
    expect(classifyQuery("article L1237-19 code du travail")).toBe("code_juridique");
  });

  it("ne confond pas avec d'autres categories", () => {
    expect(classifyQuery("jurisprudence cour de cassation travail")).toBe("jurisprudence");
  });
});

// T72 -- journal officiel dispatch
describe("classifyQuery -- journal_officiel", () => {
  it("route les requetes Journal Officiel explicites", () => {
    expect(classifyQuery("journal officiel du 5 mars")).toBe("journal_officiel");
    expect(classifyQuery("JORF teletravail")).toBe("journal_officiel");
    expect(classifyQuery("publie au JO 2024")).toBe("journal_officiel");
    expect(classifyQuery("publie au jorf")).toBe("journal_officiel");
  });

  it("ne confond pas avec texte_legal", () => {
    expect(classifyQuery("decret d'application teletravail")).toBe("texte_legal");
    expect(classifyQuery("loi n° 2024-01 sur les retraites")).toBe("texte_legal");
  });
});

// T74 -- aide sociale dispatch
describe("classifyQuery -- aide_sociale", () => {
  it("route les requetes allocataires CAF", () => {
    expect(classifyQuery("allocataires RSA a Lyon")).toBe("aide_sociale");
    expect(classifyQuery("nombre de foyers APL departement 93")).toBe("aide_sociale");
    expect(classifyQuery("beneficiaires AAH commune de Bondy")).toBe("aide_sociale");
    expect(classifyQuery("statistiques CAF departement 75")).toBe("aide_sociale");
    expect(classifyQuery("combien d'allocataires RSA a Paris")).toBe("aide_sociale");
  });

  it("ne confond pas avec fiches dila", () => {
    expect(classifyQuery("comment demander le RSA")).toBe("fiches_dila");
    expect(classifyQuery("conditions pour l'APL")).toBe("fiches_dila");
    expect(classifyQuery("demarche AAH handicap")).toBe("fiches_dila");
  });
});

// T61 -- texte legal dispatch
describe("classifyQuery -- texte_legal", () => {
  it("route les requetes texte legal", () => {
    expect(classifyQuery("loi n° 78-17 informatique libertes")).toBe("texte_legal");
    expect(classifyQuery("decret d'application teletravail")).toBe("texte_legal");
    expect(classifyQuery("arrete ministeriel vaccination")).toBe("texte_legal");
    expect(classifyQuery("ordonnance du 27 mars 2020")).toBe("texte_legal");
    expect(classifyQuery("texte legislatif protection donnees")).toBe("texte_legal");
  });

  it("ne confond pas avec d'autres categories", () => {
    expect(classifyQuery("code civil responsabilite")).toBe("code_juridique");
    expect(classifyQuery("jurisprudence cour cassation")).toBe("jurisprudence");
  });
});

// T73 -- classifyQuery : marche_public
describe("classifyQuery -- marche_public", () => {
  it("detecte les marches publics", () => {
    expect(classifyQuery("marche public travaux")).toBe("marche_public");
    expect(classifyQuery("appel d'offres informatique")).toBe("marche_public");
    expect(classifyQuery("MAPA fournitures bureau")).toBe("marche_public");
    expect(classifyQuery("avis d'attribution marche")).toBe("marche_public");
    expect(classifyQuery("BOAMP departement 75")).toBe("marche_public");
    expect(classifyQuery("delegation de service public transport")).toBe("marche_public");
    expect(classifyQuery("commande publique nettoyage")).toBe("marche_public");
  });

  it("ne confond pas avec recherche fiche", () => {
    expect(classifyQuery("comment se passe un contrat de travail")).not.toBe("marche_public");
    expect(classifyQuery("marche alimentaire Lyon")).not.toBe("marche_public");
  });
});

// T80 -- classifyQuery : annonce_legale
describe("classifyQuery -- annonce_legale", () => {
  it("detecte les annonces BODACC", () => {
    expect(classifyQuery("BODACC liquidation judiciaire")).toBe("annonce_legale");
    expect(classifyQuery("annonce legale entreprise")).toBe("annonce_legale");
    expect(classifyQuery("procedure collective SAS Martin")).toBe("annonce_legale");
    expect(classifyQuery("redressement judiciaire SARL")).toBe("annonce_legale");
    expect(classifyQuery("liquidation judiciaire boutique Paris")).toBe("annonce_legale");
    expect(classifyQuery("radiation RCS entreprise")).toBe("annonce_legale");
    expect(classifyQuery("cessation de paiement")).toBe("annonce_legale");
    expect(classifyQuery("cession d'entreprise SARL")).toBe("annonce_legale");
  });

  it("ne confond pas avec autre chose", () => {
    expect(classifyQuery("comment creer une societe")).not.toBe("annonce_legale");
    expect(classifyQuery("radiation fiscale")).not.toBe("annonce_legale");
  });
});

// T72 -- extractTypeTexteJorf
describe("extractTypeTexteJorf", () => {
  it("detecte LOI", () => {
    expect(extractTypeTexteJorf("loi sur les retraites")).toBe("LOI");
    expect(extractTypeTexteJorf("loi de finances 2025")).toBe("LOI");
  });

  it("detecte DECRET", () => {
    expect(extractTypeTexteJorf("decret d'application")).toBe("DECRET");
    expect(extractTypeTexteJorf("décret du 15 mars")).toBe("DECRET");
  });

  it("detecte ARRETE", () => {
    expect(extractTypeTexteJorf("arrete ministeriel vaccination")).toBe("ARRETE");
    expect(extractTypeTexteJorf("arrêté préfectoral")).toBe("ARRETE");
  });

  it("detecte ORDONNANCE", () => {
    expect(extractTypeTexteJorf("ordonnance 2020")).toBe("ORDONNANCE");
  });

  it("detecte CIRCULAIRE", () => {
    expect(extractTypeTexteJorf("circulaire teletravail")).toBe("CIRCULAIRE");
  });

  it("retourne null si aucune nature reconnue", () => {
    expect(extractTypeTexteJorf("protection donnees")).toBeNull();
    expect(extractTypeTexteJorf("JORF teletravail")).toBeNull();
  });
});

// T85a -- classifyQuery : budget_commune (corrections Sprint 24)
describe("classifyQuery -- budget_commune", () => {
  it("detecte le budget primitif", () => {
    expect(classifyQuery("Quel est le budget primitif de Nantes ?")).toBe("budget_commune");
    expect(classifyQuery("budget primitif 2024 commune")).toBe("budget_commune");
    expect(classifyQuery("budget supplementaire Lyon")).toBe("budget_commune");
    expect(classifyQuery("budget communal de Paris")).toBe("budget_commune");
  });

  it("detecte les formulations classiques", () => {
    expect(classifyQuery("budget de la commune de Bordeaux")).toBe("budget_commune");
    expect(classifyQuery("finances locales Nantes")).toBe("budget_commune");
    expect(classifyQuery("OFGL comptes communes")).toBe("budget_commune");
  });
});

// T85b -- classifyQuery : subvention (corrections Sprint 24)
describe("classifyQuery -- subvention", () => {
  it("detecte les pluriels et feminins", () => {
    expect(classifyQuery("Quelles subventions ont ete attribuees a des associations culturelles ?")).toBe("subvention");
    expect(classifyQuery("Les organismes publics versent des subventions")).toBe("subvention");
    expect(classifyQuery("subventions attribuees a des associations sportives")).toBe("subvention");
  });

  it("detecte les formulations classiques", () => {
    expect(classifyQuery("montant des subventions accordees")).toBe("subvention");
    expect(classifyQuery("subventions versees par la commune")).toBe("subvention");
    expect(classifyQuery("subventions departement Rhone")).toBe("subvention");
  });
});

// T85d -- classifyQuery : sirene_historique (corrections Sprint 24)
describe("classifyQuery -- sirene_historique", () => {
  it("detecte le feminin pluriel de cree", () => {
    expect(classifyQuery("Combien d'entreprises ont ete creees dans le secteur informatique a Paris ?")).toBe("sirene_historique");
    expect(classifyQuery("entreprises creees dans le departement 75")).toBe("sirene_historique");
  });

  it("detecte les formulations classiques", () => {
    expect(classifyQuery("creation d'entreprises secteur batiment")).toBe("sirene_historique");
    expect(classifyQuery("historique SIRENE creation")).toBe("sirene_historique");
    expect(classifyQuery("combien d'entreprises ouvertes a Lyon")).toBe("sirene_historique");
  });
});
