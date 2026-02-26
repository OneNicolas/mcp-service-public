# mcp-service-public

Serveur MCP (Model Context Protocol) pour les données de [service-public.fr](https://www.service-public.fr) et la fiscalité française. Donne accès aux fiches pratiques sur les droits et démarches administratives, à l'annuaire des administrations, à la fiscalité locale par commune et à la doctrine fiscale officielle (BOFiP).

## URL publique

```
https://mcp-service-public.nhaultcoeur.workers.dev/mcp
```

## Outils MCP disponibles

| Outil | Source | Description |
|-------|--------|-------------|
| `rechercher_fiche` | DILA / service-public.fr | Recherche plein texte dans ~5500 fiches pratiques (droits, démarches) |
| `lire_fiche` | DILA / service-public.fr | Lecture complète d'une fiche par son identifiant (F14929, N360…) |
| `rechercher_service_local` | API Annuaire | Recherche de services publics locaux (mairie, préfecture, CAF…) |
| `naviguer_themes` | DILA / service-public.fr | Navigation dans l'arborescence thématique |
| `consulter_fiscalite_locale` | DGFiP / data.economie.gouv.fr | Taux d'imposition locale par commune (TFB, TFNB, TH, TEOM, CFE) |
| `rechercher_doctrine_fiscale` | BOFiP / data.economie.gouv.fr | Recherche dans 8983 articles de doctrine fiscale en vigueur |

## Utilisation

### Claude.ai (projet ou conversation)

Ajouter le serveur MCP dans les paramètres du projet ou de la conversation :
- URL : `https://mcp-service-public.nhaultcoeur.workers.dev/mcp`
- Transport : Streamable HTTP

### Claude Desktop

Dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "service-public": {
      "command": "mcp-remote",
      "args": ["https://mcp-service-public.nhaultcoeur.workers.dev/mcp"]
    }
  }
}
```

> Nécessite [mcp-remote](https://www.npmjs.com/package/mcp-remote) installé globalement.

## Architecture

```
Cloudflare Workers (plan payant)
├── Transport : Streamable HTTP (POST /mcp)
├── D1 SQLite (fiches DILA)
│   ├── fiches (~5500 fiches pratiques)
│   ├── fiches_fts (index FTS5, tokenize unicode61)
│   ├── themes (304 thèmes hiérarchiques)
│   └── sync_log (historique des synchronisations)
├── Proxy API (temps réel, pas de stockage)
│   ├── data.economie.gouv.fr → fiscalité locale REI
│   ├── data.economie.gouv.fr → BOFiP doctrine
│   └── API Annuaire → services publics locaux
└── Cron (0 6 * * *) → sync quotidienne DILA
```

### Sources de données

| Source | Type | Données |
|--------|------|---------|
| DILA (lecomarquage) | ZIP quotidien → D1 | Fiches pratiques, thèmes |
| API Annuaire | Proxy temps réel | Services publics locaux |
| data.economie.gouv.fr | Proxy temps réel | Fiscalité locale (REI), 139 794 enregistrements |
| data.economie.gouv.fr | Proxy temps réel | BOFiP doctrine, 8 983 articles |

### Endpoints

| Méthode | Path | Description |
|---------|------|-------------|
| POST | `/mcp` | Endpoint MCP (JSON-RPC) |
| GET | `/health` | Santé du service + date dernier sync |
| GET | `/` | Description du service |
| POST | `/admin/sync/full` | Déclenche une sync complète (auth requise) |
| GET | `/admin/sync` | Statut des dernières syncs (auth requise) |

## Développement

```powershell
npm install
npm run dev          # Serveur local
npm run deploy       # Déploiement Cloudflare
npm run db:init      # Init DB locale
npm run db:init:remote  # Init DB production
```

## Stack technique

- TypeScript / Cloudflare Workers
- D1 SQLite + FTS5
- fflate (décompression ZIP streaming)
- fast-xml-parser (parsing XML DILA)
- API Annuaire de l'administration
- API data.economie.gouv.fr (Opendatasoft)
