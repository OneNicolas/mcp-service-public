# mcp-service-public — Instructions projet

## Contexte

Serveur MCP (Model Context Protocol) TypeScript sur Cloudflare Workers donnant accès aux données publiques françaises via des outils interrogeables par des assistants IA.

- **Repo** : `OneNicolas/mcp-service-public` (branche `main`)
- **Production** : `https://mcp-service-public.nhaultcoeur.workers.dev/mcp`
- **Version actuelle** : v0.7.0
- **CI/CD** : GitHub → Cloudflare Workers Builds (auto-deploy sur push `main`)
- **Local** : `C:\Users\nhaultcoeur\OneDrive - Scopi\Projets\mcp-service-public`

## Stack technique

- TypeScript, Cloudflare Workers (Streamable HTTP MCP)
- D1 SQLite (FTS5) pour les fiches DILA (~5 500 fiches, sync cron quotidien)
- APIs proxy : data.economie.gouv.fr (REI), data.gouv.fr (DVF Tabular), geo.api.gouv.fr, annuaire API
- Pas de framework MCP SDK — implémentation JSON-RPC directe

## Architecture

```
src/
├── index.ts              # Router MCP + tool definitions + dispatcher (VERSION ici)
├── types.ts              # Env, ToolResult, Fiche...
├── tools/                # 1 fichier = 1 outil, export async function
│   ├── rechercher.ts                       # T4 - Dispatch unifié intelligent
│   ├── rechercher-fiche.ts                 # FTS sur D1
│   ├── lire-fiche.ts                       # Lecture fiche par ID
│   ├── rechercher-service-local.ts         # Proxy annuaire
│   ├── naviguer-themes.ts                  # Arborescence thématique
│   ├── consulter-fiscalite-locale.ts       # Taux REI (CP, comparaison, tendances)
│   ├── rechercher-doctrine-fiscale.ts      # BOFiP
│   ├── consulter-transactions-immobilieres.ts  # DVF + PLM
│   └── simuler-taxe-fonciere.ts            # T6 - Simulateur TF hybride REI+DVF
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
4. Push sur `main` → auto-deploy

## Les 9 outils actuels (v0.7.0)

| # | Outil | Description |
|---|---|---|
| 1 | `rechercher` | Dispatch unifié (fiches, fiscalité, doctrine, DVF) |
| 2 | `rechercher_fiche` | Fiches pratiques service-public.fr (FTS D1) |
| 3 | `lire_fiche` | Lecture complète d'une fiche par ID |
| 4 | `rechercher_service_local` | Annuaire des services publics locaux |
| 5 | `naviguer_themes` | Arborescence thématique service-public.fr |
| 6 | `consulter_fiscalite_locale` | Taux d'imposition REI (CP, comparaison, tendances 4 ans) |
| 7 | `rechercher_doctrine_fiscale` | Doctrine BOFiP (8 983 articles) |
| 8 | `consulter_transactions_immobilieres` | DVF prix/m², médiane, répartition (PLM inclus) |
| 9 | `simuler_taxe_fonciere` | Estimation TF = VLC estimée × 50% × taux REI réel |

## Sprint 5 — Roadmap

### Priorité 1 — Améliorations outils existants

**T7 — Intégrer simulateur dans rechercher.ts**
- Ajouter une catégorie `simulation_tf` dans `classifyQuery()` de `rechercher.ts`
- Patterns : "combien de taxe foncière pour", "estimer ma taxe foncière", "simuler TF"
- Extraire commune + surface + type_bien de la requête en langage naturel
- Fallback vers `consulter_fiscalite_locale` si les paramètres sont insuffisants

**T8 — Mettre à jour README.md**
- Documenter les 9 outils avec exemples d'appel
- Ajouter section "Comment ça marche" (formule TF, sources de données)
- Badge version, lien prod, instructions contribution

### Priorité 2 — Nouveaux outils

**T9 — simuler_frais_notaire**
- Paramètres : prix d'achat, type (ancien/neuf), département
- Calcul : droits de mutation (5.81% ancien / 0.71% neuf selon département) + émoluments notaire (barème dégressif réglementé) + frais divers (~1 200€)
- Sources : barème légal des émoluments (arrêté du 26/02/2016), taux départementaux (data.economie.gouv.fr ou constantes)
- Réutiliser le pattern resolveCommune + rapport détaillé du simulateur TF

**T10 — consulter_zonage_immobilier**
- Zones A bis / A / B1 / B2 / C (Pinel, PTZ, APL, plafonds loyers)
- Source : fichier officiel zones communes (data.gouv.fr ou arrêté du 1er août 2014 actualisé)
- Paramètres : commune (nom/CP/INSEE)
- Retourne : zone, plafonds loyer/m², plafonds ressources, éligibilité Pinel/PTZ

**T11 — comparer_communes (tableau croisé)**
- Combine en un seul rapport : fiscalité REI + DVF prix/m² + services publics + zonage
- Paramètres : liste de 2-5 communes
- Cas d'usage : aide à la décision pour un déménagement ou investissement

### Priorité 3 — Infra / qualité

**T12 — Tests unitaires**
- Ajouter vitest (léger, compatible TS)
- Tests sur : calculs simulateur TF (getSurfacePonderee, getCoefEntretien, estimerPieces), classifyQuery du dispatch, sanitize, formatEuro
- Script npm `test` dans package.json

**T13 — Config build wrangler.toml**
- Ajouter section `[build]` pour fiabiliser le CI/CD Workers Builds
- Activer le cache du build dans le dashboard Cloudflare

**T14 — Monitoring**
- Endpoint `/health` enrichi : ajouter version déployée, nombre d'outils, dernière erreur
- Logs structurés pour les erreurs API (REI, DVF, geo.api)

## Contraintes techniques

- Cloudflare Workers : pas de fs, pas de streams Node, CPU time limité (paid plan)
- D1 batch max 100 statements
- Push GitHub via API : attention aux regex avec `\n\r` dans les strings JSON (utiliser des formes simples)
- Paris/Lyon/Marseille (PLM) : code INSEE unique → expansion en arrondissements pour DVF
- geo.api.gouv.fr : recherche accent-insensitive nécessite des requêtes séparées par terme

## Conventions

- 1 fichier = 1 outil, noms en kebab-case
- Fonctions courtes, noms explicites, commentaires pour le "pourquoi"
- DRY : réutiliser `resolveCodePostal`, `resolveNomCommune`, `sanitize`, `formatEuro`
- Résultats formatés en Markdown avec sources citées
- Disclaimers obligatoires pour les estimations
- Version bump à chaque nouvel outil
