# mcp-service-public

MCP Server for French service-public.fr data — Fiches pratiques, Annuaire des administrations, Téléservices.

Hosted on Cloudflare Workers with Streamable HTTP transport.

## Tools

| Tool | Description |
|------|-------------|
| `rechercher_fiche` | Full-text search across 3,000+ fiches pratiques |
| `lire_fiche` | Read a specific fiche by ID (F14929, N360...) |
| `rechercher_service_local` | Find local public services (mairie, CAF, préfecture...) |
| `naviguer_themes` | Browse the thematic hierarchy |

## Data Sources

- **Fiches DILA** — XML archive updated daily from service-public.fr
- **API Annuaire** — REST API for local administration directory

## Setup

```bash
npm install
wrangler d1 create service-public-db
# Update database_id in wrangler.toml
npm run db:init
npm run dev
```

## Deploy

```bash
npm run db:init:remote
npm run deploy
```
