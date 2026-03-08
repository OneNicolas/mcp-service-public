# mcp-service-public — Instructions projet

## Contexte

Serveur MCP (Model Context Protocol) TypeScript sur Cloudflare Workers donnant acces aux donnees publiques francaises via des outils interrogeables par des assistants IA.

- **Repo** : `OneNicolas/mcp-service-public` (branche `main`)
- **Production** : `https://mcp-service-public.nhaultcoeur.workers.dev/mcp`
- **Version actuelle** : v1.13.1
- **CI/CD** : GitHub → Cloudflare Workers Builds (auto-deploy sur push `main`)
- **Local** : `C:\\Users\\nhaultcoeur\\OneDrive - Scopi\\Projets\\mcp-service-public`

## Stack technique

- TypeScript, Cloudflare Workers (Streamable HTTP MCP)
- D1 SQLite (FTS5) pour les fiches DILA (~5 500 fiches, sync cron quotidien)
- APIs proxy : data.economie.gouv.fr (REI, BOFiP), data.gouv.fr (DVF, Zonage ABC, KALI, SSMSI securite), data.education.gouv.fr (Annuaire, IVAL, Evaluations nationales, InserJeunes), data.ameli.fr (soins), georisques.gouv.fr (risques naturels, CatNat), geo.api.gouv.fr, annuaire API
- Vitest pour les tests unitaires
- Pas de framework MCP SDK — implementation JSON-RPC directe

## Architecture

```
src/
├── index.ts              # Router MCP + tool definitions + dispatcher (VERSION ici)
├── types.ts              # Env, ToolResult, Fiche...
├── tools/                # 1 fichier = 1 outil, export async function
│   ├── rechercher.ts                       # Dispatch unifie intelligent (18 categories : fiches, fiscalite, doctrine, DVF, TF, frais notaire, zonage, IR, conventions, entreprises, education, IVAL, evaluations, parcoursup, acces soins, insertion pro, securite, risques naturels)
│   ├── rechercher-fiche.ts                 # FTS sur D1 (sanitizer + fallback LIKE + snippets)
│   ├── lire-fiche.ts                       # Lecture fiche par ID
│   ├── rechercher-service-local.ts         # Proxy annuaire
│   ├── naviguer-themes.ts                  # Arborescence thematique
│   ├── consulter-fiscalite-locale.ts       # Taux REI (CP, comparaison, tendances)
│   ├── rechercher-doctrine-fiscale.ts      # BOFiP
│   ├── consulter-transactions-immobilieres.ts  # DVF + PLM
│   ├── simuler-taxe-fonciere.ts            # Simulateur TF hybride REI+DVF
│   ├── simuler-frais-notaire.ts            # Frais de notaire (DMTO par departement + emoluments + CSI)
│   ├── consulter-zonage-immobilier.ts      # Zones ABC (Pinel, PTZ, plafonds)
│   ├── comparer-communes.ts               # Tableau croise multi-communes (REI + DVF + zonage + services)
│   ├── simuler-impot-revenu.ts            # Bareme progressif IR 2025, QF, decote, CEHR
│   ├── rechercher-convention-collective.ts # Conventions collectives KALI via data.gouv.fr
│   ├── rechercher-entreprise.ts            # Recherche entreprise SIRET/SIREN/nom + enrichissement KALI
│   ├── rechercher-etablissement-scolaire.ts # Annuaire education (ecoles, colleges, lycees)
│   ├── consulter-resultats-lycee.ts        # IVAL lycees GT + Pro (taux reussite, VA, mentions)
│   ├── consulter-evaluations-nationales.ts # Evaluations nationales 6eme + CE2 par departement
│   ├── consulter-parcoursup.ts             # Formations Parcoursup (14 000+ formations, selectivite, profil admis)
│   ├── consulter-acces-soins.ts            # Acces aux soins (data.ameli.fr, effectifs/densite medecins, patientele MT)
│   ├── consulter-insertion-professionnelle.ts  # Insertion pro InserJeunes (taux emploi, poursuite etudes lycees pro)
│   ├── consulter-securite.ts               # Securite/delinquance departementale (SSMSI via data.gouv.fr Tabular)
│   ├── consulter-risques-naturels.ts       # Risques naturels et technologiques + CatNat (Georisques API v1)
│   ├── rechercher-texte-legal.ts           # Textes legaux (lois/decrets/arretes) via Legifrance proxy MCP
│   ├── rechercher-code-juridique.ts        # Articles de codes juridiques via Legifrance proxy MCP
│   ├── rechercher-jurisprudence.ts         # Jurisprudence judiciaire via Legifrance proxy MCP
│   ├── consulter-journal-officiel.ts       # Journal Officiel JORF via API PISTE (fond JORF, filtre nature/dates)
│   ├── consulter-aide-sociale.ts           # Stats CAF allocataires RSA/APL/AAH/AF par commune/dept (data.caf.fr)
│   └── __tests__/                          # Tests unitaires vitest
│       ├── simuler-taxe-fonciere.test.ts
│       ├── rechercher.test.ts
│       ├── rechercher-fiche.test.ts
│       ├── simuler-frais-notaire.test.ts
│       ├── simuler-impot-revenu.test.ts
│       ├── rechercher-entreprise.test.ts
│       ├── rechercher-etablissement-scolaire.test.ts
│       ├── consulter-resultats-lycee.test.ts
│       ├── consulter-evaluations-nationales.test.ts
│       ├── consulter-parcoursup.test.ts
│       ├── rechercher-integration.test.ts
│       ├── comparer-communes-education.test.ts
│       ├── consulter-acces-soins.test.ts
│       ├── consulter-insertion-professionnelle.test.ts
│       ├── consulter-securite.test.ts
│       ├── consulter-risques-naturels.test.ts
│       └── rechercher-legifrance.test.ts
├── utils/
│   ├── cache.ts              # cachedFetch avec timeout, retry 1x, FetchError
│   ├── geo-api.ts            # resolveCodePostal, resolveNomCommune, resolveCodeInsee
│   ├── legifrance-mcp.ts     # Proxy HTTP vers MCP Legifrance (openlegi.fr) — callLegifranceTool
│   └── stats.ts              # Logging appels outils + dashboard
├── admin/
│   └── dashboard.ts      # Dashboard HTML admin
├── parsers/
│   └── fiche-parser.ts   # XML DILA → Fiche
└── sync/
    └── dila-sync.ts      # Sync quotidien ZIP DILA → D1
```

## Pattern pour ajouter un outil

1. Creer `src/tools/mon-outil.ts` avec `export async function monOutil(args, env?): Promise<ToolResult>`
2. Dans `index.ts` : ajouter import + definition dans `TOOLS[]` + case dans `executeTool()`
3. Bump `VERSION`
4. Ajouter tests dans `src/tools/__tests__/`
5. Push sur `main` → auto-deploy

## Les 34 outils actuels (v1.13.1)

| # | Outil | Description |
|---|---|---|
| 1 | `rechercher` | Dispatch unifie (21 categories : fiches, fiscalite, doctrine, DVF, simulation TF, frais notaire, zonage ABC, simulation IR, conventions, entreprises, education, resultats lycee, evaluations nationales, parcoursup, acces soins, insertion pro, securite, risques naturels, texte_legal, code_juridique, jurisprudence) |
| 2 | `rechercher_fiche` | Fiches pratiques service-public.fr (FTS D1 + fallback LIKE + snippets) |
| 3 | `lire_fiche` | Lecture complete d'une fiche par ID |
| 4 | `rechercher_service_local` | Annuaire des services publics locaux |
| 5 | `naviguer_themes` | Arborescence thematique service-public.fr |
| 6 | `consulter_fiscalite_locale` | Taux d'imposition REI (CP, comparaison, tendances 4 ans) |
| 7 | `rechercher_doctrine_fiscale` | Doctrine BOFiP (8 983 articles) |
| 8 | `consulter_transactions_immobilieres` | DVF prix/m2, mediane, repartition (PLM inclus) |
| 9 | `simuler_taxe_fonciere` | Estimation TF = VLC estimee x 50% x taux REI reel |
| 10 | `simuler_frais_notaire` | DMTO exact par departement + emoluments degressifs + CSI + debours |
| 11 | `consulter_zonage_immobilier` | Zones ABC : Pinel, PTZ, plafonds loyers/ressources |
| 12 | `comparer_communes` | Tableau croise population/densite + REI + DVF + zonage + education + scores 6eme + sante + services (2-5 communes) |
| 13 | `simuler_impot_revenu` | Bareme progressif IR 2025, quotient familial, decote, CEHR |
| 14 | `rechercher_convention_collective` | Conventions collectives KALI (IDCC, mot-cle, lien Legifrance) |
| 15 | `rechercher_entreprise` | Recherche entreprise SIRET/SIREN/nom + conventions collectives KALI |
| 16 | `rechercher_etablissement_scolaire` | Annuaire education (68 000+ ecoles, colleges, lycees par commune) |
| 17 | `consulter_resultats_lycee` | IVAL lycees GT + Pro (taux reussite bac, VA, mentions, acces 2nde-bac) |
| 18 | `consulter_evaluations_nationales` | Evaluations nationales 6eme + CE2 par departement (scores, IPS, groupes, tendance) |
| 19 | `consulter_parcoursup` | Formations Parcoursup par mot-cle, ville, departement, filiere (14 000+ formations, selectivite, profil admis) |
| 20 | `consulter_acces_soins` | Acces aux soins par departement : effectifs/densite medecins, patientele MT, primo-installations, zones sous-dotees (data.ameli.fr) |
| 21 | `consulter_insertion_professionnelle` | Insertion pro InserJeunes : taux emploi 6/12/24 mois, poursuite etudes, VA, detail par formation CAP/BacPro/BTS (data.education.gouv.fr) |
| 22 | `consulter_securite` | Statistiques securite/delinquance departementales : 18 indicateurs SSMSI, taux pour 1000 hab., evolution annuelle (data.gouv.fr Tabular API) |
| 23 | `consulter_risques_naturels` | Risques naturels et technologiques par commune + arretes CatNat (API Georisques BRGM/MTE) |
| 24 | `rechercher_texte_legal` | Recherche dans les textes legaux (lois, decrets, arretes, ordonnances) via Legifrance (openlegi.fr) |
| 25 | `rechercher_code_juridique` | Recherche d'articles dans les codes juridiques francais (Code civil, travail, penal...) via Legifrance |
| 26 | `rechercher_jurisprudence` | Recherche de jurisprudence judiciaire (Cour de cassation, cours d'appel, tribunaux) via Legifrance |
| 27 | `consulter_journal_officiel` | Recherche dans le Journal Officiel (JORF) : lois, decrets, arretes, ordonnances, nominations — filtre type/dates (API PISTE DILA) |
| 28 | `consulter_aide_sociale` | Statistiques CAF par commune ou departement : foyers allocataires RSA/APL/AAH/AF/PA/CF... depuis 2020 (data.caf.fr CNAF) |
| 29 | `rechercher_marche_public` | Recherche d'avis marches publics dans le BOAMP (appels d'offres, attributions, MAPA, DSP) — filtre type/dept/acheteur/dates (BOAMP DILA Opendatasoft) |
| 30 | `rechercher_annonce_legale` | Recherche d'annonces legales dans le BODACC (immatriculations, radiations, cessions, procedures collectives) — filtre SIREN/nom/type/dept (BODACC DILA Opendatasoft) |

## Historique des sprints

### Sprint 5 — Complete ✅
| Tache | Description |
|-------|-------------|
| T7 | Integrer simulateur TF dans `rechercher.ts` (categorie `simulation_tf`) |
| T8 | Mise a jour README.md (12 outils, exemples, formules) |
| T9 | Nouveau tool `simuler_frais_notaire` |
| T10 | Nouveau tool `consulter_zonage_immobilier` |
| T11 | Nouveau tool `comparer_communes` |
| T12 | Tests unitaires vitest (simuler-taxe-fonciere, rechercher, frais-notaire) |
| T13 | Config build `wrangler.toml` (section `[build]`) |
| T14 | Monitoring `/health` enrichi (version, tools_count, last_error) |

### Sprint 6 — Complete ✅
| Tache | Description |
|-------|-------------|
| T15 | Integrer frais notaire et zonage dans le dispatch rechercher.ts |
| T16 | Taux DMTO par departement (map statique 101 departements, LF 2025) |
| T17 | Enrichir comparer_communes avec les services publics locaux |
| T18 | Cache Cloudflare — reporte |

### Sprint 7 — Complete ✅
| Tache | Description |
|-------|-------------|
| T19 | OpenAPI / JSON Schema — reporte |
| T20 | Dashboard web /admin/dashboard avec statistiques d'usage |
| T21 | Ameliorer le simulateur TF — reporte |

### Sprint 8 — Complete ✅
| Tache | Description |
|-------|-------------|
| T22 | Robustifier FTS : sanitizer query FTS5, fallback LIKE, snippets |
| T23 | Ameliorer extraction commune : debut de phrase, codes postaux, noms composes |
| T24 | Nouveau tool `simuler_impot_revenu` (bareme IR 2025, QF, decote, CEHR) |
| T25 | Nouveau tool `rechercher_convention_collective` (KALI via data.gouv.fr) |
| T26 | cachedFetch : timeout 10s, retry 1x sur 5xx/timeout, FetchError |
| T27 | Mise a jour INSTRUCTIONS.md et README.md pour v1.0 |

### Sprint 9 — Complete ✅
| Tache | Description |
|-------|-------------|
| T32 | Nouveau tool `rechercher_entreprise` (SIRET/SIREN/nom via API DINUM + enrichissement KALI) |
| T33 | Publication registre MCP (server.json, GitHub Actions, registry.modelcontextprotocol.io) |

### Sprint 10 — Complete ✅
| Tache | Description |
|-------|-------------|
| T34 | Server Instructions MCP (champ `instructions` dans `initialize`) |
| T35 | Evolution prix DVF multi-annees (parametre `evolution: true`, 2019-aujourd'hui) |
| T36 | Mise a jour schema registre MCP vers 2025-12-11 |
| T37 | Tests robustesse dispatch (edge cases ambigus, fautes de frappe, requetes mixtes) |

### Sprint 11 — Complete ✓
| Tache | Description |
|-------|-------------|
| T28 | Nouveau tool `rechercher_etablissement_scolaire` (Annuaire education, 68 000+ etablissements) |
| T29 | Nouveau tool `consulter_resultats_lycee` (IVAL GT + Pro, taux reussite, VA, mentions) |
| T31 | Enrichir `comparer_communes` avec donnees education (ecoles, colleges, lycees via API Education nationale) |
| T32 | Ameliorer simulateur TF (8 tranches coef entretien, scenario abattement RP, calcul effectif) |

### Sprint 12 — Complete ✅
| Tache | Description |
|-------|-------------|
| T38 | Donnees demographiques dans `comparer_communes` (population, densite via geo.api.gouv.fr) |
| T39 | Nouveau tool `consulter_evaluations_nationales` (scores 6eme + CE2 par departement, IPS) |
| T40 | Integrer scores 6eme dans `comparer_communes` (francais, maths, IPS par departement) |
| T41 | Tests robustesse education + dispatch (parseEducationResults edge cases, nouveaux patterns) |

### Sprint 13 — Complete ✅
| Tache | Description |
|-------|-------------|
| T42 | Nouveau tool `consulter_parcoursup` (formations Parcoursup par mot-cle, ville, departement, filiere, 14 000+ formations) |
| T43 | Colleges de secteur (carte scolaire) dans `comparer_communes` via data.education.gouv.fr |
| T44 | Categorie `parcoursup` dans le dispatch `rechercher.ts` (14 categories) |
| T45 | Historique multi-annees IVAL dans `consulter_resultats_lycee` (parametre `evolution: true`, sessions 2012-2024) |
| T46 | Tests Parcoursup + dispatch + integration (309 tests total) |

### Sprint 14 — Complete ✅
| Tache | Description |
|-------|-------------|
| T47 | Nouveau tool `consulter_acces_soins` (data.ameli.fr : effectifs/densite medecins, patientele MT, primo-installations, zones sous-dotees, file active specialistes) |
| T48 | Nouveau tool `consulter_insertion_professionnelle` (InserJeunes : taux emploi 6/12/24 mois, poursuite etudes, VA, detail par formation CAP/BacPro/BTS) |
| T49 | Enrichir `comparer_communes` avec donnees sante departementales (densite MG, specialistes, patientele MT via data.ameli.fr) |
| T50 | Categories `acces_soins` et `insertion_pro` dans le dispatch `rechercher.ts` (16 categories) |
| T51 | Tests dispatch + fix regex pluriels + fix types TS (326 tests, 0 erreurs TS) |

### Sprint 15 — Complete ✅
| Tache | Description |
|-------|-------------|
| T52 | CI/CD : workflow GitHub Actions typecheck + vitest sur push/PR main |
| T53 | Nouveau tool `consulter_securite` (18 indicateurs SSMSI departementaux via data.gouv.fr Tabular API) |
| T54 | Nouveau tool `consulter_risques_naturels` (risques GASPAR + arretes CatNat via API Georisques v1) |
| T55 | Categories `securite` et `risques_naturels` dans le dispatch `rechercher.ts` (18 categories) |
| T56 | Enrichir `comparer_communes` avec securite departementale + risques naturels |

### Sprint 16 — Complete ✅
| Tache | Description |
|-------|-------------|
| T57 | Audit `additional_properties` global — aucune occurrence dans src/ |
| T58 | Nouveau tool `rechercher_texte_legal` (lois/decrets/arretes via Legifrance proxy MCP openlegi.fr) |
| T59 | Nouveau tool `rechercher_code_juridique` (Code civil/travail/penal/commerce... via Legifrance) |
| T60 | Nouveau tool `rechercher_jurisprudence` (Cour de cassation, cours d'appel, tribunaux via Legifrance) |
| T61 | 3 nouvelles categories dispatch : `texte_legal`, `code_juridique`, `jurisprudence` (21 categories total) |
| T62 | Version bump v1.9.0 — 26 outils, 21 categories dispatch |

### Sprint 21 — Complete ✅
| Tache | Description |
|-------|-------------|
| Fix | `comparer_communes` : resolveInput essaie d'abord resolveCodeInsee avant resolveCodePostal (codes INSEE 69123/38185/63113 mal resolus) |
| Fix | `legifrance-client.ts` : fond CODE→CODE_ETAT, LODA→LODA_ETAT, filtres valeurs[] (tableau), sort PERTINENCE obligatoire, flattenCodeResults pour structure sections[].extracts[], champs reels extracts (values[], legalStatus) |
| Fix | `legifrance-client.ts` formatter texte_legal/jurisprudence : champs reels JSON (num, dateTexte, datePubli, juridiction, numeroAffaire, titreLong) vs noms TS incorrects (numero, datePublicationJO, numDecision, dateDecision) |
| Bump | Version v1.13.1 |

### Sprint 19 — Complete ✅
| Tache | Description |
|-------|-------------|
| T73 | **Nouveau** : `rechercher_marche_public` (BOAMP — appels d'offres, attributions, MAPA, DSP via boamp-datadila.opendatasoft.com) |
| T76 | **Amelioration** : `comparer_communes` enrichi — IVAL meilleur lycee bac GT (taux reussite, VA, mentions) + aide sociale CAF dept (RSA/AL/AAH foyers) |
| T80 | **Nouveau** : `rechercher_annonce_legale` (BODACC — immatriculations, radiations, cessions, procedures collectives via bodacc-datadila.opendatasoft.com) |
| T81 | **Qualite** : 459 tests total (0 echec) — 11 tests BOAMP + 12 tests BODACC + 11 tests IVAL/CAF comparer + routing T73/T80 dans rechercher.ts |
| T82 | Version bump v1.11.0 — 30 outils, 25 categories dispatch |

### Sprint 18 — Complete ✅
| Tache | Description |
|-------|-------------|
| T70 | **Fix** : `pass env` dans `rechercher.ts` dispatcher pour les 3 outils Legifrance (texte_legal, code_juridique, jurisprudence) — *deploye* |
| T71 | **Fix** : endpoint `DELETE /admin/stats` pour reset dashboard |
| T72 | **Nouveau** : `consulter_journal_officiel` (JORF via API PISTE DILA — fond JORF, filtre nature/dates, searchJorf dans legifrance-client.ts) |
| T73 | **Skip** : `rechercher_marche_public` (BOAMP) — reporte sprint suivant |
| T74 | **Nouveau** : `consulter_aide_sociale` (stats CNAF — allocataires RSA/APL/AAH/AF/PA par commune/dept via data.caf.fr Opendatasoft v2.1) |
| T75 | **Amelioration** : routing `rechercher.ts` — 2 nouvelles categories `journal_officiel` + `aide_sociale`, helper `extractTypeTexteJorf` |
| T76 | **Skip** : enrichir `comparer_communes` — reporte sprint suivant |
| T77 | **Qualite** : 36 tests rechercher-legifrance + 10 tests T72 JORF + routing T74/T75 (421 tests total, 0 echec) |
| T78 | **Skip** : DX — reporte sprint suivant |
| T79 | Version bump v1.10.0 — 28 outils, 23 categories dispatch |

### Sprint 17 — Complete ✅
| Tache | Description |
|-------|-------------|
| T63 | `LegifranceClient` OAuth2 PISTE — token cache module-level, `/search` multi-fonds, formatters (src/utils/legifrance-client.ts) |
| T64 | Adapter `rechercher_texte_legal` — fond LODA via API PISTE officielle |
| T65 | Adapter `rechercher_code_juridique` — fond CODE via API PISTE officielle |
| T66 | Adapter `rechercher_jurisprudence` — fond JURI/CAPP via API PISTE officielle |
| T67 | `types.ts` : ajout `PISTE_CLIENT_ID` / `PISTE_CLIENT_SECRET` dans Env |
| T68 | Tests mis a jour — mock `searchLoda/searchCode/searchJuri` (legifrance-client.ts) |
| T69 | Version bump v1.9.1 |

## Contraintes techniques

- Cloudflare Workers : pas de fs, pas de streams Node, CPU time limite (paid plan)
- D1 batch max 100 statements
- Push GitHub via API : attention aux regex avec `\\n\\r` dans les strings JSON (utiliser des formes simples)
- Ne jamais pusher de fichiers avec accents via github:push_files (encode en \uXXXX)
- Paris/Lyon/Marseille (PLM) : code INSEE unique → expansion en arrondissements pour DVF
- geo.api.gouv.fr : recherche accent-insensitive necessite des requetes separees par terme

## Conventions

- 1 fichier = 1 outil, noms en kebab-case
- Fonctions courtes, noms explicites, commentaires pour le "pourquoi"
- DRY : reutiliser `resolveCodePostal`, `resolveNomCommune`, `sanitizeFtsQuery`, `formatEuro`
- Exporter les fonctions pures pour les tests unitaires
- Resultats formates en Markdown avec sources citees
- Disclaimers obligatoires pour les estimations
- Version bump a chaque nouvel outil
- Tests dans `src/tools/__tests__/` pour les fonctions de calcul
