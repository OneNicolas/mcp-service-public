# mcp-service-public \u2014 Instructions projet

## Contexte

Serveur MCP (Model Context Protocol) TypeScript sur Cloudflare Workers donnant acc\u00e8s aux donn\u00e9es publiques fran\u00e7aises via des outils interrogeables par des assistants IA.

- **Repo** : `OneNicolas/mcp-service-public` (branche `main`)
- **Production** : `https://mcp-service-public.nhaultcoeur.workers.dev/mcp`
- **Version actuelle** : v0.8.0
- **CI/CD** : GitHub \u2192 Cloudflare Workers Builds (auto-deploy sur push `main`)
- **Local** : `C:\\Users\\nhaultcoeur\\OneDrive - Scopi\\Projets\\mcp-service-public`

## Stack technique

- TypeScript, Cloudflare Workers (Streamable HTTP MCP)
- D1 SQLite (FTS5) pour les fiches DILA (~5 500 fiches, sync cron quotidien)
- APIs proxy : data.economie.gouv.fr (REI, BOFiP), data.gouv.fr (DVF, Zonage ABC), geo.api.gouv.fr, annuaire API
- Vitest pour les tests unitaires
- Pas de framework MCP SDK \u2014 impl\u00e9mentation JSON-RPC directe

## Architecture

```
src/
\u251c\u2500\u2500 index.ts              # Router MCP + tool definitions + dispatcher (VERSION ici)
\u251c\u2500\u2500 types.ts              # Env, ToolResult, Fiche...
\u251c\u2500\u2500 tools/                # 1 fichier = 1 outil, export async function
\u2502   \u251c\u2500\u2500 rechercher.ts                       # Dispatch unifi\u00e9 intelligent (fiches, fiscalit\u00e9, doctrine, DVF, simulation TF)
\u2502   \u251c\u2500\u2500 rechercher-fiche.ts                 # FTS sur D1
\u2502   \u251c\u2500\u2500 lire-fiche.ts                       # Lecture fiche par ID
\u2502   \u251c\u2500\u2500 rechercher-service-local.ts         # Proxy annuaire
\u2502   \u251c\u2500\u2500 naviguer-themes.ts                  # Arborescence th\u00e9matique
\u2502   \u251c\u2500\u2500 consulter-fiscalite-locale.ts       # Taux REI (CP, comparaison, tendances)
\u2502   \u251c\u2500\u2500 rechercher-doctrine-fiscale.ts      # BOFiP
\u2502   \u251c\u2500\u2500 consulter-transactions-immobilieres.ts  # DVF + PLM
\u2502   \u251c\u2500\u2500 simuler-taxe-fonciere.ts            # Simulateur TF hybride REI+DVF
\u2502   \u251c\u2500\u2500 simuler-frais-notaire.ts            # Frais de notaire (DMTO + \u00e9moluments + CSI)
\u2502   \u251c\u2500\u2500 consulter-zonage-immobilier.ts      # Zones ABC (Pinel, PTZ, plafonds)
\u2502   \u251c\u2500\u2500 comparer-communes.ts               # Tableau crois\u00e9 multi-communes
\u2502   \u2514\u2500\u2500 __tests__/                          # Tests unitaires vitest
\u2502       \u251c\u2500\u2500 simuler-taxe-fonciere.test.ts
\u2502       \u251c\u2500\u2500 rechercher.test.ts
\u2502       \u2514\u2500\u2500 simuler-frais-notaire.test.ts
\u251c\u2500\u2500 utils/
\u2502   \u2514\u2500\u2500 geo-api.ts        # resolveCodePostal, resolveNomCommune
\u251c\u2500\u2500 parsers/
\u2502   \u2514\u2500\u2500 fiche-parser.ts   # XML DILA \u2192 Fiche
\u2514\u2500\u2500 sync/
    \u2514\u2500\u2500 dila-sync.ts      # Sync quotidien ZIP DILA \u2192 D1
```

## Pattern pour ajouter un outil

1. Cr\u00e9er `src/tools/mon-outil.ts` avec `export async function monOutil(args, env?): Promise<ToolResult>`
2. Dans `index.ts` : ajouter import + d\u00e9finition dans `TOOLS[]` + case dans `executeTool()`
3. Bump `VERSION`
4. Ajouter tests dans `src/tools/__tests__/`
5. Push sur `main` \u2192 auto-deploy

## Les 12 outils actuels (v0.8.0)

| # | Outil | Description |
|---|---|---|
| 1 | `rechercher` | Dispatch unifi\u00e9 (fiches, fiscalit\u00e9, doctrine, DVF, simulation TF) |
| 2 | `rechercher_fiche` | Fiches pratiques service-public.fr (FTS D1) |
| 3 | `lire_fiche` | Lecture compl\u00e8te d'une fiche par ID |
| 4 | `rechercher_service_local` | Annuaire des services publics locaux |
| 5 | `naviguer_themes` | Arborescence th\u00e9matique service-public.fr |
| 6 | `consulter_fiscalite_locale` | Taux d'imposition REI (CP, comparaison, tendances 4 ans) |
| 7 | `rechercher_doctrine_fiscale` | Doctrine BOFiP (8 983 articles) |
| 8 | `consulter_transactions_immobilieres` | DVF prix/m\u00b2, m\u00e9diane, r\u00e9partition (PLM inclus) |
| 9 | `simuler_taxe_fonciere` | Estimation TF = VLC estim\u00e9e \u00d7 50% \u00d7 taux REI r\u00e9el |
| 10 | `simuler_frais_notaire` | DMTO + \u00e9moluments d\u00e9gressifs + CSI + d\u00e9bours |
| 11 | `consulter_zonage_immobilier` | Zones ABC : Pinel, PTZ, plafonds loyers/ressources |
| 12 | `comparer_communes` | Tableau crois\u00e9 REI + DVF + zonage (2-5 communes) |

## Sprint 5 \u2014 Compl\u00e9t\u00e9 \u2705

| T\u00e2che | Description | Statut |
|-------|-------------|--------|
| T7 | Int\u00e9grer simulateur TF dans `rechercher.ts` (cat\u00e9gorie `simulation_tf`) | \u2705 |
| T8 | Mise \u00e0 jour README.md (12 outils, exemples, formules) | \u2705 |
| T9 | Nouveau tool `simuler_frais_notaire` | \u2705 |
| T10 | Nouveau tool `consulter_zonage_immobilier` | \u2705 |
| T11 | Nouveau tool `comparer_communes` | \u2705 |
| T12 | Tests unitaires vitest (simuler-taxe-fonciere, rechercher, frais-notaire) | \u2705 |
| T13 | Config build `wrangler.toml` (section `[build]`) | \u2705 |
| T14 | Monitoring `/health` enrichi (version, tools_count, last_error) | \u2705 |

## Sprint 6 \u2014 Roadmap

### Id\u00e9es pour la suite

- **T15** \u2014 Int\u00e9grer `simuler_frais_notaire` et `consulter_zonage_immobilier` dans le dispatch `rechercher.ts`
- **T16** \u2014 Taux DMTO par d\u00e9partement (source officielle data.economie.gouv.fr ou DGCL)
- **T17** \u2014 Enrichir `comparer_communes` avec les services publics locaux
- **T18** \u2014 Cache des r\u00e9sultats fr\u00e9quents (zones ABC, taux REI) avec Cloudflare KV ou Cache API
- **T19** \u2014 OpenAPI / JSON Schema pour documentation auto des outils
- **T20** \u2014 Dashboard web `/admin/dashboard` avec statistiques d'usage

## Contraintes techniques

- Cloudflare Workers : pas de fs, pas de streams Node, CPU time limit\u00e9 (paid plan)
- D1 batch max 100 statements
- Push GitHub via API : attention aux regex avec `\\n\\r` dans les strings JSON (utiliser des formes simples)
- Paris/Lyon/Marseille (PLM) : code INSEE unique \u2192 expansion en arrondissements pour DVF
- geo.api.gouv.fr : recherche accent-insensitive n\u00e9cessite des requ\u00eates s\u00e9par\u00e9es par terme

## Conventions

- 1 fichier = 1 outil, noms en kebab-case
- Fonctions courtes, noms explicites, commentaires pour le \"pourquoi\"
- DRY : r\u00e9utiliser `resolveCodePostal`, `resolveNomCommune`, `sanitize`, `formatEuro`
- Exporter les fonctions pures pour les tests unitaires
- R\u00e9sultats format\u00e9s en Markdown avec sources cit\u00e9es
- Disclaimers obligatoires pour les estimations
- Version bump \u00e0 chaque nouvel outil
- Tests dans `src/tools/__tests__/` pour les fonctions de calcul
