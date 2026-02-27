# mcp-service-public

![Version](https://img.shields.io/badge/version-0.8.1-blue)
![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)
![License](https://img.shields.io/badge/license-MIT-green)

Serveur MCP (Model Context Protocol) pour les données publiques françaises. Donne accès aux fiches pratiques service-public.fr, à la fiscalité locale, aux transactions immobilières DVF, à la doctrine fiscale BOFiP, au zonage ABC et aux simulateurs (taxe foncière, frais de notaire).

## URL publique

```
https://mcp-service-public.nhaultcoeur.workers.dev/mcp
```

## Les 12 outils MCP (v0.8.1)

| # | Outil | Source | Description |
|---|-------|--------|-------------|
| 1 | `rechercher` | Dispatch unifié | Route automatiquement vers la bonne source selon la requête |
| 2 | `rechercher_fiche` | DILA / service-public.fr | Recherche plein texte dans ~5 500 fiches pratiques |
| 3 | `lire_fiche` | DILA / service-public.fr | Lecture complète d'une fiche par identifiant (F14929, N360…) |
| 4 | `rechercher_service_local` | API Annuaire | Services publics locaux (mairie, préfecture, CAF…) |
| 5 | `naviguer_themes` | DILA / service-public.fr | Navigation dans l'arborescence thématique |
| 6 | `consulter_fiscalite_locale` | DGFiP REI | Taux d'imposition locale par commune (TFB, TEOM, CFE…) |
| 7 | `rechercher_doctrine_fiscale` | BOFiP | 8 983 articles de doctrine fiscale en vigueur |
| 8 | `consulter_transactions_immobilieres` | DVF / data.gouv.fr | Prix médians, prix/m², répartition par type de bien |
| 9 | `simuler_taxe_fonciere` | REI + DVF | Estimation TF = VLC estimée × 50 % × taux REI réel |
| 10 | `simuler_frais_notaire` | Barème réglementé | DMTO + émoluments dégressifs + CSI + débours |
| 11 | `consulter_zonage_immobilier` | data.gouv.fr | Zone ABC (Pinel, PTZ, plafonds loyers/ressources) |
| 12 | `comparer_communes` | REI + DVF + zonage | Tableau croisé de 2 à 5 communes |

## Exemples d'appels

### Recherche unifiée (dispatch automatique)
```json
{ "name": "rechercher", "arguments": { "query": "prix immobilier à Lyon" } }
{ "name": "rechercher", "arguments": { "query": "renouveler passeport" } }
{ "name": "rechercher", "arguments": { "query": "combien de taxe foncière pour un appartement de 60m² à Bordeaux" } }
```

### Simuler la taxe foncière
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

### Fiscalité locale
```json
{ "name": "consulter_fiscalite_locale", "arguments": { "code_postal": "93140" } }
{ "name": "consulter_fiscalite_locale", "arguments": { "communes": ["PARIS", "LYON", "MARSEILLE"] } }
```

### Transactions immobilières (DVF)
```json
{ "name": "consulter_transactions_immobilieres", "arguments": { "commune": "Bondy", "type_local": "Appartement" } }
```

## Comment ça marche

### Simulateur de taxe foncière

La formule d'estimation :

```
VLC estimée = Surface pondérée × Tarif ajusté × Coef. entretien
Base imposable = VLC × 50 %
TF estimée = Base imposable × Taux global TFB (REI)
```

- **Surface pondérée** : surface habitable + équivalences confort (chauffage, sanitaires)
- **Tarif ajusté** : tarif VLC national × ratio prix local DVF / prix national
- **Coef. entretien** : selon l'ancienneté du bien (0.90 à 1.15)
- **Taux TFB** : vrais taux votés par les collectivités (source REI DGFiP)

### Simulateur de frais de notaire

```
Frais = DMTO + Émoluments TTC + CSI + Débours
```

- **DMTO** : 5,81 % (ancien, taux normal) ou 6,32 % (taux majoré 2025) ; 0,71 % (neuf)
- **Émoluments** : barème dégressif réglementé (3,87 % → 0,799 % selon tranches) + TVA 20 %
- **CSI** : 0,10 % du prix (minimum 15 €)
- **Débours** : ~1 200 € (estimation)

## Utilisation

### Claude.ai (projet ou conversation)

Ajouter le serveur MCP dans les paramètres :
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
│   ├── fiches (~5 500 fiches pratiques)
│   ├── fiches_fts (index FTS5, tokenize unicode61)
│   ├── themes (304 thèmes hiérarchiques)
│   └── sync_log (historique des synchronisations)
├── Proxy API (temps réel)
│   ├── data.economie.gouv.fr → REI fiscalité locale + BOFiP
│   ├── data.gouv.fr → DVF transactions + Zonage ABC
│   ├── geo.api.gouv.fr → Résolution communes
│   └── API Annuaire → services publics locaux
└── Cron (0 6 * * *) → sync quotidienne DILA
```

### Sources de données

| Source | Type | Données |
|--------|------|---------|
| DILA (lecomarquage) | ZIP quotidien → D1 | Fiches pratiques, thèmes |
| API Annuaire | Proxy temps réel | Services publics locaux |
| data.economie.gouv.fr | Proxy temps réel | Fiscalité locale (REI), BOFiP doctrine |
| data.gouv.fr | Proxy temps réel | DVF transactions, Zonage ABC |
| geo.api.gouv.fr | Proxy temps réel | Résolution communes (CP/INSEE/nom) |

### Endpoints

| Méthode | Path | Description |
|---------|------|-------------|
| POST | `/mcp` | Endpoint MCP (JSON-RPC) |
| GET | `/health` | Santé du service, version, outils, dernière erreur |
| GET | `/` | Description du service |
| POST | `/admin/sync/full` | Sync complète DILA (auth requise) |
| GET | `/admin/sync` | Statut des dernières syncs (auth requise) |

## Développement

```powershell
npm install
npm run dev          # Serveur local
npm run test         # Tests unitaires (vitest)
npm run typecheck    # Vérification TypeScript
npm run deploy       # Déploiement Cloudflare
```

## Stack technique

- TypeScript / Cloudflare Workers
- D1 SQLite + FTS5
- Vitest (tests unitaires)
- fflate (décompression ZIP)
- fast-xml-parser (parsing XML DILA)
- APIs : Annuaire, data.economie.gouv.fr, data.gouv.fr, geo.api.gouv.fr

## Contribution

1. Fork le repo
2. Créer une branche (`git checkout -b feature/mon-outil`)
3. Suivre le pattern : 1 fichier = 1 outil dans `src/tools/`
4. Ajouter l'import + définition + case dans `src/index.ts`
5. Écrire les tests dans `src/tools/__tests__/`
6. Push sur `main` → auto-deploy
