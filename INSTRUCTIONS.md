# mcp-service-public — Instructions projet

## Contexte

Serveur MCP (Model Context Protocol) TypeScript sur Cloudflare Workers donnant accès aux données publiques françaises via des outils interrogeables par des assistants IA.

- **Repo** : `OneNicolas/mcp-service-public` (branche `main`)
- **Production** : `https://mcp-service-public.nhaultcoeur.workers.dev/mcp`
- **Version actuelle** : v0.8.1
- **CI/CD** : GitHub → Cloudflare Workers Builds (auto-deploy sur push `main`)
- **Local** : `C:\\Users\\nhaultcoeur\\OneDrive - Scopi\\Projets\\mcp-service-public`

## Stack technique

- TypeScript, Cloudflare Workers (Streamable HTTP MCP)
- D1 SQLite (FTS5) pour les fiches DILA (~5 500 fiches, sync cron quotidien)
- APIs proxy : data.economie.gouv.fr (REI, BOFiP), data.gouv.fr (DVF, Zonage ABC), geo.api.gouv.fr, annuaire API
- Vitest pour les tests unitaires
- Pas de framework MCP SDK — implémentation JSON-RPC directe

## Architecture

```
src/
├── index.ts              # Router MCP + tool definitions + dispatcher (VERSION ici)
├── types.ts              # Env, ToolResult, Fiche...
├── tools/                # 1 fichier = 1 outil, export async function
│   ├── rechercher.ts                       # Dispatch unifié intelligent (7 catégories)
│   ├── rechercher-fiche.ts                 # FTS sur D1
│   ├── lire-fiche.ts                       # Lecture fiche par ID
│   ├── rechercher-service-local.ts         # Proxy annuaire
│   ├── naviguer-themes.ts                  # Arborescence thématique
│   ├── consulter-fiscalite-locale.ts       # Taux REI (CP, comparaison, tendances)
│   ├── rechercher-doctrine-fiscale.ts      # BOFiP
│   ├── consulter-transactions-immobilieres.ts  # DVF + PLM
│   ├── simuler-taxe-fonciere.ts            # Simulateur TF hybride REI+DVF
│   ├── simuler-frais-notaire.ts            # Frais de notaire (DMTO par département + émoluments + CSI)
│   ├── consulter-zonage-immobilier.ts      # Zones ABC (Pinel, PTZ, plafonds)
│   ├── comparer-communes.ts               # Tableau croisé multi-communes (REI + DVF + zonage + services)
│   └── __tests__/                          # Tests unitaires vitest
│       ├── simuler-taxe-fonciere.test.ts
│       ├── rechercher.test.ts
│       └── simuler-frais-notaire.test.ts
├── utils/
│   └── geo-api.ts        # resolveCodePostal, resolveNomCommune
├── parsers/
│   └── fiche-parser.ts   # XML DILA → Fiche
└── sync/
    └── dila-sync.ts      # Sync quotidien ZIP DILA → D1
```

## Pattern pour ajouter un outil

1. Créer `src/tools/mon-outil.ts` avec `export async function monOutil(args, env?): Promise<ToolResult>`
2. Dans `index.ts` : ajouter import + définition dans `TOOLS[]` + case dans `executeTool()`
3. Bump `VERSION`
4. Ajouter tests dans `src/tools/__tests__/`
5. Push sur `main` → auto-deploy

## Les 12 outils actuels (v0.8.1)

| # | Outil | Description |
|---|---|---|
| 1 | `rechercher` | Dispatch unifié (fiches, fiscalité, doctrine, DVF, simulation TF, frais notaire, zonage ABC) |
| 2 | `rechercher_fiche` | Fiches pratiques service-public.fr (FTS D1) |
| 3 | `lire_fiche` | Lecture complète d'une fiche par ID |
| 4 | `rechercher_service_local` | Annuaire des services publics locaux |
| 5 | `naviguer_themes` | Arborescence thématique service-public.fr |
| 6 | `consulter_fiscalite_locale` | Taux d'imposition REI (CP, comparaison, tendances 4 ans) |
| 7 | `rechercher_doctrine_fiscale` | Doctrine BOFiP (8 983 articles) |
| 8 | `consulter_transactions_immobilieres` | DVF prix/m², médiane, répartition (PLM inclus) |
| 9 | `simuler_taxe_fonciere` | Estimation TF = VLC estimée × 50% × taux REI réel |
| 10 | `simuler_frais_notaire` | DMTO exact par département + émoluments dégressifs + CSI + débours |
| 11 | `consulter_zonage_immobilier` | Zones ABC : Pinel, PTZ, plafonds loyers/ressources |
| 12 | `comparer_communes` | Tableau croisé REI + DVF + zonage + services publics (2-5 communes) |

## Sprint 5 — Complété ✅

| Tâche | Description | Statut |
|-------|-------------|--------|
| T7 | Intégrer simulateur TF dans `rechercher.ts` (catégorie `simulation_tf`) | ✅ |
| T8 | Mise à jour README.md (12 outils, exemples, formules) | ✅ |
| T9 | Nouveau tool `simuler_frais_notaire` | ✅ |
| T10 | Nouveau tool `consulter_zonage_immobilier` | ✅ |
| T11 | Nouveau tool `comparer_communes` | ✅ |
| T12 | Tests unitaires vitest (simuler-taxe-fonciere, rechercher, frais-notaire) | ✅ |
| T13 | Config build `wrangler.toml` (section `[build]`) | ✅ |
| T14 | Monitoring `/health` enrichi (version, tools_count, last_error) | ✅ |

## Sprint 6 — En cours

| Tâche | Description | Statut |
|-------|-------------|--------|
| T15 | Intégrer `simuler_frais_notaire` et `consulter_zonage_immobilier` dans le dispatch `rechercher.ts` | ✅ |
| T16 | Taux DMTO par département (map statique 101 départements, source LF 2025 art. 116) | ✅ |
| T17 | Enrichir `comparer_communes` avec les services publics locaux (API Annuaire) | ✅ |
| T18 | Cache des résultats fréquents (zones ABC, taux REI) avec Cloudflare Cache API | ⏳ |

## Sprint 7 — Roadmap

- **T19** — OpenAPI / JSON Schema pour documentation auto des outils
- **T20** — Dashboard web `/admin/dashboard` avec statistiques d'usage
- **T21** — Améliorer le simulateur TF (prise en compte abattements, taux intercommunaux détaillés)

## Contraintes techniques

- Cloudflare Workers : pas de fs, pas de streams Node, CPU time limité (paid plan)
- D1 batch max 100 statements
- Push GitHub via API : attention aux regex avec `\\n\\r` dans les strings JSON (utiliser des formes simples)
- Paris/Lyon/Marseille (PLM) : code INSEE unique → expansion en arrondissements pour DVF
- geo.api.gouv.fr : recherche accent-insensitive nécessite des requêtes séparées par terme

## Conventions

- 1 fichier = 1 outil, noms en kebab-case
- Fonctions courtes, noms explicites, commentaires pour le "pourquoi"
- DRY : réutiliser `resolveCodePostal`, `resolveNomCommune`, `sanitize`, `formatEuro`
- Exporter les fonctions pures pour les tests unitaires
- Résultats formatés en Markdown avec sources citées
- Disclaimers obligatoires pour les estimations
- Version bump à chaque nouvel outil
- Tests dans `src/tools/__tests__/` pour les fonctions de calcul
