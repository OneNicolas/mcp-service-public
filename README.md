# mcp-service-public

![Version](https://img.shields.io/badge/version-0.8.0-blue)
![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)
![License](https://img.shields.io/badge/license-MIT-green)

Serveur MCP (Model Context Protocol) pour les donn\u00e9es publiques fran\u00e7aises. Donne acc\u00e8s aux fiches pratiques service-public.fr, \u00e0 la fiscalit\u00e9 locale, aux transactions immobili\u00e8res DVF, \u00e0 la doctrine fiscale BOFiP, au zonage ABC et aux simulateurs (taxe fonci\u00e8re, frais de notaire).

## URL publique

```
https://mcp-service-public.nhaultcoeur.workers.dev/mcp
```

## Les 12 outils MCP (v0.8.0)

| # | Outil | Source | Description |
|---|-------|--------|-------------|
| 1 | `rechercher` | Dispatch unifi\u00e9 | Route automatiquement vers la bonne source selon la requ\u00eate |
| 2 | `rechercher_fiche` | DILA / service-public.fr | Recherche plein texte dans ~5 500 fiches pratiques |
| 3 | `lire_fiche` | DILA / service-public.fr | Lecture compl\u00e8te d'une fiche par identifiant (F14929, N360\u2026) |
| 4 | `rechercher_service_local` | API Annuaire | Services publics locaux (mairie, pr\u00e9fecture, CAF\u2026) |
| 5 | `naviguer_themes` | DILA / service-public.fr | Navigation dans l'arborescence th\u00e9matique |
| 6 | `consulter_fiscalite_locale` | DGFiP REI | Taux d'imposition locale par commune (TFB, TEOM, CFE\u2026) |
| 7 | `rechercher_doctrine_fiscale` | BOFiP | 8 983 articles de doctrine fiscale en vigueur |
| 8 | `consulter_transactions_immobilieres` | DVF / data.gouv.fr | Prix m\u00e9dians, prix/m\u00b2, r\u00e9partition par type de bien |
| 9 | `simuler_taxe_fonciere` | REI + DVF | Estimation TF = VLC estim\u00e9e \u00d7 50 % \u00d7 taux REI r\u00e9el |
| 10 | `simuler_frais_notaire` | Bar\u00e8me r\u00e9glement\u00e9 | DMTO + \u00e9moluments d\u00e9gressifs + CSI + d\u00e9bours |
| 11 | `consulter_zonage_immobilier` | data.gouv.fr | Zone ABC (Pinel, PTZ, plafonds loyers/ressources) |
| 12 | `comparer_communes` | REI + DVF + zonage | Tableau crois\u00e9 de 2 \u00e0 5 communes |

## Exemples d'appels

### Recherche unifi\u00e9e (dispatch automatique)
```json
{ "name": "rechercher", "arguments": { "query": "prix immobilier \u00e0 Lyon" } }
{ "name": "rechercher", "arguments": { "query": "renouveler passeport" } }
{ "name": "rechercher", "arguments": { "query": "combien de taxe fonci\u00e8re pour un appartement de 60m\u00b2 \u00e0 Bordeaux" } }
```

### Simuler la taxe fonci\u00e8re
```json
{ "name": "simuler_taxe_fonciere", "arguments": { "commune": "Lyon", "surface": 75, "type_bien": "Appartement" } }
```

### Simuler les frais de notaire
```json
{ "name": "simuler_frais_notaire", "arguments": { "prix": 250000, "type": "ancien" } }
```

### Consulter le zonage ABC
```json
{ "name": "consulter_zonage_immobilier", "arguments": { "commune": "Bordeaux" } }
```

### Comparer des communes
```json
{ "name": "comparer_communes", "arguments": { "communes": ["Lyon", "Bordeaux", "Nantes"] } }
```

### Fiscalit\u00e9 locale
```json
{ "name": "consulter_fiscalite_locale", "arguments": { "code_postal": "93140" } }
{ "name": "consulter_fiscalite_locale", "arguments": { "communes": ["PARIS", "LYON", "MARSEILLE"] } }
```

### Transactions immobili\u00e8res (DVF)
```json
{ "name": "consulter_transactions_immobilieres", "arguments": { "commune": "Bondy", "type_local": "Appartement" } }
```

## Comment \u00e7a marche

### Simulateur de taxe fonci\u00e8re

La formule d'estimation :

```
VLC estim\u00e9e = Surface pond\u00e9r\u00e9e \u00d7 Tarif ajust\u00e9 \u00d7 Coef. entretien
Base imposable = VLC \u00d7 50 %
TF estim\u00e9e = Base imposable \u00d7 Taux global TFB (REI)
```

- **Surface pond\u00e9r\u00e9e** : surface habitable + \u00e9quivalences confort (chauffage, sanitaires)
- **Tarif ajust\u00e9** : tarif VLC national \u00d7 ratio prix local DVF / prix national
- **Coef. entretien** : selon l'anciennet\u00e9 du bien (0.90 \u00e0 1.15)
- **Taux TFB** : vrais taux vot\u00e9s par les collectivit\u00e9s (source REI DGFiP)

### Simulateur de frais de notaire

```
Frais = DMTO + \u00c9moluments TTC + CSI + D\u00e9bours
```

- **DMTO** : 5,81 % (ancien, taux normal) ou 6,32 % (taux major\u00e9 2025) ; 0,71 % (neuf)
- **\u00c9moluments** : bar\u00e8me d\u00e9gressif r\u00e9glement\u00e9 (3,87 % \u2192 0,799 % selon tranches) + TVA 20 %
- **CSI** : 0,10 % du prix (minimum 15 \u20ac)
- **D\u00e9bours** : ~1 200 \u20ac (estimation)

## Utilisation

### Claude.ai (projet ou conversation)

Ajouter le serveur MCP dans les param\u00e8tres :
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

> N\u00e9cessite [mcp-remote](https://www.npmjs.com/package/mcp-remote) install\u00e9 globalement.

## Architecture

```
Cloudflare Workers (plan payant)
\u251c\u2500\u2500 Transport : Streamable HTTP (POST /mcp)
\u251c\u2500\u2500 D1 SQLite (fiches DILA)
\u2502   \u251c\u2500\u2500 fiches (~5 500 fiches pratiques)
\u2502   \u251c\u2500\u2500 fiches_fts (index FTS5, tokenize unicode61)
\u2502   \u251c\u2500\u2500 themes (304 th\u00e8mes hi\u00e9rarchiques)
\u2502   \u2514\u2500\u2500 sync_log (historique des synchronisations)
\u251c\u2500\u2500 Proxy API (temps r\u00e9el)
\u2502   \u251c\u2500\u2500 data.economie.gouv.fr \u2192 REI fiscalit\u00e9 locale + BOFiP
\u2502   \u251c\u2500\u2500 data.gouv.fr \u2192 DVF transactions + Zonage ABC
\u2502   \u251c\u2500\u2500 geo.api.gouv.fr \u2192 R\u00e9solution communes
\u2502   \u2514\u2500\u2500 API Annuaire \u2192 services publics locaux
\u2514\u2500\u2500 Cron (0 6 * * *) \u2192 sync quotidienne DILA
```

### Sources de donn\u00e9es

| Source | Type | Donn\u00e9es |
|--------|------|---------|
| DILA (lecomarquage) | ZIP quotidien \u2192 D1 | Fiches pratiques, th\u00e8mes |
| API Annuaire | Proxy temps r\u00e9el | Services publics locaux |
| data.economie.gouv.fr | Proxy temps r\u00e9el | Fiscalit\u00e9 locale (REI), BOFiP doctrine |
| data.gouv.fr | Proxy temps r\u00e9el | DVF transactions, Zonage ABC |
| geo.api.gouv.fr | Proxy temps r\u00e9el | R\u00e9solution communes (CP/INSEE/nom) |

### Endpoints

| M\u00e9thode | Path | Description |
|---------|------|-------------|
| POST | `/mcp` | Endpoint MCP (JSON-RPC) |
| GET | `/health` | Sant\u00e9 du service, version, outils, derni\u00e8re erreur |
| GET | `/` | Description du service |
| POST | `/admin/sync/full` | Sync compl\u00e8te DILA (auth requise) |
| GET | `/admin/sync` | Statut des derni\u00e8res syncs (auth requise) |

## D\u00e9veloppement

```powershell
npm install
npm run dev          # Serveur local
npm run test         # Tests unitaires (vitest)
npm run typecheck    # V\u00e9rification TypeScript
npm run deploy       # D\u00e9ploiement Cloudflare
```

## Stack technique

- TypeScript / Cloudflare Workers
- D1 SQLite + FTS5
- Vitest (tests unitaires)
- fflate (d\u00e9compression ZIP)
- fast-xml-parser (parsing XML DILA)
- APIs : Annuaire, data.economie.gouv.fr, data.gouv.fr, geo.api.gouv.fr

## Contribution

1. Fork le repo
2. Cr\u00e9er une branche (`git checkout -b feature/mon-outil`)
3. Suivre le pattern : 1 fichier = 1 outil dans `src/tools/`
4. Ajouter l'import + d\u00e9finition + case dans `src/index.ts`
5. \u00c9crire les tests dans `src/tools/__tests__/`
6. Push sur `main` \u2192 auto-deploy
