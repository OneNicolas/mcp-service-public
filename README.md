# mcp-service-public

![Version](https://img.shields.io/badge/version-1.2.1-blue)
![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![Tools](https://img.shields.io/badge/MCP%20tools-15-blueviolet)
![Tests](https://img.shields.io/badge/tests-187%20passing-brightgreen)

Serveur MCP (Model Context Protocol) pour les donnees publiques francaises. Donne acces aux fiches pratiques service-public.fr, a la fiscalite locale, aux transactions immobilieres DVF, a la doctrine fiscale BOFiP, au zonage ABC, aux conventions collectives, a la recherche d'entreprises et aux simulateurs (taxe fonciere, frais de notaire, impot sur le revenu).

## Connexion rapide

```
https://mcp-service-public.nhaultcoeur.workers.dev/mcp
```

| Client | Configuration |
|--------|-------------|
| **Claude.ai** | Parametres > MCP > Ajouter URL ci-dessus (Streamable HTTP) |
| **Claude Desktop** | `"command": "npx", "args": ["-y", "mcp-remote", "https://mcp-service-public.nhaultcoeur.workers.dev/mcp"]` |
| **VS Code / Cursor** | `.vscode/mcp.json` avec URL ci-dessus |

## Les 15 outils MCP (v1.2.1)

| # | Outil | Source | Description |
|---|-------|--------|-------------|
| 1 | `rechercher` | Dispatch unifie | Route automatiquement vers la bonne source selon la requete |
| 2 | `rechercher_fiche` | DILA / service-public.fr | Recherche plein texte dans ~5 500 fiches pratiques |
| 3 | `lire_fiche` | DILA / service-public.fr | Lecture complete d'une fiche par identifiant (F14929, N360...) |
| 4 | `rechercher_service_local` | API Annuaire | Services publics locaux (mairie, prefecture, CAF...) |
| 5 | `naviguer_themes` | DILA / service-public.fr | Navigation dans l'arborescence thematique |
| 6 | `consulter_fiscalite_locale` | DGFiP REI | Taux d'imposition locale par commune (TFB, TEOM, CFE...) |
| 7 | `rechercher_doctrine_fiscale` | BOFiP | 8 983 articles de doctrine fiscale en vigueur |
| 8 | `consulter_transactions_immobilieres` | DVF / data.gouv.fr | Prix medians, prix/m2, repartition par type de bien |
| 9 | `simuler_taxe_fonciere` | REI + DVF | Estimation TF = VLC estimee x 50 % x taux REI reel |
| 10 | `simuler_frais_notaire` | Bareme reglemente | DMTO + emoluments degressifs + CSI + debours |
| 11 | `consulter_zonage_immobilier` | data.gouv.fr | Zone ABC (Pinel, PTZ, plafonds loyers/ressources) |
| 12 | `comparer_communes` | REI + DVF + zonage | Tableau croise de 2 a 5 communes |
| 13 | `simuler_impot_revenu` | Bareme IR 2025 | IR progressif, quotient familial, decote, CEHR, revenus fonciers/capitaux/BIC/BNC |
| 14 | `rechercher_convention_collective` | KALI / data.gouv.fr | Conventions collectives par IDCC ou mot-cle |
| 15 | `rechercher_entreprise` | DINUM + KALI | Fiche entreprise par SIRET/SIREN/nom + conventions applicables |

## Exemples d'appels

### Recherche unifiee (dispatch automatique)
```json
{ "name": "rechercher", "arguments": { "query": "prix immobilier a Lyon" } }
{ "name": "rechercher", "arguments": { "query": "renouveler passeport" } }
{ "name": "rechercher", "arguments": { "query": "93140 taxe fonciere" } }
{ "name": "rechercher", "arguments": { "query": "SIRET 41816609600069" } }
```

### Recherche d'entreprise
```json
{ "name": "rechercher_entreprise", "arguments": { "siret": "41816609600069" } }
{ "name": "rechercher_entreprise", "arguments": { "nom": "OCTO Technology" } }
```

### Simuler la taxe fonciere
```json
{ "name": "simuler_taxe_fonciere", "arguments": { "commune": "Lyon", "surface": 75, "type_bien": "Appartement" } }
```

### Simuler les frais de notaire
```json
{ "name": "simuler_frais_notaire", "arguments": { "prix": 250000, "type": "ancien", "departement": "75" } }
```

### Simuler l'impot sur le revenu
```json
{ "name": "simuler_impot_revenu", "arguments": { "revenu_net_imposable": 42000 } }
{ "name": "simuler_impot_revenu", "arguments": { "revenu_net_imposable": 80000, "situation": "marie", "nb_enfants": 2 } }
{ "name": "simuler_impot_revenu", "arguments": { "revenu_net_imposable": 50000, "revenus_fonciers": 12000, "regime_foncier": "micro" } }
```

### Conventions collectives
```json
{ "name": "rechercher_convention_collective", "arguments": { "query": "boulangerie" } }
{ "name": "rechercher_convention_collective", "arguments": { "idcc": "3248" } }
```

### Consulter le zonage ABC
```json
{ "name": "consulter_zonage_immobilier", "arguments": { "commune": "Bordeaux" } }
```

### Comparer des communes
```json
{ "name": "comparer_communes", "arguments": { "communes": ["Lyon", "Bordeaux", "Nantes"] } }
```

### Fiscalite locale
```json
{ "name": "consulter_fiscalite_locale", "arguments": { "code_postal": "93140" } }
{ "name": "consulter_fiscalite_locale", "arguments": { "communes": ["PARIS", "LYON", "MARSEILLE"] } }
```

### Transactions immobilieres (DVF)
```json
{ "name": "consulter_transactions_immobilieres", "arguments": { "commune": "Bondy", "type_local": "Appartement" } }
```

## Comment ca marche

### Simulateur de taxe fonciere

```
VLC estimee = Surface ponderee x Tarif ajuste x Coef. entretien
Base imposable = VLC x 50 %
TF estimee = Base imposable x Taux global TFB (REI)
```

- **Surface ponderee** : surface habitable + equivalences confort
- **Tarif ajuste** : tarif VLC national x ratio prix local DVF / prix national
- **Coef. entretien** : selon l'anciennete du bien (0.90 a 1.15)
- **Taux TFB** : vrais taux votes par les collectivites (source REI DGFiP)

### Simulateur de frais de notaire

```
Frais = DMTO + Emoluments TTC + CSI + Debours
```

- **DMTO** : 5,81 % (ancien, taux normal) ou 6,32 % (taux majore 2025) ; 0,71 % (neuf)
- **Emoluments** : bareme degressif reglemente (3,87 % -> 0,799 %) + TVA 20 %
- **CSI** : 0,10 % du prix (minimum 15 EUR)
- **Debours** : ~1 200 EUR (estimation)

### Simulateur d'impot sur le revenu

```
Quotient familial = Revenu net imposable / Nombre de parts
IR brut = Bareme progressif applique au QF x Nombre de parts
IR net = IR brut - Decote (si applicable) + CEHR (si > 250k/500k)
```

Bareme 2025 (revenus 2024) : 0 % / 11 % / 30 % / 41 % / 45 %

Revenus complementaires supportes : fonciers (micro/reel), capitaux mobiliers (PFU/bareme), micro-BIC (50 %), micro-BNC (34 %).

### Recherche d'entreprise

Recherche via l'API Recherche d'entreprises (DINUM) par SIRET, SIREN ou nom. Retourne forme juridique, NAF, effectif, dirigeants, adresse, et chaine vers KALI pour les conventions collectives applicables.

## Architecture

```
Cloudflare Workers (plan payant)
+-- Transport : Streamable HTTP (POST /mcp)
+-- D1 SQLite (fiches DILA)
|   +-- fiches (~5 500 fiches pratiques)
|   +-- fiches_fts (index FTS5, tokenize unicode61)
|   +-- themes (304 themes hierarchiques)
|   +-- sync_log (historique des synchronisations)
|   +-- tool_stats (statistiques d'usage)
+-- Proxy API (temps reel, cache + retry)
|   +-- data.economie.gouv.fr -> REI fiscalite locale + BOFiP
|   +-- data.gouv.fr -> DVF transactions + Zonage ABC + KALI conventions
|   +-- geo.api.gouv.fr -> Resolution communes
|   +-- recherche-entreprises.api.gouv.fr -> Fiche entreprise
|   +-- API Annuaire -> services publics locaux
+-- Cron (0 6 * * *) -> sync quotidienne DILA
```

### Sources de donnees

| Source | Type | Donnees |
|--------|------|---------|
| DILA (lecomarquage) | ZIP quotidien -> D1 | Fiches pratiques, themes |
| API Annuaire | Proxy temps reel | Services publics locaux |
| data.economie.gouv.fr | Proxy temps reel | Fiscalite locale (REI), BOFiP doctrine |
| data.gouv.fr | Proxy temps reel | DVF transactions, Zonage ABC, KALI conventions collectives |
| geo.api.gouv.fr | Proxy temps reel | Resolution communes (CP/INSEE/nom) |
| recherche-entreprises.api.gouv.fr | Proxy temps reel | Entreprises (SIRET/SIREN/nom, dirigeants, IDCC) |

### Endpoints

| Methode | Path | Description |
|---------|------|-------------|
| POST | `/mcp` | Endpoint MCP (JSON-RPC) |
| GET | `/health` | Sante du service, version, outils, derniere erreur |
| GET | `/` | Description du service |
| GET | `/openapi.json` | Specification OpenAPI 3.1 (public, genere dynamiquement) |
| GET | `/admin/dashboard` | Dashboard HTML avec statistiques (auth requise) |
| GET | `/admin/dashboard/api` | API JSON du dashboard (auth requise) |
| POST | `/admin/sync/full` | Sync complete DILA (auth requise) |
| GET | `/admin/sync` | Statut des dernieres syncs (auth requise) |

## Developpement

```powershell
npm install
npm run dev          # Serveur local
npx vitest run       # Tests unitaires (187 tests)
npm run typecheck    # Verification TypeScript (0 erreurs)
npm run deploy       # Deploiement Cloudflare
```

## Stack technique

- TypeScript / Cloudflare Workers
- D1 SQLite + FTS5
- Vitest (tests unitaires)
- fflate (decompression ZIP)
- fast-xml-parser (parsing XML DILA)
- APIs : Annuaire, data.economie.gouv.fr, data.gouv.fr, geo.api.gouv.fr, recherche-entreprises.api.gouv.fr

## Licence

MIT

## Contribution

1. Fork le repo
2. Creer une branche (`git checkout -b feature/mon-outil`)
3. Suivre le pattern : 1 fichier = 1 outil dans `src/tools/`
4. Ajouter l'import + definition + case dans `src/index.ts`
5. Ecrire les tests dans `src/tools/__tests__/`
6. Push sur `main` -> auto-deploy
