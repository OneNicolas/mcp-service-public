import type { Env, ToolResult } from "../types.js";
import { rechercherFiche } from "./rechercher-fiche.js";
import { rechercherDoctrineFiscale } from "./rechercher-doctrine-fiscale.js";
import { consulterFiscaliteLocale } from "./consulter-fiscalite-locale.js";
import { consulterTransactionsImmobilieres } from "./consulter-transactions-immobilieres.js";
import { simulerTaxeFonciere } from "./simuler-taxe-fonciere.js";
import { simulerFraisNotaire } from "./simuler-frais-notaire.js";
import { consulterZonageImmobilier } from "./consulter-zonage-immobilier.js";
import { simulerImpotRevenu } from "./simuler-impot-revenu.js";
import { rechercherConventionCollective } from "./rechercher-convention-collective.js";
import { rechercherEntreprise } from "./rechercher-entreprise.js";
import { rechercherEtablissementScolaire } from "./rechercher-etablissement-scolaire.js";
import { consulterResultatsLycee } from "./consulter-resultats-lycee.js";
import { consulterEvaluationsNationales } from "./consulter-evaluations-nationales.js";
import { consulterParcoursup } from "./consulter-parcoursup.js";
import { consulterAccesSoins } from "./consulter-acces-soins.js";
import { consulterInsertionProfessionnelle } from "./consulter-insertion-professionnelle.js";
import { consulterSecurite } from "./consulter-securite.js";
import { consulterRisquesNaturels } from "./consulter-risques-naturels.js";

interface RechercherArgs {
  query: string;
  limit?: number;
}

export type QueryCategory =
  | "fiscalite_locale"
  | "doctrine_bofip"
  | "fiches_dila"
  | "transactions_dvf"
  | "simulation_tf"
  | "simulation_frais_notaire"
  | "zonage_immobilier"
  | "simulation_ir"
  | "convention_collective"
  | "recherche_entreprise"
  | "etablissement_scolaire"
  | "resultats_lycee"
  | "evaluations_nationales"
  | "parcoursup"
  | "acces_soins"
  | "insertion_pro"
  | "securite"
  | "risques_naturels";

/** Recherche unifiee : dispatche automatiquement vers la bonne source */
export async function rechercher(
  args: RechercherArgs,
  env: Env,
): Promise<ToolResult> {
  // Normalise query en string (protege contre les tableaux/objets envoyes par certains clients MCP)
  const rawQuery = args.query;
  const query = (typeof rawQuery === "string"
    ? rawQuery
    : Array.isArray(rawQuery)
      ? (rawQuery as unknown as string[]).join(" ")
      : String(rawQuery ?? "")
  ).trim();
  const { limit = 5 } = args;

  if (!query || query.length < 2) {
    return {
      content: [{ type: "text", text: "Veuillez fournir une question ou des termes de recherche." }],
      isError: true,
    };
  }

  const category = classifyQuery(query);

  switch (category) {
    case "simulation_tf": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const surface = extractSurface(query);
      const typeBien = extractTypeBien(query);
      const loc = communeName ? { commune: communeName } : codePostal ? { code_postal: codePostal } : null;

      if (loc && surface && typeBien) {
        const result = await simulerTaxeFonciere({ ...loc, surface, type_bien: typeBien });
        return prefixResult(result, "🧮 Simulation taxe fonciere");
      }

      if (loc) {
        const result = await consulterFiscaliteLocale(loc);
        return prefixResult(result, "📍 Fiscalite locale (parametres insuffisants pour simulation, utiliser `simuler_taxe_fonciere` avec surface et type de bien)");
      }

      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (service-public.fr)");
    }

    case "simulation_frais_notaire": {
      const prix = extractPrix(query);
      const typeAchat = extractTypeAchat(query);

      if (prix) {
        const result = await simulerFraisNotaire({ prix, type: typeAchat ?? "ancien" });
        const suffix = typeAchat ? "" : " (ancien par defaut)";
        return prefixResult(result, `🏠 Simulation frais de notaire${suffix}`);
      }

      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (precisez un montant pour simuler les frais de notaire via `simuler_frais_notaire`)");
    }

    case "zonage_immobilier": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      if (communeName) {
        const result = await consulterZonageImmobilier({ commune: communeName });
        return prefixResult(result, "📍 Zonage immobilier");
      }
      if (codePostal) {
        const result = await consulterZonageImmobilier({ code_postal: codePostal });
        return prefixResult(result, "📍 Zonage immobilier");
      }
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (precisez une commune pour le zonage via `consulter_zonage_immobilier`)");
    }

    case "transactions_dvf": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const typeLocal = extractTypeLocal(query);
      if (communeName) {
        const result = await consulterTransactionsImmobilieres({ commune: communeName, type_local: typeLocal ?? undefined });
        return prefixResult(result, "🏠 Transactions immobilieres (DVF)");
      }
      if (codePostal) {
        const result = await consulterTransactionsImmobilieres({ code_postal: codePostal, type_local: typeLocal ?? undefined });
        return prefixResult(result, "🏠 Transactions immobilieres (DVF)");
      }
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (service-public.fr)");
    }

    case "fiscalite_locale": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      if (communeName) {
        const result = await consulterFiscaliteLocale({ commune: communeName });
        return prefixResult(result, "📍 Fiscalite locale");
      }
      if (codePostal) {
        const result = await consulterFiscaliteLocale({ code_postal: codePostal });
        return prefixResult(result, "📍 Fiscalite locale");
      }
      const result = await rechercherDoctrineFiscale({ query, limit });
      return prefixResult(result, "📖 Doctrine fiscale (BOFiP)");
    }

    case "doctrine_bofip": {
      const result = await rechercherDoctrineFiscale({ query, limit });
      return prefixResult(result, "📖 Doctrine fiscale (BOFiP)");
    }

    case "simulation_ir": {
      const revenu = extractRevenuIR(query);
      if (revenu) {
        const situation = extractSituationFamiliale(query);
        const nbEnfants = extractNbEnfants(query);
        const result = await simulerImpotRevenu({
          revenu_net_imposable: revenu,
          ...(situation ? { situation } : {}),
          ...(nbEnfants !== null ? { nb_enfants: nbEnfants } : {}),
        });
        return prefixResult(result, "🧮 Simulation impot sur le revenu");
      }
      // Pas assez d'info — on redirige vers la doctrine avec un message d'aide
      const result = await rechercherDoctrineFiscale({ query: "impot revenu bareme", limit });
      return prefixResult(result, "🧮 Simulation IR (utilisez `simuler_impot_revenu` avec revenu_net_imposable pour une estimation)");
    }

    case "convention_collective": {
      const idcc = extractIDCC(query);
      if (idcc) {
        const result = await rechercherConventionCollective({ idcc });
        return prefixResult(result, "📜 Convention collective");
      }
      // Recherche par mot-cle : nettoyer les termes generiques
      const cleanedQuery = query.replace(/\b(convention|collective|accord|branche|nationale)\b/gi, "").trim() || query;
      const result = await rechercherConventionCollective({ query: cleanedQuery, limit });
      return prefixResult(result, "📜 Convention collective");
    }

    case "recherche_entreprise": {
      const siret = extractSiret(query);
      const siren = siret ? undefined : extractSiren(query);
      const nom = (!siret && !siren) ? query.replace(/\b(entreprise|societe|convention|collective|siret|siren)\b/gi, "").trim() || query : undefined;
      const result = await rechercherEntreprise({ siret: siret ?? undefined, siren: siren ?? undefined, nom });
      return prefixResult(result, "\uD83C\uDFE2 Fiche entreprise");
    }

    case "etablissement_scolaire": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const typeEtab = extractTypeEtablissement(query);
      // Ne pas appeler le tool sans localisation : evite les erreurs de validation isError
      if (!communeName && !codePostal) {
        const result = await rechercherFiche({ query, limit }, env);
        return prefixResult(result, "\uD83D\uDCCB Fiches pratiques (precisez une commune pour rechercher des etablissements scolaires via `rechercher_etablissement_scolaire`)");
      }
      const loc = communeName ? { commune: communeName } : { code_postal: codePostal! };
      const result = await rechercherEtablissementScolaire({ ...loc, type: typeEtab ?? undefined, limit });
      return prefixResult(result, "\uD83C\uDFEB Etablissements scolaires");
    }

    case "resultats_lycee": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const loc = communeName ? { commune: communeName } : codePostal ? { code_postal: codePostal } : {};
      const result = await consulterResultatsLycee({ ...loc, limit });
      return prefixResult(result, "\uD83C\uDF93 Resultats lycees (IVAL)");
    }

    case "evaluations_nationales": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const codeDept = extractCodeDepartement(query);
      const loc = codeDept ? { code_departement: codeDept } : communeName ? { commune: communeName } : codePostal ? { code_postal: codePostal } : {};
      const niveau = extractNiveauScolaire(query);
      const result = await consulterEvaluationsNationales({ ...loc, ...(niveau ? { niveau } : {}) });
      return prefixResult(result, "\uD83D\uDCCA Evaluations nationales");
    }

    case "parcoursup": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const filiere = extractFiliereParcoursup(query);
      // Nettoyer la query des termes generiques pour la recherche textuelle
      const cleanedSearch = query
        .replace(/\b(parcoursup|formation|formations|etudes|etude|superieures?|orientation|post.?bac|admission|voeux|candidature)\b/gi, "")
        .replace(/\b(a|de|pour|dans|en|sur|les|des|du|au)\b/gi, "")
        .trim();
      const recherche = cleanedSearch.length >= 3 ? cleanedSearch : undefined;
      const ville = communeName ?? undefined;
      const result = await consulterParcoursup({
        recherche,
        ville,
        code_postal: codePostal ?? undefined,
        filiere: filiere ?? undefined,
        limit,
      });
      return prefixResult(result, "\uD83C\uDF93 Formations Parcoursup");
    }

    case "acces_soins": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const codeDept = extractCodeDepartement(query);
      const loc = codeDept ? { code_departement: codeDept } : communeName ? { commune: communeName } : codePostal ? { code_postal: codePostal } : {};
      const result = await consulterAccesSoins(loc);
      return prefixResult(result, "\u{1FA7A} Acces aux soins (data.ameli.fr)");
    }

    case "insertion_pro": {
      const communeName = extractCommuneName(query);
      const codeDept = extractCodeDepartement(query);
      const ville = communeName ?? undefined;
      const codeDepartement = codeDept ?? undefined;
      // Nettoyer la query des termes generiques pour la recherche textuelle
      const cleanedSearch = query
        .replace(/\b(insertion|professionnelle|inserjeunes|taux|emploi|apres|sortie|devenir|lyceen|apprenti|debouche|poursuite|etude|etudes)s?\b/gi, "")
        .replace(/\b(a|de|pour|dans|en|sur|les|des|du|au|la|le|d)\b/gi, "")
        .trim();
      const recherche = cleanedSearch.length >= 3 ? cleanedSearch : undefined;
      const insertionResult = await consulterInsertionProfessionnelle({
        recherche,
        ville,
        code_departement: codeDepartement,
        limit,
      });
      return prefixResult(insertionResult, "\uD83D\uDCBC Insertion professionnelle (InserJeunes)");
    }

    case "securite": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const codeDept = extractCodeDepartement(query);
      const loc = codeDept ? { code_departement: codeDept } : communeName ? { commune: communeName } : codePostal ? { code_postal: codePostal } : {};
      const securiteResult = await consulterSecurite(loc);
      return prefixResult(securiteResult, "\uD83D\uDEE1\uFE0F Securite (SSMSI)");
    }

    case "risques_naturels": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const loc = communeName ? { commune: communeName } : codePostal ? { code_postal: codePostal } : {};
      const risquesResult = await consulterRisquesNaturels(loc);
      return prefixResult(risquesResult, "\u26A0\uFE0F Risques naturels (Georisques)");
    }

    case "fiches_dila": {
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (service-public.fr)");
    }
  }
}

/** Classifie la requete pour router vers la bonne source */
export function classifyQuery(query: string): QueryCategory {
  const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Patterns simulation TF (avant fiscalite locale)
  const simulationTfPatterns = [
    /\bcombien\b.*\btaxe\s+foncier/,
    /\bestimer?\b.*\btaxe\s+foncier/,
    /\bsimuler?\b.*\b(tf|taxe\s+foncier)/,
    /\btaxe\s+foncier.*\b(pour|sur)\s+(un|une|mon|ma|notre)\b/,
    /\bcalcul(er)?\b.*\btaxe\s+foncier/,
    /\b(montant|cout)\b.*\btaxe\s+foncier/,
    /\btaxe\s+foncier.*\b\d+\s*m/,
  ];

  for (const pattern of simulationTfPatterns) {
    if (pattern.test(q)) return "simulation_tf";
  }

  // T15 -- Patterns frais de notaire (avant DVF)
  const fraisNotairePatterns = [
    /\bfrais\s+(de\s+)?notaire\b/,
    /\bfrais\s+d.?acquisition\b/,
    /\bdroits?\s+(de\s+)?mutation\b/,
    /\bsimuler?\b.*\bnotaire\b/,
    /\bcombien\b.*\bnotaire\b/,
    /\b(cout|montant)\b.*\bnotaire\b/,
    /\bemoluments?\b.*\bnotaire\b/,
    /\bdmto\b/,
  ];

  for (const pattern of fraisNotairePatterns) {
    if (pattern.test(q)) return "simulation_frais_notaire";
  }

  // T15 -- Patterns zonage immobilier (avant DVF)
  const zonagePatterns = [
    /\bzone\s+(abc|a\s*bis|pinel|tendue|detendue)\b/,
    /\bzonage\b.*\b(immobilier|abc|pinel|logement)\b/,
    /\bptz\b.*\b(eligible|zone|commune)\b/,
    /\bpinel\b.*\b(eligible|zone|commune)\b/,
    /\bdenormandie\b.*\b(eligible|zone)\b/,
    /\bplafond\b.*\b(loyer|ressource).*\b(pinel|zone)\b/,
    /\bzone\b.*\b(b1|b2|abis)\b/,
    /\blli\b.*\beligible\b/,
  ];

  for (const pattern of zonagePatterns) {
    if (pattern.test(q)) return "zonage_immobilier";
  }

  // Patterns DVF / immobilier
  const dvfPatterns = [
    /\bprix\b.*\b(immobilier|m2|m²|metre|appart|maison)\b/,
    /\b(transaction|mutation|vente)s?\s+(immobili|foncier)/,
    /\bprix\s+(au\s+)?m(2|²|etre)/,
    /\b(dvf|valeurs?\s+foncier)\b/,
    /\bmarche\s+immobilier\b/,
    /\b(acheter|achat|vendre|vente)\b.*\b(appartement|maison|bien|immobilier)\b/,
    /\bprix\s+(des?\s+)?(appartement|maison|bien|immobilier)s?\b/,
    /\bcombien\s+coute\b.*\b(appartement|maison|m2|m²)\b/,
  ];

  for (const pattern of dvfPatterns) {
    if (pattern.test(q)) return "transactions_dvf";
  }

  // T32 -- Patterns recherche entreprise (SIRET/SIREN)
  // Concatener les chiffres pour detecter SIRET avec espaces
  const digitsOnly = query.replace(/[^\d]/g, "");
  if (/^\d{14}$/.test(digitsOnly)) return "recherche_entreprise";
  if (/\b\d{14}\b/.test(query)) return "recherche_entreprise";
  if (/\b\d{9}\b/.test(query) && /\b(siren|entreprise|societe)\b/.test(q)) return "recherche_entreprise";
  if (/\bsiret\b/.test(q)) return "recherche_entreprise";
  if (/\bsiren\b/.test(q)) return "recherche_entreprise";
  if (/\b(convention|idcc)\b.*\b(entreprise|societe)\b/.test(q)) return "recherche_entreprise";
  if (/\b(entreprise|societe)\b.*\b(convention|idcc)\b/.test(q)) return "recherche_entreprise";

  // T28 -- Patterns convention collective
  const conventionPatterns = [
    /\bconvention\s+collective\b/,
    /\bidcc\b/,
    /\baccord\s+de\s+branche\b/,
    /\baccord\s+national\b.*\b(interprofessionnel|branche)\b/,
    /\bconvention\b.*\b(boulangerie|metallurgie|batiment|restauration|commerce|hotellerie|transport|pharmacie|coiffure|nettoyage|securite|syntec|bureaux|spectacle|animation|aide\s+a\s+domicile|proprete)\b/,
    /\b(boulangerie|metallurgie|syntec|hcr|batiment|restauration)\b.*\bconvention\b/,
    /\bidcc\s*\d{1,4}\b/,
  ];

  for (const pattern of conventionPatterns) {
    if (pattern.test(q)) return "convention_collective";
  }

  // T47 -- Patterns acces aux soins
  const accesSoinsPatterns = [
    /\bacces\s+aux?\s+soins?\b/,
    /\bdensite\b.*\b(medecin|generaliste|specialiste|medic)s?\b/,
    /\b(medecin|generaliste|specialiste)s?\b.*\b(densite|nombre|effectif|combien)\b/,
    /\bmedecin\s+traitant\b/,
    /\bpatientele\b/,
    /\bdeserts?\s+(medical|medicaux)\b/,
    /\bzone\s+sous.?dotee\b/,
    /\bprimo.?install(ation|e)s?\b.*\b(medecin|generaliste)s?\b/,
    /\bdemographie\s+(medicale|sanitaire)\b/,
    /\boffre\s+de\s+soins?\b/,
    /\b(ophtalmologue|dermatologue|cardiologue|pediatre|gynecologue|psychiatre)s?\b.*\b(nombre|effectif|densite)\b/,
    /\b(nombre|effectif|densite)\b.*\b(ophtalmologue|dermatologue|cardiologue|pediatre|gynecologue|psychiatre)s?\b/,
  ];

  for (const pattern of accesSoinsPatterns) {
    if (pattern.test(q)) return "acces_soins";
  }

  // T53 -- Patterns securite/delinquance
  const securitePatterns = [
    /\b(delinquance|criminalite|securite|insecurite)\b/,
    /\b(cambriolage|vol|agression|violence)s?\b.*\b(commune|ville|departement|quartier)\b/,
    /\btaux\b.*\b(criminalite|delinquance|vol|cambriolage)s?\b/,
    /\b(homicide|meurtre|crime)s?\b.*\b(statistiques?|chiffres?|nombre|taux)\b/,
  ];

  for (const pattern of securitePatterns) {
    if (pattern.test(q)) return "securite";
  }

  // T54 -- Patterns risques naturels
  const risquesNaturelsPatterns = [
    /\b(risques?)\b.*\b(naturels?|technologiques?|inondation|sism|seisme)\b/,
    /\bcatnat\b/,
    /\bcatastrophe\b.*\bnaturelles?\b/,
    /\b(georisques?|zone\s+inondable|argile|retrait.gonflement)\b/,
    /\b(inondation|seisme|mouvement.de.terrain|feu.de.foret)\b.*\b(risque|zone|commune)\b/,
  ];

  for (const pattern of risquesNaturelsPatterns) {
    if (pattern.test(q)) return "risques_naturels";
  }

  // T48 -- Patterns insertion professionnelle (avant Parcoursup et education general)
  const insertionProPatterns = [
    /\binsertion\s+professionnelle\b/,
    /\binserjeunes\b/,
    /\btaux\s+d.?emploi\b.*\b(apres|sortie|cap|bac\s*pro|bts|lycee|formation)\b/,
    /\b(apres|sortie)\b.*\b(cap|bac\s*pro|bts|mention\s+complementaire)\b.*\b(emploi|travail|insertion)\b/,
    /\b(emploi|travail|insertion)\b.*\b(apres|sortie)\b.*\b(cap|bac\s*pro|bts)\b/,
    /\b(devenir|deviennent)\b.*\b(lyceens?|apprentis?|eleves?\s+pro)\b/,
    /\b(lyceens?|apprentis?)\b.*\b(devenir|deviennent)\b/,
    /\b(cap|bac\s*pro|bts)\b.*\b(debouches?|insertion|emploi\s+6\s*mois)\b/,
    /\bdebouches?\b.*\b(cap|bac\s*pro|bts|voie\s+pro|lycee\s+pro)\b/,
    /\bpoursuite\s+d.?etudes?\b.*\b(cap|bac\s*pro|bts|voie\s+pro|lycee\s+pro)\b/,
    /\b(valeur\s+ajoutee|va)\b.*\b(insertion|emploi)\b.*\b(lycee|pro)\b/,
  ];

  for (const pattern of insertionProPatterns) {
    if (pattern.test(q)) return "insertion_pro";
  }

  // T42 -- Patterns Parcoursup (avant evaluations nationales et education general)
  const parcoursupPatterns = [
    /\bparcoursup\b/,
    /\bformation(s)?\s+(superieure|post.?bac|enseignement\s+superieur)\b/,
    // Filieres non ambigues : matchent seules
    /\b(cpge|las|ifsi|dcg)\b/,
    /\bdn\s*made\b/,
    // Filieres ambigues : requierent un mot supplementaire
    /\b(but|bts|prepa|pass)\b\s+\w/,
    /\blicence\b.*\b(a|de|pour|dans|universite|fac)\b/,
    /\b(a|de|pour|dans)\b.*\blicence\b/,
    /\borientation\b.*\b(post.?bac|superieur|etudes?)\b/,
    /\betudes?\s+superieure?s?\b/,
    /\b(admission|admis|selectivite|taux\s+d.?acces)\b.*\b(formation|but|bts|licence|cpge)\b/,
    /\bvoeux\b.*\b(parcoursup|formation)\b/,
    /\bpost.?bac\b/,
    /\becole\s+d.?ingenieur\b/,
  ];

  for (const pattern of parcoursupPatterns) {
    if (pattern.test(q)) return "parcoursup";
  }

  // T39 -- Patterns evaluations nationales (avant IVAL et education general)
  const evalNatPatterns = [
    /\bevaluations?\s+nationales?\b/,
    /\bscores?\s+(6eme|sixieme|ce2)\b/,
    /\b(6eme|sixieme|ce2)\b.*\b(scores?|resultats?|niveau)\b/,
    /\bresultats?\b.*\b(6eme|sixieme|ce2)\b/,
    /\bips\b.*\b(departement|dept|moyen)\b/,
    /\bniveau\s+scolaire\b.*\b(departement|dept)\b/,
    /\b(departement|dept)\b.*\b(scores?|evaluations?|niveau\s+scolaire)\b/,
    /\btaux\s+(de\s+)?maitrise\b.*\b(ce2|departement)\b/,
  ];

  for (const pattern of evalNatPatterns) {
    if (pattern.test(q)) return "evaluations_nationales";
  }

  // T29 -- Patterns resultats lycee (IVAL) — avant education general
  const ivalPatterns = [
    /\b(resultats?|classements?|palmares|valeur\s+ajoutee|ival)\b.*\blycees?\b/,
    /\blycees?\b.*\b(resultats?|classements?|palmares|valeur\s+ajoutee|ival)\b/,
    /\btaux\s+(de\s+)?(reussite|acces|mentions?)\b.*\b(lycees?|bac)\b/,
    /\b(meilleurs?|pires?|top)\s+lycees?\b/,
    /\blycees?\b.*\b(meilleurs?|performances?|reussite\s+bac)\b/,
    /\bival\b/,
    /\b(reussite|mentions?)\b.*\bbac\b.*\b(lycees?|commune|ville)\b/,
  ];

  for (const pattern of ivalPatterns) {
    if (pattern.test(q)) return "resultats_lycee";
  }

  // T28 -- Patterns etablissement scolaire
  // Guard : exclure les requetes de type demarche/inscription (route fiches_dila)
  const educationExclude = /\b(inscrire|inscription|droit|aide|allocation|bourse|comment|procedure|demarche)\b/;
  if (!educationExclude.test(q)) {
    const educationPatterns = [
      /\b(ecole|college|lycee|etablissement\s+scolaire)s?\b.*\b(a|de|pour|dans|commune|ville|pres)\b/,
      /\b(a|de|pour|dans)\b.*\b(ecole|college|lycee)s?\b/,
      /\b(cherche|trouver|liste|annuaire)\b.*\b(ecole|college|lycee|etablissement)s?\b/,
      /\b(ecole|college|lycee)s?\s+(public|prive|maternelle|elementaire|professionnel)s?\b/,
      /\bquel(le)?s?\s+(ecole|college|lycee)s?\b/,
      /\betablissement(s)?\s+scolaire(s)?\b/,
    ];

    for (const pattern of educationPatterns) {
      if (pattern.test(q)) return "etablissement_scolaire";
    }
  }

  // T24 -- Patterns simulation IR
  const simulationIrPatterns = [
    /\bsimuler?\b.*\b(ir|impot\s+sur\s+le\s+revenu|impot\s+revenu)\b/,
    /\b(calculer?|estimer?)\b.*\b(ir|impot\s+sur\s+le\s+revenu)\b/,
    /\bcombien\b.*\b(ir|impot\s+sur\s+le\s+revenu|impot\s+revenu)\b/,
    /\bbareme\b.*\b(ir|impot|progressif)\b/,
    /\bquotient\s+familial\b/,
    /\b(tmi|taux\s+marginal)\b.*\b(imposition|impot)\b/,
    /\bdecote\b.*\b(ir|impot)\b/,
  ];

  for (const pattern of simulationIrPatterns) {
    if (pattern.test(q)) return "simulation_ir";
  }

  // Patterns fiscalite locale
  const fiscaliteLocalePatterns = [
    /\btaux\b.*\bfoncier/,
    /\btaxe\s+foncier/,
    /\btaux\b.*\b(habitation|teom|cfe)\b/,
    /\b(taxe|taux)\b.*\b(commune|communal|local|ville)\b/,
    /\b(tfb|tfnb|teom|cfe)\b/,
    /\bfiscalite\s+locale\b/,
    /\btaux\s+d.?imposition\b.*\b(commune|local|ville)\b/,
    /\bordures\s+menageres\b.*\btaux\b/,
  ];

  const bofipPatterns = [
    /\b(impot|imposition)\b.*\b(revenu|societe|fortune)\b/,
    /\b(ir|is|tva|bic|bnc|rfpi)\b/,
    /\bcredit\s+d.?impot\b/,
    /\b(deduction|exoneration|abattement|plus.?value|amortissement)\b/,
    /\b(bofip|doctrine\s+fiscale|bulletin\s+officiel)\b/,
    /\bregime\s+fiscal\b/,
    /\b(micro.?entreprise|auto.?entrepreneur)\b.*\b(fiscal|impot|tva)\b/,
    /\bdeficit\s+foncier\b/,
    /\btaxe\s+sur\s+la\s+valeur\s+ajoutee\b/,
    /\b(droits?\s+de\s+succession|donation)\b.*\b(fiscal|impot|exoner)\b/,
  ];

  for (const pattern of fiscaliteLocalePatterns) {
    if (pattern.test(q)) return "fiscalite_locale";
  }

  for (const pattern of bofipPatterns) {
    if (pattern.test(q)) return "doctrine_bofip";
  }

  const fiscKeywords = ["impot", "fiscal", "taxe", "tva", "deduction", "exoneration", "plus-value", "amortissement"];
  const fiscCount = fiscKeywords.filter((k) => q.includes(k)).length;
  if (fiscCount >= 2) return "doctrine_bofip";

  return "fiches_dila";
}

/** Mots-cles thematiques a ne pas confondre avec des noms de commune */
const STOP_LOWER = new Set([
  "la", "le", "les", "des", "une", "un", "mon", "ma", "mes",
  "quel", "cette", "tout", "tous", "son", "ses",
  // mots-cles thematiques courants
  "taxe", "taux", "prix", "zone", "commune", "ville",
  "foncier", "fonciere", "immobilier", "immobiliere",
  "habitation", "impot", "fiscal", "fiscale",
]);

const STOP_UPPER = new Set([
  "TFB", "TFNB", "TEOM", "CFE", "TH", "TVA", "IR", "IS",
  "BOFIP", "REI", "DVF", "TF", "DMTO", "PTZ", "LLI", "ABC",
  "CEHR", "CSG", "CRDS", "PLM", "IDCC", "KALI", "HCR",
  "SIRET", "SIREN",
  "IPS", "IVAL", "DEPP",
]);

/** Tente d'extraire un nom de commune de la requete */
export function extractCommuneName(query: string): string | null {
  // 1. Patterns explicites : "a/de/pour/commune de/ville de COMMUNE"
  const explicitPatterns = [
    /(?:commune\s+de|ville\s+de|taux\s+(?:a|à|de|pour)|prix\s+(?:a|à|de|pour))\s+([a-zàâäéèêëïîôùûüÿç][a-zàâäéèêëïîôùûüÿç\s'-]{1,30})/i,
    /(?:à|a|de|pour)\s+([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ][a-zàâäéèêëïîôùûüÿç][a-zàâäéèêëïîôùûüÿç\s'-]{0,28})/,
  ];

  for (const pattern of explicitPatterns) {
    const match = query.match(pattern);
    if (match?.[1]) {
      const candidate = cleanCommuneCandidate(match[1]);
      if (candidate) return candidate;
    }
  }

  // 2. Mot capitalise en debut de phrase ("Bondy taxe fonciere", "Saint-Denis taux")
  //    Continuation apres espace uniquement si mot capitalise ; apres tiret : tout mot
  const startMatch = query.match(
    /^((?:(?:Saint|Sainte|Le|La|Les|L')[\s-]?)?[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ][a-zàâäéèêëïîôùûüÿç]+(?:-[a-zàâäéèêëïîôùûüÿçA-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]+)*(?:\s[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ][a-zàâäéèêëïîôùûüÿç]+)?)\b/,
  );
  if (startMatch?.[1]) {
    const candidate = cleanCommuneCandidate(startMatch[1]);
    if (candidate) return candidate;
  }

  // 3. Nom compose avec tiret n'importe ou ("Saint-Denis", "Fontenay-sous-Bois")
  const hyphenMatch = query.match(
    /\b((?:(?:Saint|Sainte|Le|La|Les|L')[\s-]?)?[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇa-zàâäéèêëïîôùûüÿç]+-[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇa-zàâäéèêëïîôùûüÿç]+(?:-[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇa-zàâäéèêëïîôùûüÿç]+)*)\b/,
  );
  if (hyphenMatch?.[1]) {
    const candidate = cleanCommuneCandidate(hyphenMatch[1]);
    if (candidate) return candidate;
  }

  // 4. Mots tout en majuscules ("taux PARIS")
  const upperWords = query.match(/\b[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]{2,}(?:[\s-]+[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]{2,})*\b/g);
  if (upperWords?.length) {
    for (const candidate of upperWords) {
      if (!STOP_UPPER.has(candidate)) return candidate;
    }
  }

  return null;
}

/** Nettoie un candidat commune et verifie qu'il n'est pas un faux positif */
function cleanCommuneCandidate(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) return null;

  // Rejeter si c'est un stop word simple
  if (STOP_LOWER.has(trimmed.toLowerCase())) return null;

  // Rejeter si c'est un acronyme fiscal
  if (STOP_UPPER.has(trimmed.toUpperCase())) return null;

  return trimmed.toUpperCase();
}

/** Extrait un code postal 5 chiffres de la requete */
export function extractCodePostal(query: string): string | null {
  const match = query.match(/\b(\d{5})\b/);
  if (!match) return null;
  const cp = match[1];
  // Exclure les nombres qui ressemblent a des prix (> 97999) ou des surfaces
  const num = parseInt(cp, 10);
  if (num < 1000 || num > 97699) return null;
  return cp;
}

/** Extrait le type de bien immobilier de la requete */
export function extractTypeLocal(query: string): string | null {
  const q = query.toLowerCase();
  if (/\bappartement/.test(q)) return "Appartement";
  if (/\bmaison/.test(q)) return "Maison";
  if (/\blocal/.test(q)) return "Local industriel. commercial ou assimile";
  return null;
}

/** T15 -- Extrait un prix en euros de la requete */
export function extractPrix(query: string): number | null {
  // "250000 euros", "250 000 EUR", "250000EUR", "250 000€"
  const matchEuro = query.match(/(\d[\d\s.,]*\d)\s*(?:€|euros?\b|eur\b)/i);
  if (matchEuro) {
    const val = parseNumberFr(matchEuro[1]);
    if (val > 0 && val < 100_000_000) return val;
  }
  // "250k", "250k EUR"
  const matchK = query.match(/(\d+)\s*k\s*(?:€|euros?|eur)?\b/i);
  if (matchK) {
    const val = parseInt(matchK[1], 10) * 1000;
    if (val > 0 && val < 100_000_000) return val;
  }
  // Nombre seul > 10000 dans un contexte frais notaire (deja route)
  const matchBare = query.match(/\b(\d{5,8})\b/);
  if (matchBare) {
    const val = parseInt(matchBare[1], 10);
    if (val >= 10_000 && val < 100_000_000) return val;
  }
  return null;
}

/** T15 -- Extrait le type d'achat ancien/neuf */
export function extractTypeAchat(query: string): "ancien" | "neuf" | null {
  const q = query.toLowerCase();
  if (/\bneuf\b/.test(q) || /\bvefa\b/.test(q)) return "neuf";
  if (/\bancien\b/.test(q)) return "ancien";
  return null;
}

/** Extrait une surface en m2 de la requete */
function extractSurface(query: string): number | null {
  const match = query.match(/(\d+)\s*m[²2]?\b/i);
  if (match) {
    const surface = parseInt(match[1], 10);
    if (surface > 0 && surface < 10000) return surface;
  }
  return null;
}

/** Extrait le type de bien (Maison/Appartement) */
function extractTypeBien(query: string): "Maison" | "Appartement" | null {
  const q = query.toLowerCase();
  if (/\bmaison\b/.test(q)) return "Maison";
  if (/\b(appartement|appart|studio|f[1-6]|t[1-6])\b/.test(q)) return "Appartement";
  return null;
}

/** T28 -- Extrait un revenu imposable d'une query IR */
export function extractRevenuIR(query: string): number | null {
  // "40000 euros", "40 000 EUR", "40000€"
  const matchEuro = query.match(/(\d[\d\s.,]*\d)\s*(?:€|euros?\b|eur\b)/i);
  if (matchEuro) {
    const val = parseNumberFr(matchEuro[1]);
    if (val >= 1_000 && val < 10_000_000) return val;
  }
  // "40k", "40k euros"
  const matchK = query.match(/(\d+)\s*k\s*(?:€|euros?|eur)?\b/i);
  if (matchK) {
    const val = parseInt(matchK[1], 10) * 1000;
    if (val >= 1_000 && val < 10_000_000) return val;
  }
  // Nombre nu >= 5000 dans un contexte IR (deja route par classifyQuery)
  const matchBare = query.match(/\b(\d{4,7})\b/);
  if (matchBare) {
    const val = parseInt(matchBare[1], 10);
    if (val >= 5_000 && val < 10_000_000) return val;
  }
  return null;
}

/** T28 -- Extrait la situation familiale d'une query IR */
export function extractSituationFamiliale(query: string): "celibataire" | "marie" | "pacse" | "divorce" | "veuf" | null {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(marie|mariee|maries)\b/.test(q)) return "marie";
  if (/\bpacse(e|s)?\b/.test(q)) return "pacse";
  if (/\bdivorce(e|s)?\b/.test(q)) return "divorce";
  if (/\b(veuf|veuve)\b/.test(q)) return "veuf";
  if (/\bcelibataire\b/.test(q)) return "celibataire";
  if (/\b(seul|seule)\b/.test(q)) return "celibataire";
  if (/\bcouple\b/.test(q)) return "marie";
  return null;
}

/** T28 -- Extrait le nombre d'enfants d'une query IR */
export function extractNbEnfants(query: string): number | null {
  const q = query.toLowerCase();
  const match = q.match(/(\d+)\s*enfants?/);
  if (match) return parseInt(match[1], 10);
  // "sans enfant"
  if (/sans\s+enfant/.test(q)) return 0;
  return null;
}

/** T28 -- Extrait un numero IDCC d'une query */
export function extractIDCC(query: string): string | null {
  const match = query.match(/\bidcc\s*(\d{1,4})\b/i);
  if (match) return match[1];
  // IDCC seul comme nombre 4 chiffres apres "convention"
  const match2 = query.match(/\bconvention\b.*\b(\d{4})\b/i);
  if (match2) return match2[1];
  return null;
}

/** T28 -- Extrait le type d'etablissement scolaire */
export function extractTypeEtablissement(query: string): string | null {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\bmaternelle\b/.test(q)) return "ecole";
  if (/\belementaire\b/.test(q)) return "ecole";
  if (/\bprimaire\b/.test(q)) return "ecole";
  if (/\becoles?\b/.test(q)) return "ecole";
  if (/\bcolleges?\b/.test(q)) return "college";
  if (/\blycees?\b/.test(q)) return "lycee";
  return null;
}

/** Extrait un SIRET (14 chiffres) de la query */
export function extractSiret(query: string): string | null {
  // Concatener les groupes de chiffres separes par espaces/points
  const digits = query.replace(/[^\d\s.]/g, " ").replace(/[\s.]+/g, "").trim();
  // Chercher une sequence de 14 chiffres
  const match = digits.match(/(\d{14})/);
  return match ? match[1] : null;
}

/** Extrait un SIREN (9 chiffres) de la query */
export function extractSiren(query: string): string | null {
  // Concatener les groupes de chiffres separes par espaces/points
  const digits = query.replace(/[^\d\s.]/g, " ").replace(/[\s.]+/g, "").trim();
  // Chercher exactement 9 chiffres (pas 14 = SIRET)
  const match = digits.match(/^(\d{9})$|(?:^|\D)(\d{9})(?:\D|$)/);
  if (!match) return null;
  const siren = match[1] || match[2];
  // Exclure si c'est en fait un SIRET (14 chiffres)
  if (digits.match(/\d{10,}/)) return null;
  return siren ?? null;
}

/** T39 -- Extrait un code departement (2-3 chiffres ou 2A/2B) */
export function extractCodeDepartement(query: string): string | null {
  // "departement 93", "dept 75", "departement 2A"
  const match = query.match(/\b(?:departement|dept)\.?\s*(\d{2,3}|2[AB])\b/i);
  if (match) return match[1].toUpperCase();
  // Numero isole 2-3 chiffres en fin de query ("evaluations nationales 93")
  const trailingMatch = query.match(/\b(\d{2,3}|2[AB])\s*$/i);
  if (trailingMatch) {
    const val = trailingMatch[1];
    const num = parseInt(val, 10);
    // Valider que c'est un departement plausible
    if (val.toUpperCase() === "2A" || val.toUpperCase() === "2B") return val.toUpperCase();
    if (num >= 1 && num <= 95) return val;
    if (num >= 971 && num <= 976) return val;
  }
  return null;
}

/** T39 -- Extrait le niveau scolaire (6eme/CE2) */
export function extractNiveauScolaire(query: string): "6eme" | "CE2" | null {
  const q = query.toLowerCase();
  if (/\b(6eme|sixieme|6\u00e8me)\b/.test(q)) return "6eme";
  if (/\bce2\b/.test(q)) return "CE2";
  return null;
}

/** T42 -- Extrait la filiere Parcoursup de la query */
export function extractFiliereParcoursup(query: string): string | null {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\bbut\b/.test(q)) return "BUT";
  if (/\bbts\b/.test(q)) return "BTS";
  if (/\b(cpge|prepa|classe\s+preparatoire)\b/.test(q)) return "CPGE";
  if (/\blicence\b/.test(q)) return "Licence";
  if (/\bpass\b/.test(q)) return "PASS";
  if (/\blas\b/.test(q)) return "LAS";
  if (/\b(ifsi|infirmier)\b/.test(q)) return "IFSI";
  if (/\b(ingenieur|ecole\s+d.?ingenieur)\b/.test(q)) return "ingenieur";
  if (/\b(dn\s*made|dnmade)\b/.test(q)) return "DN MADE";
  if (/\bdcg\b/.test(q)) return "DCG";
  return null;
}

/** Nettoie et parse un nombre au format FR ("250 000" ou "250.000" ou "250,000") */
function parseNumberFr(raw: string): number {
  const cleaned = raw.replace(/[\s.,]/g, "");
  return parseInt(cleaned, 10) || 0;
}

function prefixResult(result: ToolResult, sourceLabel: string): ToolResult {
  if (result.isError) return result;
  const text = result.content[0]?.text ?? "";
  return {
    content: [{ type: "text", text: `_Recherche via : ${sourceLabel}_\n\n${text}` }],
  };
}
