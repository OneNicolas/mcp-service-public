import type { Env, ToolResult } from "./types.js";
import { rechercherFiche } from "./tools/rechercher-fiche.js";
import { lireFiche } from "./tools/lire-fiche.js";
import { rechercherServiceLocal } from "./tools/rechercher-service-local.js";
import { naviguerThemes } from "./tools/naviguer-themes.js";
import { consulterFiscaliteLocale } from "./tools/consulter-fiscalite-locale.js";
import { rechercherDoctrineFiscale } from "./tools/rechercher-doctrine-fiscale.js";
import { rechercher } from "./tools/rechercher.js";
import { consulterTransactionsImmobilieres } from "./tools/consulter-transactions-immobilieres.js";
import { simulerTaxeFonciere } from "./tools/simuler-taxe-fonciere.js";
import { simulerFraisNotaire } from "./tools/simuler-frais-notaire.js";
import { consulterZonageImmobilier } from "./tools/consulter-zonage-immobilier.js";
import { comparerCommunes } from "./tools/comparer-communes.js";
import { simulerImpotRevenu } from "./tools/simuler-impot-revenu.js";
import { rechercherConventionCollective } from "./tools/rechercher-convention-collective.js";
import { rechercherEntreprise } from "./tools/rechercher-entreprise.js";
import { rechercherEtablissementScolaire } from "./tools/rechercher-etablissement-scolaire.js";
import { consulterResultatsLycee } from "./tools/consulter-resultats-lycee.js";
import { consulterEvaluationsNationales } from "./tools/consulter-evaluations-nationales.js";
import { consulterParcoursup } from "./tools/consulter-parcoursup.js";
import { consulterAccesSoins } from "./tools/consulter-acces-soins.js";
import { consulterInsertionProfessionnelle } from "./tools/consulter-insertion-professionnelle.js";
import { consulterSecurite } from "./tools/consulter-securite.js";
import { consulterRisquesNaturels } from "./tools/consulter-risques-naturels.js";
import { rechercherTexteLegal } from "./tools/rechercher-texte-legal.js";
import { rechercherCodeJuridique } from "./tools/rechercher-code-juridique.js";
import { rechercherJurisprudence } from "./tools/rechercher-jurisprudence.js";
import { consulterJournalOfficiel } from "./tools/consulter-journal-officiel.js";
import { consulterAideSociale } from "./tools/consulter-aide-sociale.js";
import { rechercherMarchePublic } from "./tools/rechercher-marche-public.js";
import { rechercherAnnonceLegale } from "./tools/rechercher-annonce-legale.js";
import { rechercherOffreEmploi } from "./tools/rechercher-offre-emploi.js";
import { consulterBudgetCommune } from "./tools/consulter-budget-commune.js";
import { consulterBudgetEpci } from "./tools/consulter-budget-epci.js";
import { rechercherSubvention } from "./tools/rechercher-subvention.js";
import { consulterSireneHistorique } from "./tools/consulter-sirene-historique.js";
import { consulterPrixCarburant } from "./tools/consulter-prix-carburant.js";
import { syncDilaFull } from "./sync/dila-sync.js";
import { ensureStatsTable, logToolCall, summarizeArgs, getDashboardData, purgeOldStats } from "./utils/stats.js";
import { renderDashboard } from "./admin/dashboard.js";
import { generateOpenAPISpec } from "./admin/openapi.js";

const VERSION = "1.13.5";

// Table stats initialisee au premier appel outil
let statsTableReady = false;

// --- Tool definitions for tools/list ---

const TOOLS = [
  {
    name: "rechercher",
    description:
      "Recherche unifiee intelligente dans les sources service-public.fr et Legifrance. Dispatche automatiquement vers : fiches pratiques DILA, doctrine fiscale BOFiP, fiscalite locale, transactions immobilieres DVF, simulation TF/frais notaire/IR, zonage ABC, conventions collectives, securite, risques naturels, textes legaux (lois/decrets/arretes), codes juridiques (Code civil/travail/penal...) et jurisprudence. A utiliser en premier si la source appropriee n'est pas evidente.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Question ou termes de recherche en langage naturel (ex: 'taxe foncière à Lyon', 'renouveler passeport', 'prix immobilier à Bondy', 'frais de notaire 250000 euros', 'zone Pinel Bordeaux', 'convention collective bâtiment', 'combien d impôt pour 40000 euros marié 2 enfants')" },
        limit: { type: "number", description: "Nombre de résultats (1-10, défaut 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "rechercher_fiche",
    description:
      "Recherche dans les fiches pratiques de service-public.fr (droits, démarches administratives). Utilise la recherche plein texte.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Termes de recherche (ex: 'passeport', 'allocation logement')" },
        theme: { type: "string", description: "Filtrer par thème (ex: 'Papiers', 'Logement')" },
        audience: { type: "string", enum: ["Particuliers", "Professionnels", "Associations"], description: "Public cible" },
        limit: { type: "number", description: "Nombre de résultats (1-20, défaut 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "lire_fiche",
    description:
      "Lit le contenu complet d'une fiche pratique par son identifiant (ex: F14929 pour le passeport).",
    inputSchema: {
      type: "object" as const,
      properties: {
        fiche_id: { type: "string", description: "Identifiant de la fiche (ex: F14929, N360, R42946)" },
      },
      required: ["fiche_id"],
    },
  },
  {
    name: "rechercher_service_local",
    description:
      "Recherche un service public local (mairie, préfecture, CAF, CPAM, France Services...) via l'Annuaire de l'administration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type_organisme: { type: "string", description: "Type de service (ex: 'mairie', 'prefecture', 'caf')" },
        code_postal: { type: "string", description: "Code postal (ex: '75001')" },
        commune: { type: "string", description: "Nom de la commune" },
        code_insee: { type: "string", description: "Code INSEE de la commune" },
        limit: { type: "number", description: "Nombre de résultats (1-20, défaut 5)" },
      },
    },
  },
  {
    name: "naviguer_themes",
    description:
      "Parcourt l'arborescence thématique de service-public.fr. Sans paramètre, liste les thèmes principaux.",
    inputSchema: {
      type: "object" as const,
      properties: {
        theme_id: { type: "string", description: "ID du thème à explorer (ex: N19810, N360)" },
      },
    },
  },
  {
    name: "consulter_fiscalite_locale",
    description:
      "Consulte les taux d'imposition locale d'une commune (taxe foncière, taxe d'habitation, TEOM, CFE). Accepte un nom de commune, un code INSEE ou un code postal. Sans exercice précisé, affiche l'évolution sur 4 ans avec tendance. Données REI de la DGFiP via data.economie.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'PARIS', 'LYON')" },
        communes: {
          type: "array",
          items: { type: "string" },
          description: "Liste de communes à comparer (2-5 noms en majuscules, ex: ['PARIS', 'LYON', 'MARSEILLE']). Active le mode comparaison côte à côte.",
          maxItems: 5,
          minItems: 2,
        },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '75056', '69123')" },
        code_postal: { type: "string", description: "Code postal (ex: '93140', '75001'). Résout automatiquement vers le(s) code(s) INSEE." },
        exercice: { type: "string", description: "Année fiscale (ex: '2024'). Sans exercice : affiche l'évolution sur toutes les années disponibles." },
        type: { type: "string", enum: ["particuliers", "entreprises"], description: "Type de fiscalité (défaut: particuliers)" },
      },
    },
  },
  {
    name: "rechercher_doctrine_fiscale",
    description:
      "Recherche dans la doctrine fiscale officielle (BOFiP - Bulletin Officiel des Finances Publiques). Couvre IR, TVA, IS, plus-values, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Termes de recherche (ex: 'plus-values immobilières', 'crédit impôt recherche')" },
        serie: { type: "string", description: "Filtrer par série BOFiP (ex: 'IR', 'TVA', 'IS', 'RFPI', 'BIC')" },
        limit: { type: "number", description: "Nombre de résultats (1-10, défaut 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "consulter_transactions_immobilieres",
    description:
      "Consulte les transactions immobilières (DVF - Demandes de Valeurs Foncières) d'une commune. Fournit prix médians, prix au m², répartition par type de bien et nombre de pièces. Avec evolution=true, retourne l'historique des prix médians par année (2019-aujourd'hui) avec tendance. Données DGFiP via data.gouv.fr. Hors Alsace, Moselle et Mayotte.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Bondy', 'Lyon')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '93010')" },
        code_postal: { type: "string", description: "Code postal (ex: '93140'). Résout automatiquement vers le(s) code(s) INSEE." },
        type_local: { type: "string", enum: ["Appartement", "Maison", "Local industriel. commercial ou assimilé"], description: "Filtrer par type de bien" },
        annee: { type: "number", description: "Filtrer sur une année spécifique (ex: 2024). Par défaut : 2 dernières années." },
        evolution: { type: "boolean", description: "Si true, retourne l'évolution des prix médians année par année (2019-aujourd'hui) avec tendance hausse/baisse/stable. Ignore le paramètre annee." },
      },
    },
  },
  {
    name: "simuler_taxe_fonciere",
    description:
      "Estime la taxe fonci\u00e8re annuelle d'un bien immobilier. Combine les vrais taux communaux (REI DGFiP) avec une estimation de la valeur locative cadastrale ajust\u00e9e au march\u00e9 local via les transactions DVF. Accepte un nom de commune, un code INSEE ou un code postal. D\u00e9compose les taux par collectivit\u00e9 (commune, EPCI, syndicat, GEMAPI, TSE, TASA). D\u00e9tecte l'exon\u00e9ration construction neuve 2 ans (art. 1383 CGI). Simule le sc\u00e9nario d'abattement r\u00e9sidence principale si vot\u00e9 par la commune. R\u00e9sultat indicatif uniquement.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bordeaux')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '69123')" },
        code_postal: { type: "string", description: "Code postal (ex: '33000'). Résout automatiquement vers le code INSEE." },
        surface: { type: "number", description: "Surface habitable en m² (ex: 75)" },
        type_bien: { type: "string", enum: ["Maison", "Appartement"], description: "Type de bien immobilier" },
        nombre_pieces: { type: "number", description: "Nombre de pièces principales (optionnel, estimé si absent)" },
        annee_construction: { type: "number", description: "Année de construction (optionnel, influence le coefficient d'entretien et détecte l'exonération 2 ans)" },
        residence_principale: { type: "boolean", description: "S'il s'agit de la résidence principale (optionnel, affiche les exonérations possibles)" },
      },
      required: ["surface", "type_bien"],
    },
  },
  {
    name: "simuler_frais_notaire",
    description:
      "Estime les frais de notaire (frais d'acquisition) pour un achat immobilier. Calcule les droits de mutation (DMTO), émoluments du notaire (barème dégressif réglementé), contribution de sécurité immobilière et débours. Distingue ancien (7-8 %) et neuf (2-3 %). Si le département est précisé, applique le taux DMTO exact (normal 5,81 % ou majoré 6,32 % selon le département, LF 2025). Sans département, affiche les deux hypothèses. Accepte un code département, un code postal ou un numéro de département.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prix: { type: "number", description: "Prix d'achat du bien en euros (ex: 250000)" },
        type: { type: "string", enum: ["ancien", "neuf"], description: "Type de bien : ancien ou neuf" },
        departement: { type: "string", description: "Département (code 2-3 chiffres, code postal 5 chiffres, ou '2A'/'2B' pour la Corse). Permet d'appliquer le taux DMTO exact." },
      },
      required: ["prix", "type"],
    },
  },
  {
    name: "consulter_zonage_immobilier",
    description:
      "Consulte la zone ABC d'une commune (A bis, A, B1, B2, C) utilisée pour les dispositifs immobiliers (Pinel, PTZ, plafonds loyers). Accepte un nom de commune, un code INSEE ou un code postal. Retourne la zone, les plafonds de loyer, les plafonds de ressources et l'éligibilité aux dispositifs. Source : Ministère de la Transition écologique via data.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bordeaux')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '69123')" },
        code_postal: { type: "string", description: "Code postal (ex: '33000'). Résout automatiquement vers le code INSEE." },
      },
    },
  },
  {
    name: "comparer_communes",
    description:
      "Compare 2 \u00e0 5 communes sur un tableau crois\u00e9 : population et densit\u00e9, fiscalit\u00e9 locale (taux TFB, TEOM), prix immobiliers (DVF m\u00e9dian/m\u00b2 appart et maison), zonage ABC, services publics locaux, \u00e9tablissements scolaires, scores 6\u00e8me, s\u00e9curit\u00e9 d\u00e9partementale (cambriolages, vols, violences), risques naturels (nombre de risques, arr\u00eat\u00e9s CatNat), donn\u00e9es sant\u00e9 (densit\u00e9 m\u00e9decins) et intercommunalit\u00e9. Aide \u00e0 la d\u00e9cision pour un d\u00e9m\u00e9nagement ou un investissement. Accepte des noms de communes, codes postaux ou codes INSEE.",
    inputSchema: {
      type: "object" as const,
      properties: {
        communes: {
          type: "array",
          items: { type: "string" },
          description: "Liste de 2 à 5 communes à comparer (noms, codes postaux ou codes INSEE). Ex: ['Lyon', 'Bordeaux', 'Nantes']",
          minItems: 2,
          maxItems: 5,
        },
      },
      required: ["communes"],
    },
  },
  {
    name: "simuler_impot_revenu",
    description:
      "Estime l'impot sur le revenu (IR) selon le bareme progressif 2025 (revenus 2024). Calcule le quotient familial, applique le plafonnement, la decote et la contribution exceptionnelle hauts revenus (CEHR). Parametres : revenu net imposable (obligatoire), nombre de parts OU situation familiale + nombre d'enfants. Options : revenus fonciers (micro-foncier 30% abattement ou reel), revenus de capitaux (PFU 30% ou bareme), micro-BIC (abattement 50%), micro-BNC (abattement 34%).",
    inputSchema: {
      type: "object" as const,
      properties: {
        revenu_net_imposable: { type: "number", description: "Revenu net imposable en euros (ex: 42000)" },
        nb_parts: { type: "number", description: "Nombre de parts fiscales (optionnel, defaut 1). Prioritaire sur situation + nb_enfants." },
        situation: { type: "string", enum: ["celibataire", "marie", "pacse", "divorce", "veuf"], description: "Situation familiale (optionnel, permet le calcul auto des parts)" },
        nb_enfants: { type: "number", description: "Nombre d'enfants a charge (optionnel, defaut 0)" },
        revenus_fonciers: { type: "number", description: "Revenus fonciers bruts en euros (optionnel). Negatif possible en regime reel (deficit foncier)." },
        regime_foncier: { type: "string", enum: ["micro", "reel"], description: "Regime foncier (defaut: micro). Micro = abattement 30 %, reel = montant net fourni." },
        revenus_capitaux: { type: "number", description: "Revenus de capitaux mobiliers en euros (dividendes, interets, plus-values). Optionnel." },
        regime_capitaux: { type: "string", enum: ["pfu", "bareme"], description: "Imposition des capitaux (defaut: pfu). PFU = flat tax 30 %, bareme = integration au revenu global." },
        micro_bic: { type: "number", description: "Chiffre d'affaires micro-BIC en euros (abattement 50 %). Optionnel." },
        micro_bnc: { type: "number", description: "Recettes micro-BNC en euros (abattement 34 %). Optionnel." },
      },
      required: ["revenu_net_imposable"],
    },
  },
  {
    name: "rechercher_convention_collective",
    description:
      "Recherche une convention collective nationale par numero IDCC, secteur d'activite ou mot-cle. Source : base KALI (DILA) via data.gouv.fr. Retourne le titre, l'IDCC, l'etat (en vigueur/abrogee), la nature et le lien Legifrance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mot-cle ou secteur d'activite (ex: 'boulangerie', 'metallurgie', 'batiment')" },
        idcc: { type: "string", description: "Numero IDCC (ex: '843', '3248')" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 10)" },
      },
    },
  },
  {
    name: "rechercher_entreprise",
    description:
      "Recherche une entreprise francaise par SIRET, SIREN ou nom. Retourne les informations legales (forme juridique, NAF, effectif, dirigeants, adresse) et la ou les convention(s) collective(s) applicable(s) avec detail KALI. Source : API Recherche d'entreprises (DINUM) + KALI (DILA).",
    inputSchema: {
      type: "object" as const,
      properties: {
        siret: { type: "string", description: "Numero SIRET (14 chiffres, ex: '41816609600069')" },
        siren: { type: "string", description: "Numero SIREN (9 chiffres, ex: '418166096')" },
        nom: { type: "string", description: "Nom ou raison sociale de l'entreprise (ex: 'OCTO Technology')" },
      },
    },
  },
  {
    name: "rechercher_etablissement_scolaire",
    description:
      "Recherche un etablissement scolaire (ecole, college, lycee) par commune, code postal ou nom. Retourne les informations detaillees : adresse, contact, voies d'enseignement, services (restauration, internat, ULIS), sections (europeenne, sport, arts), education prioritaire. Source : Annuaire de l'education (data.education.gouv.fr), 68 000+ etablissements.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bondy')" },
        code_postal: { type: "string", description: "Code postal (ex: '69001', '93140')" },
        code_insee: { type: "string", description: "Code INSEE de la commune" },
        type: { type: "string", description: "Type d'etablissement : 'ecole', 'college', 'lycee', 'maternelle', 'elementaire', 'primaire', 'erea'" },
        statut: { type: "string", enum: ["public", "prive"], description: "Statut : public ou prive" },
        nom: { type: "string", description: "Nom de l'etablissement (recherche partielle, ex: 'Lacassagne')" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 10)" },
      },
    },
  },
  {
    name: "consulter_resultats_lycee",
    description:
      "Consulte les indicateurs de valeur ajoutee (IVAL) d'un lycee : taux de reussite au bac, valeur ajoutee, taux d'acces 2nde-bac, taux de mentions. Couvre les lycees generaux/technologiques et professionnels, publics et prives sous contrat. Donnees DEPP session 2012-2024. Source : data.education.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bordeaux')" },
        code_postal: { type: "string", description: "Code postal (ex: '69001')" },
        code_insee: { type: "string", description: "Code INSEE de la commune" },
        nom_lycee: { type: "string", description: "Nom du lycee (recherche partielle, ex: 'Lacassagne', 'Guimard')" },
        type: { type: "string", enum: ["gt", "pro", "tous"], description: "Voie : 'gt' (general/techno), 'pro' (professionnel), 'tous' (defaut)" },
        evolution: { type: "boolean", description: "Si true, retourne l'historique multi-annees (2012-2024) avec tendance, au lieu de la derniere session uniquement." },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 10)" },
      },
    },
  },
  {
    name: "consulter_evaluations_nationales",
    description:
      "Consulte les resultats des evaluations nationales (6eme et CE2) par departement. Compare les scores departementaux au niveau national, avec repartition par groupes de niveau et tendance annuelle. Accepte un nom de commune, un code postal ou un code departement. Source : DEPP via data.education.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Bondy', 'Lyon') — resout le departement automatiquement" },
        code_postal: { type: "string", description: "Code postal (ex: '93140') — resout le departement automatiquement" },
        code_departement: { type: "string", description: "Code departement direct (ex: '93', '75', '2A', '971')" },
        niveau: { type: "string", enum: ["6eme", "CE2", "tous"], description: "Niveau scolaire (defaut: 'tous')" },
        annee: { type: "number", description: "Annee scolaire (ex: 2025). Par defaut : derniere disponible." },
      },
    },
  },
  {
    name: "consulter_parcoursup",
    description:
      "Recherche des formations sur Parcoursup par mot-cle, ville, departement ou filiere. Retourne les informations detaillees : etablissement, selectivite, taux d'acces, capacite, nombre de voeux, profil des admis (bac, mentions, boursiers), lien fiche Parcoursup. Donnees session 2025. Source : Ministere de l'Enseignement superieur via data.education.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Mot-cle ou intitule de formation (ex: 'informatique', 'BTS comptabilite', 'licence droit')" },
        ville: { type: "string", description: "Ville de l'etablissement (ex: 'Lyon', 'Paris')" },
        code_postal: { type: "string", description: "Code postal (ex: '69001'). Resout automatiquement vers la ville." },
        departement: { type: "string", description: "Code departement (ex: '69', '93', '2A')" },
        filiere: { type: "string", description: "Type de filiere : 'BUT', 'BTS', 'Licence', 'CPGE', 'PASS', 'LAS', 'IFSI', 'ingenieur'" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 10)" },
      },
    },
  },
  {
    name: "consulter_acces_soins",
    description:
      "Consulte les donnees d'acces aux soins par departement : effectifs et densite des medecins generalistes et specialistes liberaux, patientele medecin traitant, primo-installations, installations en zones sous-dotees, file active. Compare avec les moyennes nationales. Accepte un nom de commune, un code postal ou un code departement. Source : Assurance Maladie (CNAM) via data.ameli.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Bondy', 'Lyon') \u2014 resout le departement automatiquement" },
        code_postal: { type: "string", description: "Code postal (ex: '93140') \u2014 resout le departement automatiquement" },
        code_departement: { type: "string", description: "Code departement direct (ex: '93', '75', '2A', '971')" },
      },
    },
  },
  {
    name: "consulter_insertion_professionnelle",
    description:
      "Consulte les indicateurs d'insertion professionnelle des lycees professionnels (InserJeunes). Taux d'emploi a 6/12/18/24 mois apres la sortie, taux de poursuite d'etudes, valeur ajoutee. Detail par formation (CAP, Bac Pro, BTS, Mention complementaire). Recherche par nom d'etablissement, ville, departement ou code UAI. Source : DEPP/DARES via data.education.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Nom d'etablissement ou mot-cle (ex: 'coiffure', 'automobile')" },
        uai: { type: "string", description: "Code UAI de l'etablissement (ex: '0691723Y'). Retourne une fiche detaillee avec formations." },
        ville: { type: "string", description: "Ville de l'etablissement (ex: 'Lyon', 'Marseille')" },
        code_departement: { type: "string", description: "Code departement (ex: '69', '93', '2A')" },
        type_diplome: { type: "string", enum: ["CAP", "BAC PRO", "BTS", "MC3", "MC4", "BP"], description: "Filtrer par type de diplome (optionnel)" },
        limit: { type: "number", description: "Nombre de resultats (1-10, defaut 5)" },
      },
    },
  },
  {
    name: "consulter_securite",
    description:
      "Consulte les statistiques de securite et delinquance par departement : cambriolages, vols, violences, homicides, escroqueries, stupefiants. Fournit le nombre de faits, le taux pour 1000 habitants et l'evolution annuelle. Accepte un nom de commune, un code postal ou un code departement. Source : SSMSI, Ministere de l'Interieur via data.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code_departement: { type: "string", description: "Code departement (ex: '75', '93', '2A')" },
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon') — resout le departement automatiquement" },
        code_postal: { type: "string", description: "Code postal (ex: '93140') — resout le departement automatiquement" },
        annee: { type: "number", description: "Annee specifique (optionnel, defaut: derniere disponible)" },
      },
    },
  },
  {
    name: "consulter_risques_naturels",
    description:
      "Consulte les risques naturels et technologiques d'une commune : inondation, seisme, mouvement de terrain, risque industriel, feu de foret, etc. Liste les risques identifies et les arretes de catastrophe naturelle (CatNat) avec dates. Accepte un nom de commune, un code postal ou un code INSEE. Source : Georisques (BRGM/MTE) via georisques.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Nimes', 'Vaison-la-Romaine')" },
        code_postal: { type: "string", description: "Code postal (ex: '30000')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '30189'). Prioritaire si fourni." },
      },
    },
  },
  {
    name: "rechercher_texte_legal",
    description:
      "Recherche dans les textes legislatifs et reglementaires francais (lois, decrets, arretes, ordonnances) par mots-cles. Retourne les textes correspondants avec leur nature, date et lien Legifrance. Source : API Legifrance officielle (PISTE/DILA).",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Mots-cles de recherche (ex: 'protection donnees personnelles', 'teletravail conges')" },
        champ: { type: "string", enum: ["ALL", "TITLE", "ARTICLE", "NUM_ARTICLE"], description: "Champ de recherche (defaut: ALL)" },
        type_recherche: { type: "string", enum: ["TOUS_LES_MOTS_DANS_UN_CHAMP", "EXACTE", "UN_DES_MOTS"], description: "Type de recherche (defaut: TOUS_LES_MOTS_DANS_UN_CHAMP)" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 5)" },
      },
      required: ["recherche"],
    },
  },
  {
    name: "rechercher_code_juridique",
    description:
      "Recherche d'articles dans les codes de loi francais (Code civil, Code du travail, Code penal, Code de commerce, etc.). Retourne les articles avec leur numero, contenu et lien Legifrance. Source : API Legifrance officielle (PISTE/DILA).",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Termes de recherche (ex: 'contrat de travail', 'legitime defense', 'clause abusive')" },
        code: { type: "string", description: "Nom complet du code juridique (ex: 'Code civil', 'Code du travail', 'Code penal', 'Code de commerce')" },
        champ: { type: "string", enum: ["ALL", "TITLE", "ARTICLE", "NUM_ARTICLE"], description: "Champ de recherche (defaut: ALL)" },
        type_recherche: { type: "string", enum: ["TOUS_LES_MOTS_DANS_UN_CHAMP", "EXACTE", "UN_DES_MOTS"], description: "Type de recherche (defaut: TOUS_LES_MOTS_DANS_UN_CHAMP)" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 5)" },
      },
      required: ["recherche", "code"],
    },
  },
  {
    name: "consulter_journal_officiel",
    description:
      "Recherche dans le Journal Officiel de la Republique Francaise (JORF). Retourne les textes publies au JO avec leur titre, nature, date, NOR et lien Legifrance. Filtrage par type (LOI/DECRET/ARRETE/ORDONNANCE...) et plage de dates. Source : API PISTE officielle DILA/Legifrance.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Termes de recherche (ex: 'teletravail', 'protection donnees', 'loi finances 2025')" },
        type_texte: { type: "string", enum: ["LOI", "DECRET", "ARRETE", "ORDONNANCE", "CIRCULAIRE", "AVIS", "DECISION"], description: "Filtrer par nature du texte (optionnel)" },
        date_debut: { type: "string", description: "Date de debut au format YYYY-MM-DD (ex: '2024-01-01')" },
        date_fin: { type: "string", description: "Date de fin au format YYYY-MM-DD (ex: '2024-12-31')" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 5)" },
      },
      required: ["recherche"],
    },
  },
  {
    name: "consulter_aide_sociale",
    description:
      "Statistiques CAF par commune ou departement : nombre de foyers allocataires et personnes couvertes pour RSA, aides au logement (APL/ALS/ALF), AAH, allocations familiales, prime d'activite et autres prestations. Donnees agregees anonymisees depuis 2020. Source : CNAF — data.caf.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bondy')" },
        code_postal: { type: "string", description: "Code postal (ex: '93140')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '93010')" },
        code_departement: { type: "string", description: "Code departement (ex: '93', '75', '2A')" },
        prestation: { type: "string", description: "Code de prestation a filtrer : RSA, AL, AAH, AF, PA, CF, ASF, CMG... ou 'toutes' (defaut)" },
        annee: { type: "number", description: "Annee specifique (ex: 2022). Par defaut : derniere annee disponible." },
      },
    },
  },
  {
    name: "rechercher_marche_public",
    description:
      "Recherche d'avis de marches publics (appels d'offres, attributions, MAPA, DSP) dans le BOAMP (Bulletin officiel des annonces des marches publics). Filtrage par mots-cles, type d'avis, departement, acheteur ou periode. Source : API BOAMP — DILA.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Mots-cles sur l'objet du marche (ex: 'travaux voirie', 'fourniture informatique', 'nettoyage locaux')" },
        type_avis: { type: "string", enum: ["AAC", "APC", "MAPA", "DSP"], description: "Type d'avis : AAC=Appel a la concurrence, APC=Attribution, MAPA=Procedure adaptee, DSP=Delegation service public" },
        departement: { type: "string", description: "Code departement (ex: '75', '93', '69')" },
        acheteur: { type: "string", description: "Nom de l'acheteur public (ex: 'Commune de Lyon', 'Departement du Rhone')" },
        date_debut: { type: "string", description: "Date de debut au format YYYY-MM-DD" },
        date_fin: { type: "string", description: "Date de fin au format YYYY-MM-DD" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 10)" },
      },
    },
  },
  {
    name: "consulter_budget_epci",
    description:
      "Consulte les comptes financiers d'un EPCI (metropole, CA, CC, CU) : recettes, depenses, dette. Donnees 2017-2024. Source : OFGL.",
    inputSchema: {
      type: "object" as const,
      properties: {
        epci: { type: "string", description: "Nom de l'EPCI (ex: 'Bordeaux Metropole', 'Rennes Metropole')" },
        code_siren: { type: "string", description: "Code SIREN de l'EPCI (9 chiffres)" },
        commune: { type: "string", description: "Commune membre (l'EPCI sera resolu automatiquement)" },
        annee: { type: "number", description: "Annee du budget (2017-2024). Par defaut : derniere disponible." },
      },
    },
  },
  {
    name: "consulter_budget_commune",
    description:
      "Consulte les comptes financiers d'une commune : recettes, depenses, epargne brute, encours de dette, investissements. Donnees 2017-2024. Source : OFGL via data.ofgl.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bordeaux')" },
        code_postal: { type: "string", description: "Code postal (ex: '69001')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '69123')" },
        annee: { type: "number", description: "Annee du budget (2017-2024). Par defaut : derniere disponible." },
      },
    },
  },
  {
    name: "rechercher_subvention",
    description:
      "Recherche des subventions versees par les collectivites locales et organismes publics. Filtrage par beneficiaire, attribuant, objet, montant minimum et annee. Source : data.gouv.fr (obligation legale > 23 000 EUR).",
    inputSchema: {
      type: "object" as const,
      properties: {
        beneficiaire: { type: "string", description: "Nom du beneficiaire (association, organisme, entreprise)" },
        attribuant: { type: "string", description: "Nom de l'organisme attribuant (commune, departement, metropole...)" },
        objet: { type: "string", description: "Objet ou descriptif de la subvention (recherche partielle)" },
        montant_min: { type: "number", description: "Montant minimum en euros (ex: 10000)" },
        annee: { type: "number", description: "Annee de la convention (ex: 2023)" },
        limit: { type: "number", description: "Nombre de resultats (1-50, defaut 10)" },
      },
    },
  },
  {
    name: "consulter_sirene_historique",
    description:
      "Recherche des entreprises par secteur d'activite (code NAF/APE) et zone geographique. Retourne les informations SIRENE : nom, etat (actif/cesse), dates de creation et fermeture. Source : API Recherche Entreprises (DINUM).",
    inputSchema: {
      type: "object" as const,
      properties: {
        code_naf: { type: "string", description: "Code NAF/APE (ex: '10.71C' boulangerie, '56.10A' restauration, '62.01Z' informatique)" },
        commune: { type: "string", description: "Commune (ex: 'Lyon', 'Paris')" },
        code_postal: { type: "string", description: "Code postal (ex: '69001')" },
        code_departement: { type: "string", description: "Code departement (ex: '69', '75')" },
        etat: { type: "string", enum: ["actif", "cesse"], description: "Filtrer par etat : actif (A) ou cesse (C). Par defaut : tous." },
        limit: { type: "number", description: "Nombre de resultats (1-25, defaut 10)" },
      },
    },
  },
  {
    name: "rechercher_annonce_legale",
    description:
      "Recherche d'annonces legales dans le BODACC (Bulletin officiel des annonces civiles et commerciales) : ventes et cessions, immatriculations, radiations, modifications, procedures collectives, depots de comptes. Filtrage par entreprise, SIREN, type d'annonce, departement ou periode. Source : API BODACC — DILA.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Recherche par nom d'entreprise ou ville (ex: 'SARL Martin', 'Bordeaux')" },
        nom_entreprise: { type: "string", description: "Nom exact ou partiel de l'entreprise" },
        siren: { type: "string", description: "Numero SIREN de l'entreprise (9 chiffres)" },
        type_annonce: { type: "string", enum: ["vente_cession", "immatriculation", "radiation", "procedure_collective", "modification"], description: "Type d'annonce a filtrer" },
        departement: { type: "string", description: "Code departement (ex: '75', '69')" },
        date_debut: { type: "string", description: "Date de debut au format YYYY-MM-DD" },
        date_fin: { type: "string", description: "Date de fin au format YYYY-MM-DD" },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 10)" },
      },
    },
  },
  {
    name: "rechercher_offre_emploi",
    description:
      "Recherche d'offres d'emploi actives en temps reel via France Travail. Filtrage par mots-cles, commune, code postal, departement, type de contrat (CDI/CDD/MIS...) et qualification (cadre/non-cadre). Necessite les secrets FT_CLIENT_ID / FT_CLIENT_SECRET (inscription gratuite sur francetravail.io). Source : API Offres d'emploi v2 — France Travail.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mots_cles: { type: "string", description: "Mots-cles sur l'intitule ou la description du poste (ex: 'developpeur TypeScript', 'infirmier', 'comptable')" },
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Paris'). Resout automatiquement en code commune." },
        code_postal: { type: "string", description: "Code postal (ex: '69001'). Resout en code commune." },
        departement: { type: "string", description: "Code departement (ex: '75', '69', '93'). Alternative a commune/code_postal." },
        type_contrat: { type: "string", description: "Type de contrat : CDI, CDD, MIS (interim), SAI (saisonnier), LIB (liberale), REP (reprise), CUI (aide), PRO (professionnalisation)" },
        qualification: { type: "string", enum: ["cadre", "non-cadre"], description: "Niveau de qualification (optionnel)" },
        limit: { type: "number", description: "Nombre de resultats (1-30, defaut 10)" },
      },
    },
  },
  {
    name: "consulter_prix_carburant",
    description:
      "Prix des carburants en temps reel pour un departement ou une commune. Retourne les stations triees par prix croissant avec Gazole, SP95, SP98, E10, E85, GPLc et indicateur automate 24/24. Source : data.economie.gouv.fr (flux instantane, MAJ toutes les 10 min).",
    inputSchema: {
      type: "object" as const,
      properties: {
        departement: { type: "string", description: "Numero ou nom du departement (ex: '69', 'Rhone', '13')" },
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bordeaux')" },
        code_postal: { type: "string", description: "Code postal (ex: '69001')" },
        carburant: { type: "string", enum: ["Gazole", "SP95", "SP98", "E10", "E85", "GPLc"], description: "Type de carburant a filtrer et trier (optionnel — tous les prix affiches si absent)" },
        limit: { type: "number", description: "Nombre de stations (1-20, defaut 10)" },
      },
    },
  },
  {
    name: "rechercher_jurisprudence",
    description:
      "Recherche de jurisprudence judiciaire francaise : arrets de la Cour de cassation et cours d'appel. Retourne les decisions avec juridiction, formation, solution et lien Legifrance. Source : API Legifrance officielle (PISTE/DILA).",
    inputSchema: {
      type: "object" as const,
      properties: {
        recherche: { type: "string", description: "Termes de recherche (ex: 'licenciement abusif', 'prejudice moral', 'clause non-concurrence')" },
        juridiction: { type: "string", enum: ["Cour de cassation", "Cours d'appel", "Toutes"], description: "Filtrer par juridiction (defaut: Toutes)" },
        publie_bulletin: { type: "boolean", description: "Filtrer les arrets publies au bulletin (Cour de cassation uniquement). Optionnel." },
        limit: { type: "number", description: "Nombre de resultats (1-20, defaut 5)" },
      },
      required: ["recherche"],
    },
  },
];

// --- Tool execution dispatcher ---

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
): Promise<ToolResult> {
  switch (name) {
    case "rechercher":
      return rechercher(args as { query: string; limit?: number }, env);
    case "rechercher_fiche":
      return rechercherFiche(args as { query: string; theme?: string; audience?: string; limit?: number }, env);
    case "lire_fiche":
      return lireFiche(args as { fiche_id: string }, env);
    case "rechercher_service_local":
      return rechercherServiceLocal(args as { type_organisme?: string; code_postal?: string; commune?: string; code_insee?: string; limit?: number });
    case "naviguer_themes":
      return naviguerThemes(args as { theme_id?: string }, env);
    case "consulter_fiscalite_locale":
      return consulterFiscaliteLocale(args as { commune?: string; communes?: string[]; code_insee?: string; code_postal?: string; exercice?: string; type?: "particuliers" | "entreprises" });
    case "rechercher_doctrine_fiscale":
      return rechercherDoctrineFiscale(args as { query: string; serie?: string; limit?: number });
    case "consulter_transactions_immobilieres":
      return consulterTransactionsImmobilieres(args as { commune?: string; code_insee?: string; code_postal?: string; type_local?: string; annee?: number; evolution?: boolean });
    case "simuler_taxe_fonciere":
      return simulerTaxeFonciere(args as { commune?: string; code_insee?: string; code_postal?: string; surface: number; type_bien: "Maison" | "Appartement"; nombre_pieces?: number; annee_construction?: number; residence_principale?: boolean });
    case "simuler_frais_notaire":
      return simulerFraisNotaire(args as { prix: number; type: "ancien" | "neuf"; departement?: string });
    case "consulter_zonage_immobilier":
      return consulterZonageImmobilier(args as { commune?: string; code_insee?: string; code_postal?: string });
    case "comparer_communes":
      return comparerCommunes(args as { communes: string[] });
    case "simuler_impot_revenu":
      return simulerImpotRevenu(args as { revenu_net_imposable: number; nb_parts?: number; situation?: "celibataire" | "marie" | "pacse" | "divorce" | "veuf"; nb_enfants?: number; revenus_fonciers?: number; regime_foncier?: "micro" | "reel"; revenus_capitaux?: number; regime_capitaux?: "pfu" | "bareme"; micro_bic?: number; micro_bnc?: number });
    case "rechercher_convention_collective":
      return rechercherConventionCollective(args as { query?: string; idcc?: string; limit?: number });
    case "rechercher_entreprise":
      return rechercherEntreprise(args as { siret?: string; siren?: string; nom?: string });
    case "rechercher_etablissement_scolaire":
      return rechercherEtablissementScolaire(args as { commune?: string; code_postal?: string; code_insee?: string; type?: string; statut?: "public" | "prive"; nom?: string; limit?: number });
    case "consulter_resultats_lycee":
      return consulterResultatsLycee(args as { commune?: string; code_postal?: string; code_insee?: string; nom_lycee?: string; type?: "gt" | "pro" | "tous"; evolution?: boolean; limit?: number });
    case "consulter_evaluations_nationales":
      return consulterEvaluationsNationales(args as { commune?: string; code_postal?: string; code_departement?: string; niveau?: "6eme" | "CE2" | "tous"; annee?: number });
    case "consulter_parcoursup":
      return consulterParcoursup(args as { recherche?: string; ville?: string; code_postal?: string; departement?: string; filiere?: string; limit?: number });
    case "consulter_acces_soins":
      return consulterAccesSoins(args as { commune?: string; code_postal?: string; code_departement?: string });
    case "consulter_insertion_professionnelle":
      return consulterInsertionProfessionnelle(args as { recherche?: string; uai?: string; ville?: string; code_departement?: string; type_diplome?: string; limit?: number });
    case "consulter_securite":
      return consulterSecurite(args as { code_departement?: string; commune?: string; code_postal?: string; annee?: number });
    case "consulter_risques_naturels":
      return consulterRisquesNaturels(args as { commune?: string; code_postal?: string; code_insee?: string });
    case "rechercher_texte_legal":
      return rechercherTexteLegal(args as { recherche: string; champ?: "ALL" | "TITLE" | "ARTICLE" | "NUM_ARTICLE"; type_recherche?: "TOUS_LES_MOTS_DANS_UN_CHAMP" | "EXACTE" | "UN_DES_MOTS"; limit?: number }, env);
    case "rechercher_code_juridique":
      return rechercherCodeJuridique(args as { recherche: string; code: string; champ?: "ALL" | "TITLE" | "ARTICLE" | "NUM_ARTICLE"; type_recherche?: "TOUS_LES_MOTS_DANS_UN_CHAMP" | "EXACTE" | "UN_DES_MOTS"; limit?: number }, env);
    case "rechercher_jurisprudence":
      return rechercherJurisprudence(args as { recherche: string; juridiction?: "Cour de cassation" | "Cours d'appel" | "Toutes"; publie_bulletin?: boolean; limit?: number }, env);
    case "consulter_journal_officiel":
      return consulterJournalOfficiel(args as { recherche: string; type_texte?: "LOI" | "DECRET" | "ARRETE" | "ORDONNANCE" | "CIRCULAIRE" | "AVIS" | "DECISION"; date_debut?: string; date_fin?: string; limit?: number }, env);
    case "consulter_aide_sociale":
      return consulterAideSociale(args as { commune?: string; code_postal?: string; code_insee?: string; code_departement?: string; prestation?: string; annee?: number });
    case "rechercher_marche_public":
      return rechercherMarchePublic(args as { recherche?: string; type_avis?: "AAC" | "APC" | "MAPA" | "DSP"; departement?: string; acheteur?: string; date_debut?: string; date_fin?: string; limit?: number }, env);
    case "consulter_budget_epci":
      return consulterBudgetEpci(args as { epci?: string; code_siren?: string; commune?: string; annee?: number });
    case "consulter_budget_commune":
      return consulterBudgetCommune(args as { commune?: string; code_postal?: string; code_insee?: string; annee?: number });
    case "rechercher_subvention":
      return rechercherSubvention(args as { beneficiaire?: string; attribuant?: string; montant_min?: number; annee?: number; objet?: string; limit?: number });
    case "consulter_sirene_historique":
      return consulterSireneHistorique(args as { code_naf?: string; commune?: string; code_postal?: string; code_departement?: string; etat?: "actif" | "cesse"; limit?: number });
    case "rechercher_annonce_legale":
      return rechercherAnnonceLegale(args as { recherche?: string; nom_entreprise?: string; siren?: string; type_annonce?: "vente_cession" | "immatriculation" | "radiation" | "procedure_collective" | "modification"; departement?: string; date_debut?: string; date_fin?: string; limit?: number }, env);
    case "rechercher_offre_emploi":
      return rechercherOffreEmploi(args as { mots_cles?: string; commune?: string; code_postal?: string; departement?: string; type_contrat?: string; qualification?: "cadre" | "non-cadre"; limit?: number }, env);
    case "consulter_prix_carburant":
      return consulterPrixCarburant(args as { departement?: string; commune?: string; code_postal?: string; carburant?: string; limit?: number });
    default:
      return { content: [{ type: "text", text: `Outil inconnu: ${name}` }], isError: true };
  }
}

// --- Streamable HTTP MCP handler ---

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResponse(id: number | string | undefined, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(id: number | string | undefined, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleMcpPost(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = (await request.json()) as JsonRpcRequest;

  switch (body.method) {
    case "initialize":
      return jsonRpcResponse(body.id, {
        protocolVersion: "2025-03-26",
        capabilities: {
          tools: {},
          prompts: {
            listChanged: false,
            prompts: [
              {
                name: "comparer_communes_achat",
                description: "Compare 2 a 5 communes pour un projet d'achat immobilier : prix DVF, fiscalite, zonage ABC, services, risques.",
                arguments: [
                  { name: "communes", description: "Liste de communes separees par des virgules (ex: Lyon, Bordeaux, Nantes)", required: true },
                ],
              },
              {
                name: "comparer_communes_demenagement",
                description: "Compare 2 a 5 communes pour un demenagement : ecoles, securite, acces soins, fiscalite, transports.",
                arguments: [
                  { name: "communes", description: "Liste de communes separees par des virgules", required: true },
                  { name: "nb_enfants", description: "Nombre d'enfants a scolariser (optionnel)", required: false },
                ],
              },
              {
                name: "simuler_achat_immobilier",
                description: "Simule le cout complet d'un achat immobilier : frais de notaire, taxe fonciere estimee, zonage Pinel/PTZ.",
                arguments: [
                  { name: "commune", description: "Commune du bien", required: true },
                  { name: "prix", description: "Prix d'achat en euros (ex: 250000)", required: true },
                  { name: "surface", description: "Surface en m2", required: true },
                  { name: "type_bien", description: "Maison ou Appartement", required: true },
                  { name: "type_achat", description: "ancien ou neuf", required: false },
                ],
              },
              {
                name: "verifier_entreprise",
                description: "Verifie la situation legale d'une entreprise : SIRET, forme juridique, dirigeants, conventions collectives, annonces BODACC.",
                arguments: [
                  { name: "entreprise", description: "Nom ou numero SIRET/SIREN de l'entreprise", required: true },
                ],
              },
              {
                name: "trouver_textes_loi",
                description: "Trouve les textes de loi, decrets et arretes sur un sujet precis via Legifrance.",
                arguments: [
                  { name: "sujet", description: "Sujet juridique (ex: protection donnees personnelles, teletravail)", required: true },
                  { name: "type", description: "LOI, DECRET, ARRETE ou tous (defaut)", required: false },
                ],
              },
              {
                name: "simuler_impot_complet",
                description: "Simule l'impot sur le revenu avec situation familiale, revenus fonciers, capitaux et micro-entrepreneur.",
                arguments: [
                  { name: "revenu", description: "Revenu net imposable en euros", required: true },
                  { name: "situation", description: "celibataire, marie, pacse, divorce ou veuf", required: false },
                  { name: "nb_enfants", description: "Nombre d'enfants a charge", required: false },
                  { name: "revenus_fonciers", description: "Revenus fonciers bruts en euros", required: false },
                ],
              },
              {
                name: "trouver_marche_public",
                description: "Recherche des appels d'offres publics (BOAMP) par secteur d'activite et/ou departement.",
                arguments: [
                  { name: "secteur", description: "Secteur ou objet du marche (ex: travaux voirie, nettoyage, informatique)", required: true },
                  { name: "departement", description: "Code departement (ex: 75, 69)", required: false },
                  { name: "type", description: "AAC (appel offres), APC (attribution), MAPA ou DSP", required: false },
                ],
              },
              {
                name: "aide_sociale_departement",
                description: "Consulte les statistiques CAF d'un departement ou d'une commune : RSA, APL, AAH, allocations familiales.",
                arguments: [
                  { name: "lieu", description: "Commune, code postal ou code departement", required: true },
                  { name: "prestation", description: "RSA, AL, AAH, AF, PA ou toutes (defaut)", required: false },
                ],
              },
              {
                name: "trouver_lycee_resultats",
                description: "Trouve un lycee et consulte ses resultats au bac : taux de reussite, valeur ajoutee, mentions.",
                arguments: [
                  { name: "commune", description: "Commune ou code postal du lycee", required: true },
                  { name: "nom", description: "Nom partiel du lycee (optionnel)", required: false },
                  { name: "type", description: "gt (general/techno), pro ou tous (defaut)", required: false },
                ],
              },
              {
                name: "insertion_pro_lycee",
                description: "Consulte l'insertion professionnelle apres un CAP, Bac Pro ou BTS dans un lycee professionnel.",
                arguments: [
                  { name: "lieu", description: "Ville, departement ou UAI du lycee", required: true },
                  { name: "formation", description: "Specialite ou intitule de formation (optionnel)", required: false },
                ],
              },
              {
                name: "securite_commune",
                description: "Consulte les statistiques de delinquance departementale d'une commune : cambriolages, vols, violences, taux pour 1000 hab.",
                arguments: [
                  { name: "lieu", description: "Commune, code postal ou code departement", required: true },
                ],
              },
              {
                name: "risques_naturels_commune",
                description: "Identifie les risques naturels et technologiques d'une commune et liste les arretes de catastrophe naturelle.",
                arguments: [
                  { name: "commune", description: "Nom de la commune ou code postal", required: true },
                ],
              },
              {
                name: "trouver_convention_collective",
                description: "Trouve la convention collective applicable a un secteur d'activite ou une entreprise.",
                arguments: [
                  { name: "secteur", description: "Secteur ou nom de l'entreprise (ex: boulangerie, metallurgie)", required: true },
                ],
              },
              {
                name: "evolution_prix_immobilier",
                description: "Analyse l'evolution des prix immobiliers DVF d'une commune depuis 2019, par type de bien.",
                arguments: [
                  { name: "commune", description: "Commune ou code postal", required: true },
                  { name: "type_bien", description: "Appartement, Maison ou les deux (defaut)", required: false },
                ],
              },
              {
                name: "acces_soins_departement",
                description: "Analyse la densite medicale d'un departement : medecins generalistes, specialistes, zones sous-dotees.",
                arguments: [
                  { name: "lieu", description: "Commune, code postal ou code departement", required: true },
                ],
              },
            ],
          },
        },
        serverInfo: { name: "service-public", version: VERSION },
        instructions: [
          "Serveur MCP pour les donnees publiques francaises (service-public.fr, DGFiP, DVF, BOFiP, KALI, DINUM).",
          "",
          "WORKFLOW RECOMMANDE :",
          "1. Commencer par l'outil `rechercher` avec une question en langage naturel.",
          "   Il dispatche automatiquement vers l'outil le plus adapte.",
          "2. Utiliser les outils specifiques directement si la categorie est connue :",
          "   - Demarches/droits : rechercher_fiche, lire_fiche, naviguer_themes",
          "   - Services locaux : rechercher_service_local",
          "   - Fiscalite locale : consulter_fiscalite_locale (taux TFB/TEOM/CFE par commune)",
          "   - Doctrine fiscale : rechercher_doctrine_fiscale (BOFiP — IR, TVA, IS, plus-values)",
          "   - Immobilier : consulter_transactions_immobilieres (prix DVF par commune, evolution=true pour historique 2019+)",
          "   - Simulateurs : simuler_taxe_fonciere, simuler_frais_notaire, simuler_impot_revenu",
          "   - Zonage : consulter_zonage_immobilier (zones ABC — Pinel, PTZ)",
          "   - Comparaison : comparer_communes (fiscalite + immobilier + services + securite + risques, 2-5 communes)",
          "   - Entreprises : rechercher_entreprise (SIRET/SIREN/nom + conventions collectives)",
          "   - Conventions : rechercher_convention_collective (IDCC ou mot-cle)",
          "   - Education : rechercher_etablissement_scolaire (ecoles, colleges, lycees par commune)",
          "   - Resultats lycees : consulter_resultats_lycee (IVAL — taux reussite, VA, mentions par lycee)",
          "   - Parcoursup : consulter_parcoursup (formations, selectivite, profil admis par ville/filiere)",
          "   - Acces soins : consulter_acces_soins (densite medecins, patientele MT, zones sous-dotees par departement)",
          "   - Insertion pro : consulter_insertion_professionnelle (InserJeunes — taux emploi/poursuite etudes apres CAP/Bac Pro/BTS)",
          "   - Securite : consulter_securite (delinquance departementale — cambriolages, vols, violences, taux/1000 hab.)",
          "   - Risques : consulter_risques_naturels (risques naturels/technologiques + arretes CatNat par commune)",
          "   - Journal Officiel : consulter_journal_officiel (JORF — textes publies, filtre LOI/DECRET/ARRETE/dates)",
          "   - Aide sociale : consulter_aide_sociale (stats CAF — allocataires RSA/APL/AAH/AF par commune ou dept)",
          "   - Marches publics : rechercher_marche_public (BOAMP — appels d'offres, attributions, MAPA par mots-cles/dept/acheteur)",
          "   - Budget communes : consulter_budget_commune (OFGL 2017-2024 — recettes, depenses, epargne brute, encours dette par commune)",
          "   - Budget EPCI : consulter_budget_epci (OFGL 2017-2024 — budget des intercommunalites, communautes de communes/agglomeration, metropoles)",
          "   - Evaluations nationales : consulter_evaluations_nationales (resultats CE2/6e par departement)",
          "   - Textes legaux : rechercher_texte_legal (Legifrance — lois, decrets, arretes par mots-cles ou reference NOR)",
          "   - Codes juridiques : rechercher_code_juridique (Legifrance — articles de code, recherche dans Code civil, Code du travail, etc.)",
          "   - Jurisprudence : rechercher_jurisprudence (Legifrance — arrets Cour de cassation, Conseil d'Etat, juridictions administratives)",
          "   - Subventions : rechercher_subvention (data.gouv.fr — subventions collectivites locales > 23 000 EUR, par beneficiaire/attribuant)",
          "   - Entreprises SIRENE : consulter_sirene_historique (creations/cessations par secteur NAF, commune ou departement)",
          "   - Offres emploi : rechercher_offre_emploi (France Travail — offres actives par mots-cles, commune, departement, type contrat CDI/CDD/interim)",
          "   - Annonces legales : rechercher_annonce_legale (BODACC — immatriculations, radiations, cessions, procedures collectives par SIREN/nom)",
          "   - Prix carburants : consulter_prix_carburant (flux temps reel — stations par departement/commune, tri par prix, Gazole/SP95/SP98/E10/E85/GPLc)",
          "",
          "PARAMETRES IMPORTANTS :",
          "- Les communes acceptent un nom, un code postal ou un code INSEE.",
          "- Paris/Lyon/Marseille sont geres automatiquement (arrondissements DVF).",
          "- Sans annee/exercice, les outils retournent l'evolution multi-annees.",
          "",
          "LIMITES :",
          "- DVF exclut l'Alsace, la Moselle et Mayotte.",
          "- Les simulateurs (TF, IR, frais notaire) sont indicatifs, pas des avis fiscaux.",
        ].join("\n"),
      });

    case "notifications/initialized":
      return new Response(null, { status: 204 });

    case "ping":
      return jsonRpcResponse(body.id, {});

    case "tools/list":
      return jsonRpcResponse(body.id, { tools: TOOLS });

    case "tools/call": {
      const params = body.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return jsonRpcError(body.id, -32602, "Missing tool name");
      }

      // Init table stats au premier appel
      if (!statsTableReady) {
        try { await ensureStatsTable(env.DB); statsTableReady = true; } catch { /* ignore */ }
      }

      const startMs = Date.now();
      let isError = false;
      try {
        const result = await executeTool(params.name, params.arguments || {}, env);
        isError = result.isError === true;
        const durationMs = Date.now() - startMs;

        // Log async sans bloquer la reponse
        ctx.waitUntil(logToolCall(env.DB, {
          tool_name: params.name,
          duration_ms: durationMs,
          is_error: isError,
          args_summary: summarizeArgs(params.arguments || {}),
        }));

        return jsonRpcResponse(body.id, result);
      } catch (error) {
        const durationMs = Date.now() - startMs;
        ctx.waitUntil(logToolCall(env.DB, {
          tool_name: params.name,
          duration_ms: durationMs,
          is_error: true,
          args_summary: summarizeArgs(params.arguments || {}),
        }));

        return jsonRpcResponse(body.id, {
          content: [{ type: "text", text: `Erreur: ${error instanceof Error ? error.message : "inconnue"}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}

// --- Main fetch handler ---

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
        },
      });
    }

    // T14 — Health check enrichi (BUG fix: D1 queries wrapped in try/catch)
    if (url.pathname === "/health") {
      let dbStatus: "ok" | "error" = "ok";
      let dbError: string | null = null;
      let ficheCount = 0;
      let lastSync: { completed_at: string; fiches_count: number } | null = null;
      let lastError: { at: string; status: string } | null = null;

      try {
        const syncRow = await env.DB.prepare(
          `SELECT completed_at, fiches_count, status FROM sync_log WHERE status = 'completed' ORDER BY id DESC LIMIT 1`,
        ).first<{ completed_at: string; fiches_count: number; status: string }>();

        const countRow = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM fiches`,
        ).first<{ total: number }>();

        const errorRow = await env.DB.prepare(
          `SELECT started_at, status FROM sync_log WHERE status != 'completed' AND status != 'running' ORDER BY id DESC LIMIT 1`,
        ).first<{ started_at: string; status: string }>();

        ficheCount = countRow?.total ?? 0;
        lastSync = syncRow
          ? { completed_at: syncRow.completed_at, fiches_count: syncRow.fiches_count }
          : null;
        lastError = errorRow
          ? { at: errorRow.started_at, status: errorRow.status }
          : null;
      } catch (e) {
        dbStatus = "error";
        dbError = e instanceof Error ? e.message : "D1 unavailable";
      }

      return Response.json({
        status: dbStatus === "ok" ? "ok" : "degraded",
        service: "mcp-service-public",
        version: VERSION,
        tools_count: TOOLS.length,
        tools: TOOLS.map((t) => t.name),
        db_status: dbStatus,
        db_error: dbError,
        fiches_count: ficheCount,
        last_sync: lastSync,
        last_error: lastError,
      });
    }

    // Service description
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json({
        name: "mcp-service-public",
        description: "MCP Server pour les donnees publiques francaises",
        version: VERSION,
        mcp_endpoint: "/mcp",
        transport: "streamable-http",
        openapi: "/openapi.json",
        tools: TOOLS.map((t) => t.name),
        source: "https://github.com/OneNicolas/mcp-service-public",
      });
    }

    // MCP Streamable HTTP endpoint
    if (url.pathname === "/mcp" && request.method === "POST") {
      const resp = await handleMcpPost(request, env, _ctx);
      resp.headers.set("Access-Control-Allow-Origin", "*");
      return resp;
    }

    // MCP GET (SSE for server notifications — not needed, but acknowledge)
    if (url.pathname === "/mcp" && request.method === "GET") {
      return new Response("SSE not implemented", { status: 405 });
    }

    // MCP DELETE (session termination — stateless, just accept)
    if (url.pathname === "/mcp" && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    // Full sync trigger
    if (url.pathname === "/admin/sync/full" && request.method === "POST") {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      try {
        const result = await syncDilaFull(env);
        return Response.json(result);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "unknown" },
          { status: 500 },
        );
      }
    }

    // Sync status
    if (url.pathname === "/admin/sync" && request.method === "GET") {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const logs = await env.DB.prepare(
        `SELECT * FROM sync_log ORDER BY id DESC LIMIT 5`,
      ).all();

      const count = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM fiches`,
      ).first<{ total: number }>();

      return Response.json({
        fiches_in_db: count?.total ?? 0,
        recent_syncs: logs.results,
      });
    }

    // T20 — Dashboard HTML + API JSON
    if ((url.pathname === "/admin/dashboard" || url.pathname === "/admin/dashboard/api") && request.method === "GET") {
      const token = url.searchParams.get("token") || request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        if (url.pathname.endsWith("/api")) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        return new Response("Unauthorized", { status: 401, headers: { "Content-Type": "text/plain" } });
      }

      try {
        if (!statsTableReady) {
          await ensureStatsTable(env.DB);
          statsTableReady = true;
        }
        const hours = Number(url.searchParams.get("hours")) || 24;
        const stats = await getDashboardData(env.DB, Math.min(hours, 720));

        // JSON API
        if (url.pathname.endsWith("/api")) {
          return Response.json({ version: VERSION, ...stats });
        }

        // HTML dashboard — gather additional context
        const countRow = await env.DB.prepare(
          "SELECT COUNT(*) as total FROM fiches",
        ).first<{ total: number }>();

        const lastSyncRow = await env.DB.prepare(
          "SELECT completed_at, fiches_count FROM sync_log WHERE status = 'completed' ORDER BY id DESC LIMIT 1",
        ).first<{ completed_at: string; fiches_count: number }>();

        const syncLogs = await env.DB.prepare(
          "SELECT id, started_at, completed_at, status, fiches_count FROM sync_log ORDER BY id DESC LIMIT 10",
        ).all();

        const html = renderDashboard({
          version: VERSION,
          ficheCount: countRow?.total ?? 0,
          lastSync: lastSyncRow ?? null,
          stats,
          syncLogs: (syncLogs.results ?? []) as any[],
        });

        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : "unknown" },
          { status: 500 },
        );
      }
    }

    // Reset stats dashboard
    if (url.pathname === "/admin/stats" && request.method === "DELETE") {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      try {
        const result = await env.DB.prepare("DELETE FROM tool_stats").run();
        return Response.json({ deleted: result.meta?.changes ?? 0, message: "Stats reset" });
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
      }
    }

    // T19 — OpenAPI spec (public, pas d'auth)
    if ((url.pathname === "/openapi.json" || url.pathname === "/openapi") && request.method === "GET") {
      const spec = generateOpenAPISpec(TOOLS, VERSION);
      return new Response(JSON.stringify(spec, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log("Cron: starting daily DILA full sync...");
    try {
      const result = await syncDilaFull(env);
      console.log(
        `Cron sync done: ${result.fichesInserted} fiches, ${result.themesCount} themes in ${result.durationMs}ms`,
      );
    } catch (error) {
      console.error("Cron sync failed:", error);
    }

    // Purge des stats de plus de 30 jours
    try {
      const purged = await purgeOldStats(env.DB, 30);
      if (purged > 0) console.log(`Cron: purged ${purged} old stats entries`);
    } catch { /* non-bloquant */ }
  },
};
