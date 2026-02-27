# Sprint 6 — Suite : T18 Cache + Fix Unicode

## Contexte projet

Serveur MCP TypeScript sur Cloudflare Workers — 12 outils pour les données publiques françaises.

- **Repo** : `OneNicolas/mcp-service-public` (branche `main`)
- **Production** : `https://mcp-service-public.nhaultcoeur.workers.dev/mcp`
- **Version** : v0.8.1
- **Fichier d'instructions** : `INSTRUCTIONS.md` à la racine du repo

## État Sprint 6

| Tâche | Statut |
|-------|--------|
| T15 — Dispatch `rechercher` → frais notaire + zonage | ✅ |
| T16 — Taux DMTO par département (map statique 101 dept) | ✅ |
| T17 — Services publics dans `comparer_communes` | ✅ |
| T18 — Cache Cloudflare pour résultats fréquents | ⏳ À faire |

## 🔴 Bug prioritaire : Unicode escapes dans 9 fichiers

Des séquences `\u00e9`, `\u00e0`, `\u00e8` etc. apparaissent en clair dans le code source au lieu des vrais caractères UTF-8 (`é`, `à`, `è`). Ça ne casse pas le runtime TypeScript (qui interprète les escapes) mais ça rend les fichiers illisibles sur GitHub.

### Fichiers à corriger (remplacer les `\uXXXX` par les vrais caractères)

| Fichier | Escapes |
|---------|---------|
| `README.md` | 151 |
| `src/index.ts` | 108 |
| `src/tools/rechercher.ts` | 112 |
| `src/tools/simuler-taxe-fonciere.ts` | 81 |
| `src/tools/consulter-zonage-immobilier.ts` | 42 |
| `src/tools/comparer-communes.ts` | 16 |
| `src/tools/simuler-frais-notaire.ts` | 14 |
| `src/tools/__tests__/simuler-taxe-fonciere.test.ts` | 19 |
| `src/tools/__tests__/rechercher.test.ts` | 3 |

### ⚠️ Attention pour le fix

- Lire chaque fichier via `github:get_file_contents`, décoder le contenu, remplacer toutes les séquences `\uXXXX` par les vrais caractères UTF-8
- **NE PAS toucher** aux emojis volontaires dans le code (ex: `\ud83c\udfe0` = 🏠, `\ud83d\udcca` = 📊) — ceux-ci sont des surrogate pairs dans les strings JS et sont voulus
- Faire un seul commit `github:push_files` avec les 9 fichiers corrigés
- Le README.md doit aussi passer en v0.8.1

## T18 — Cache Cloudflare (après le fix Unicode)

### Objectif
Créer un helper `cachedFetch()` utilisant la Cache API de Cloudflare Workers pour éviter de re-requêter les APIs externes sur des données stables.

### Implémentation
- Créer `src/utils/cache.ts` avec `cachedFetch(url: string, ttl: number): Promise<Response>`
- Intégrer dans `fetchZonage()` de `consulter-zonage-immobilier.ts` (TTL 7 jours — les zones ABC changent rarement)
- Intégrer dans `fetchREI()` de `consulter-fiscalite-locale.ts` (TTL 24h)
- Ajouter un header `X-Cache: HIT` ou `X-Cache: MISS` pour le monitoring
- Attention : la Cache API Workers utilise `caches.default` (pas `caches.open()`)

### Tests de validation
```bash
# Vérifier le header X-Cache
curl -s -X POST https://mcp-service-public.nhaultcoeur.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"consulter_zonage_immobilier","arguments":{"commune":"Lyon"}}}'
```

## Workflow

1. Fix Unicode (9 fichiers) + bump README v0.8.1 → un seul commit
2. Vérifier le déploiement
3. Implémenter T18 cache → commit séparé + bump v0.8.2
4. Mettre à jour INSTRUCTIONS.md (marquer T18 ✅, ajouter `src/utils/cache.ts` à l'archi)
