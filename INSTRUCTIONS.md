# mcp-service-public — Instructions projet

## Contexte

Serveur MCP (Model Context Protocol) TypeScript sur Cloudflare Workers donnant acces aux donnees publiques francaises via des outils interrogeables par des assistants IA.

- **Repo** : `OneNicolas/mcp-service-public` (branche `main`)
- **Production** : `https://mcp-service-public.nhaultcoeur.workers.dev/mcp`
- **Version actuelle** : v1.5.0
- **CI/CD** : GitHub → Cloudflare Workers Builds (auto-deploy sur push `main`)
- **Local** : `C:\\Users\\nhaultcoeur\\OneDrive - Scopi\\Projets\\mcp-service-public`

## Stack technique

- TypeScript, Cloudflare Workers (Streamable HTTP MCP)
- D1 SQLite (FTS5) pour les fiches DILA (~5 500 fiches, sync cron quotidien)
- APIs proxy : data.economie.gouv.fr (REI, BOFiP), data.gouv.fr (DVF, Zonage ABC, KALI), data.education.gouv.fr (Annuaire, IVAL, Evaluations nationales), geo.api.gouv.fr, annuaire API
- Vitest pour les tests unitaires
- Pas de framework MCP SDK — implementation JSON-RPC directe

## Architecture

```
src/
├── index.ts              # Router MCP + tool definitions + dispatcher (VERSION ici)
├── types.ts              # Env, ToolResult, Fiche...
├── tools/                # 1 fichier = 1 outil, export async function
│   ├── rechercher.ts                       # Dispatch unifie intelligent (14 categories)
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
│       └── comparer-communes-education.test.ts
├── utils/
│   ├── cache.ts          # cachedFetch avec timeout, retry 1x, FetchError
│   ├── geo-api.ts        # resolveCodePostal, resolveNomCommune, resolveCodeInsee
│   └── stats.ts          # Logging appels outils + dashboard
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

## Les 19 outils actuels (v1.5.0)

| # | Outil | Description |
|---|---|---|
| 1 | `rechercher` | Dispatch unifie (14 categories : fiches, fiscalite, doctrine, DVF, simulation TF, frais notaire, zonage ABC, simulation IR, conventions, entreprises, education, resultats lycee, evaluations nationales, parcoursup) |
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
| 12 | `comparer_communes` | Tableau croise population/densite + REI + DVF + zonage + education + scores 6eme + services (2-5 communes) |
| 13 | `simuler_impot_revenu` | Bareme progressif IR 2025, quotient familial, decote, CEHR |
| 14 | `rechercher_convention_collective` | Conventions collectives KALI (IDCC, mot-cle, lien Legifrance) |
| 15 | `rechercher_entreprise` | Recherche entreprise SIRET/SIREN/nom + conventions collectives KALI |
| 16 | `rechercher_etablissement_scolaire` | Annuaire education (68 000+ ecoles, colleges, lycees par commune) |
| 17 | `consulter_resultats_lycee` | IVAL lycees GT + Pro (taux reussite bac, VA, mentions, acces 2nde-bac) |
| 18 | `consulter_evaluations_nationales` | Evaluations nationales 6eme + CE2 par departement (scores, IPS, groupes, tendance) |
| 19 | `consulter_parcoursup` | Formations Parcoursup par mot-cle, ville, departement, filiere (14 000+ formations, selectivite, profil admis) |

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
