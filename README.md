# mcp-service-public

Serveur MCP (Model Context Protocol) pour les données de [service-public.fr](https://www.service-public.fr). Donne accès aux fiches pratiques sur les droits et démarches administratives françaises, à l'annuaire des administrations et à l'arborescence thématique.

## URL publique

```
https://mcp-service-public.nhaultcoeur.workers.dev/mcp
```

## Outils MCP disponibles

| Outil | Description |
|-------|-------------|
| `rechercher_fiche` | Recherche plein texte dans ~5500 fiches pratiques (droits, démarches) |
| `lire_fiche` | Lecture complète d'une fiche par son identifiant (F14929, N360…) |
| `rechercher_service_local` | Recherche de services publics locaux (mairie, préfecture, CAF…) via l'API Annuaire |
| `naviguer_themes` | Navigation dans l'arborescence thématique de service-public.fr |

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
├── D1 SQLite
│   ├── fiches (~5500 fiches pratiques DILA)
│   ├── fiches_fts (index FTS5, tokenize unicode61)
│   ├── themes (304 thèmes hiérarchiques)
│   └── sync_log (historique des synchronisations)
└── Cron (0 6 * * *) → sync quotidienne DILA
```

### Source de données

Les fiches proviennent de l'archive ZIP quotidienne de la DILA :
`https://lecomarquage.service-public.fr/vdd/3.4/part/zip/vosdroits-latest.zip`

La synchronisation télécharge le ZIP (~22 Mo), parse les ~5500 fichiers XML en streaming (fflate), et insère tout en base D1 par batchs de 100.

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
