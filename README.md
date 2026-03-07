# mcp-service-public

![Version](https://img.shields.io/badge/version-1.11.0-blue)
![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![Tools](https://img.shields.io/badge/MCP%20tools-30-blueviolet)
![Tests](https://img.shields.io/badge/tests-459%20passing-brightgreen)

Serveur MCP (Model Context Protocol) pour les donnees publiques francaises. Donne acces aux fiches pratiques service-public.fr, a la fiscalite locale, aux transactions immobilieres DVF, a la doctrine fiscale BOFiP, au zonage ABC, aux conventions collectives, a la recherche d'entreprises, a l'annuaire des etablissements scolaires, aux resultats des lycees (IVAL), aux evaluations nationales (6eme/CE2), aux formations Parcoursup, a l'acces aux soins (data.ameli.fr), a l'insertion professionnelle (InserJeunes), aux statistiques de securite/delinquance (SSMSI), aux risques naturels (Georisques), aux textes legaux Legifrance (lois, decrets, codes juridiques, jurisprudence), au Journal Officiel (JORF), aux statistiques d'aide sociale CAF (RSA/APL/AAH) et aux simulateurs (taxe fonciere, frais de notaire, impot sur le revenu).

## Installation

Serveur heberge — aucune installation requise. Connectez l'URL suivante a votre client MCP :

```
https://mcp-service-public.nhaultcoeur.workers.dev/mcp
```

### Claude.ai (web / mobile)

1. Ouvrir **Parametres** (icone engrenage)
2. Section **Integrations** > **MCP**
3. Cliquer **Ajouter une integration**
4. Coller l'URL ci-dessus
5. Les 23 outils apparaissent automatiquement

### Claude Desktop

Ajouter dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "service-public": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp-service-public.nhaultcoeur.workers.dev/mcp"]
    }
  }
}
```

Emplacement du fichier :
- **Windows** : `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS** : `~/Library/Application Support/Claude/claude_desktop_config.json`

Redemarrer Claude Desktop apres modification.

### VS Code / Cursor

Creer `.vscode/mcp.json` a la racine de votre projet :

```json
{
  "servers": {
    "service-public": {
      "type": "sse",
      "url": "https://mcp-service-public.nhaultcoeur.workers.dev/mcp"
    }
  }
}
```

### Autres clients MCP

Tout client compatible MCP Streamable HTTP peut se connecter avec l'URL ci-dessus. Consultez la documentation de votre client pour la configuration.

### Verification

Apres connexion, testez avec une requete simple :
```
Recherche : renouveler passeport
```

Si les 30 outils sont charges, le serveur est pret.

## Les 30 outils MCP (v1.11.0)

| # | Outil | Source | Description |
|---|-------|--------|-------------|
| 1 | `rechercher` | Dispatch unifie | Route automatiquement vers la bonne source selon la requete (23 categories) |
| 2 | `rechercher_fiche` | DILA / service-public.fr | Recherche plein texte dans ~5 500 fiches pratiques |
| 3 | `lire_fiche` | DILA / service-public.fr | Lecture complete d'une fiche par identifiant (F14929, N360...) |
| 4 | `rechercher_service_local` | API Annuaire | Services publics locaux (mairie, prefecture, CAF...) |
| 5 | `naviguer_themes` | DILA / service-public.fr | Navigation dans l'arborescence thematique |
| 6 | `consulter_fiscalite_locale` | DGFiP REI | Taux d'imposition locale par commune (TFB, TEOM, CFE...) |
| 7 | `rechercher_doctrine_fiscale` | BOFiP | 8 983 articles de doctrine fiscale en vigueur |
| 8 | `consulter_transactions_immobilieres` | DVF / data.gouv.fr | Prix medians, prix/m2, repartition par type de bien, evolution multi-annees |
| 9 | `simuler_taxe_fonciere` | REI + DVF | Estimation TF = VLC estimee x 50 % x taux REI reel |
| 10 | `simuler_frais_notaire` | Bareme reglemente | DMTO + emoluments degressifs + CSI + debours |
| 11 | `consulter_zonage_immobilier` | data.gouv.fr | Zone ABC (Pinel, PTZ, plafonds loyers/ressources) |
| 12 | `comparer_communes` | REI + DVF + zonage + Education + SSMSI + Georisques | Tableau croise de 2 a 5 communes (population, fiscalite, immobilier, education, sante, securite, risques naturels) |
| 13 | `simuler_impot_revenu` | Bareme IR 2025 | IR progressif, quotient familial, decote, CEHR, revenus fonciers/capitaux/BIC/BNC |
| 14 | `rechercher_convention_collective` | KALI / data.gouv.fr | Conventions collectives par IDCC ou mot-cle |
| 15 | `rechercher_entreprise` | DINUM + KALI | Fiche entreprise par SIRET/SIREN/nom + conventions applicables |
| 16 | `rechercher_etablissement_scolaire` | data.education.gouv.fr | Ecoles, colleges, lycees par commune (68 000+ etablissements) |
| 17 | `consulter_resultats_lycee` | DEPP / IVAL | Taux reussite bac, valeur ajoutee, acces 2nde-bac, mentions |
| 18 | `consulter_evaluations_nationales` | DEPP / data.education.gouv.fr | Scores 6eme + CE2 par departement, IPS, groupes de niveau, tendance |
| 19 | `consulter_parcoursup` | MESR / data.education.gouv.fr | Formations Parcoursup par mot-cle, ville, departement, filiere (14 000+ formations, selectivite, profil admis) |
| 20 | `consulter_acces_soins` | CNAM / data.ameli.fr | Acces aux soins par departement : effectifs/densite medecins, patientele MT, zones sous-dotees |
| 21 | `consulter_insertion_professionnelle` | DEPP-DARES / data.education.gouv.fr | Insertion pro InserJeunes : taux emploi 6/12/24 mois, poursuite etudes, VA par formation |
| 22 | `consulter_securite` | SSMSI / data.gouv.fr | Statistiques securite/delinquance departementales : cambriolages, vols, violences, taux/1000 hab. |
| 23 | `consulter_risques_naturels` | BRGM-MTE / georisques.gouv.fr | Risques naturels et technologiques par commune + arretes CatNat |
| 24 | `rechercher_texte_legal` | DILA / API PISTE Legifrance | Textes legislatifs et reglementaires (lois, decrets, arretes, ordonnances) |
| 25 | `rechercher_code_juridique` | DILA / API PISTE Legifrance | Articles dans les codes juridiques (Code civil, travail, penal, commerce...) |
| 26 | `rechercher_jurisprudence` | DILA / API PISTE Legifrance | Jurisprudence judiciaire (Cour de cassation, cours d'appel) |
| 27 | `consulter_journal_officiel` | DILA / API PISTE Legifrance | Recherche dans le Journal Officiel (JORF) : lois, decrets, arretes, ordonnances — filtre par type et plage de dates |
| 28 | `consulter_aide_sociale` | CNAF / data.caf.fr | Statistiques allocataires CAF par commune ou departement : RSA, APL/ALS/ALF, AAH, allocations familiales, prime d'activite... |
| 29 | `rechercher_marche_public` | DILA / boamp-datadila.opendatasoft.com | Avis marches publics BOAMP : appels d'offres, attributions, MAPA, DSP — filtre type/dept/acheteur/dates |
| 30 | `rechercher_annonce_legale` | DILA / bodacc-datadila.opendatasoft.com | Annonces legales BODACC : immatriculations, radiations, cessions, procedures collectives — filtre SIREN/nom/type/dept |

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

### Etablissements scolaires
```json
{ "name": "rechercher_etablissement_scolaire", "arguments": { "commune": "Lyon", "type": "lycee" } }
{ "name": "rechercher_etablissement_scolaire", "arguments": { "code_postal": "93140", "statut": "public" } }
{ "name": "rechercher_etablissement_scolaire", "arguments": { "nom": "Lacassagne" } }
```

### Resultats lycees (IVAL)
```json
{ "name": "consulter_resultats_lycee", "arguments": { "commune": "Lyon" } }
{ "name": "consulter_resultats_lycee", "arguments": { "nom_lycee": "Lacassagne", "type": "gt" } }
```

### Evaluations nationales (6eme / CE2)
```json
{ "name": "consulter_evaluations_nationales", "arguments": { "code_departement": "93" } }
{ "name": "consulter_evaluations_nationales", "arguments": { "commune": "Lyon", "niveau": "6eme" } }
{ "name": "consulter_evaluations_nationales", "arguments": { "code_postal": "93140", "niveau": "CE2" } }
```

### Formations Parcoursup
```json
{ "name": "consulter_parcoursup", "arguments": { "recherche": "informatique", "ville": "Lyon" } }
{ "name": "consulter_parcoursup", "arguments": { "filiere": "BTS", "recherche": "comptabilite" } }
{ "name": "consulter_parcoursup", "arguments": { "departement": "93", "filiere": "Licence" } }
```

### Acces aux soins
```json
{ "name": "consulter_acces_soins", "arguments": { "commune": "Bondy" } }
{ "name": "consulter_acces_soins", "arguments": { "code_departement": "93" } }
```

### Insertion professionnelle (InserJeunes)
```json
{ "name": "consulter_insertion_professionnelle", "arguments": { "ville": "Lyon", "limit": 5 } }
{ "name": "consulter_insertion_professionnelle", "arguments": { "uai": "0691723Y" } }
{ "name": "consulter_insertion_professionnelle", "arguments": { "recherche": "coiffure", "code_departement": "69" } }
```

### Securite et delinquance
```json
{ "name": "consulter_securite", "arguments": { "code_departement": "75" } }
{ "name": "consulter_securite", "arguments": { "commune": "Lyon" } }
```

### Risques naturels
```json
{ "name": "consulter_risques_naturels", "arguments": { "commune": "Nimes" } }
{ "name": "consulter_risques_naturels", "arguments": { "code_insee": "75056" } }
```

### Textes legaux (Legifrance)
```json
{ "name": "rechercher_texte_legal", "arguments": { "recherche": "protection donnees personnelles" } }
{ "name": "rechercher_texte_legal", "arguments": { "recherche": "teletravail", "champ": "TITLE" } }
```

### Codes juridiques (Legifrance)
```json
{ "name": "rechercher_code_juridique", "arguments": { "recherche": "contrat de travail", "code": "Code du travail" } }
{ "name": "rechercher_code_juridique", "arguments": { "recherche": "legitime defense", "code": "Code penal" } }
{ "name": "rechercher_code_juridique", "arguments": { "recherche": "1242", "code": "Code civil", "champ": "NUM_ARTICLE" } }
```

### Jurisprudence (Legifrance)
```json
{ "name": "rechercher_jurisprudence", "arguments": { "recherche": "licenciement abusif" } }
{ "name": "rechercher_jurisprudence", "arguments": { "recherche": "clause abusive", "juridiction": "Cour de cassation", "publie_bulletin": true } }
{ "name": "rechercher_jurisprudence", "arguments": { "recherche": "prejudice moral", "juridiction": "Cours d'appel" } }
```

### Journal Officiel (JORF)
```json
{ "name": "consulter_journal_officiel", "arguments": { "recherche": "teletravail" } }
{ "name": "consulter_journal_officiel", "arguments": { "recherche": "loi finances", "type_texte": "LOI", "date_debut": "2024-01-01", "date_fin": "2024-12-31" } }
{ "name": "consulter_journal_officiel", "arguments": { "recherche": "protection donnees", "type_texte": "DECRET", "limit": 10 } }
```

### Aide sociale — statistiques CAF
```json
{ "name": "consulter_aide_sociale", "arguments": { "commune": "Bondy" } }
{ "name": "consulter_aide_sociale", "arguments": { "code_departement": "93" } }
{ "name": "consulter_aide_sociale", "arguments": { "code_postal": "93140", "prestation": "RSA" } }
```

### Marches publics (BOAMP)
```json
{ "name": "rechercher_marche_public", "arguments": { "recherche": "travaux voirie", "departement": "35" } }
{ "name": "rechercher_marche_public", "arguments": { "type_avis": "AAC", "departement": "75" } }
{ "name": "rechercher_marche_public", "arguments": { "acheteur": "Departement du Rhone", "type_avis": "APC" } }
```

### Annonces legales (BODACC)
```json
{ "name": "rechercher_annonce_legale", "arguments": { "siren": "123456789" } }
{ "name": "rechercher_annonce_legale", "arguments": { "nom_entreprise": "SARL Martin" } }
{ "name": "rechercher_annonce_legale", "arguments": { "type_annonce": "procedure_collective", "departement": "69" } }
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
{ "name": "consulter_transactions_immobilieres", "arguments": { "commune": "Lyon", "evolution": true } }
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

### Etablissements scolaires

Proxy vers l'API Explore v2.1 de data.education.gouv.fr (Annuaire de l'education nationale, 68 000+ etablissements). Filtres : commune, code postal, type (ecole/college/lycee), statut (public/prive), nom. Retourne adresse, contact, voies d'enseignement, services (restauration, internat, ULIS, SEGPA), sections (europeenne, internationale, sport, arts).

### Resultats lycees (IVAL)

Proxy vers les datasets IVAL GT et Pro de la DEPP (data.education.gouv.fr). Requetes paralleles GT + Pro, tri par valeur ajoutee decroissante. Indicateurs : taux de reussite au bac, valeur ajoutee, taux d'acces 2nde-bac, taux de mentions, effectifs par niveau. Sessions 2012-2024.

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
|   +-- data.education.gouv.fr -> Annuaire etablissements + IVAL lycees + Evaluations nationales + Parcoursup + InserJeunes
|   +-- georisques.gouv.fr -> Risques naturels GASPAR + Arretes CatNat
|   +-- data.ameli.fr -> Acces aux soins (effectifs, densite, patientele MT)
|   +-- api.piste.gouv.fr -> Legifrance (textes legaux, codes juridiques, jurisprudence, JORF)
|   +-- data.caf.fr -> Statistiques CAF allocataires (RSA, APL, AAH, AF, prime d'activite)
|   +-- boamp-datadila.opendatasoft.com -> Marches publics BOAMP (appels d'offres, attributions, MAPA, DSP)
|   +-- bodacc-datadila.opendatasoft.com -> Annonces legales BODACC (immatriculations, radiations, cessions, procedures collectives)
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
| data.gouv.fr | Proxy temps reel | DVF transactions, Zonage ABC, KALI conventions collectives, SSMSI securite/delinquance |
| geo.api.gouv.fr | Proxy temps reel | Resolution communes (CP/INSEE/nom) |
| recherche-entreprises.api.gouv.fr | Proxy temps reel | Entreprises (SIRET/SIREN/nom, dirigeants, IDCC) |
| data.education.gouv.fr | Proxy temps reel | Annuaire etablissements scolaires, IVAL lycees, evaluations nationales 6eme/CE2, formations Parcoursup, insertion pro InserJeunes |
| georisques.gouv.fr | Proxy temps reel (API v1 GASPAR) | Risques naturels et technologiques par commune, arretes de catastrophe naturelle (CatNat) |
| data.ameli.fr | Proxy temps reel | Acces aux soins : effectifs/densite medecins, patientele MT, primo-installations, zones sous-dotees |
| api.piste.gouv.fr (DILA) | Proxy temps reel (OAuth2) | Legifrance : textes legaux (LODA), codes juridiques (CODE), jurisprudence (JURI/CAPP), Journal Officiel (JORF) |
| data.caf.fr (CNAF) | Proxy temps reel | Statistiques allocataires CAF par commune/departement : RSA, APL/ALS/ALF, AAH, AF, prime d'activite... |
| boamp-datadila.opendatasoft.com (DILA) | Proxy temps reel (Opendatasoft v2.1) | Marches publics BOAMP : appels d'offres, attributions, MAPA, DSP — mise a jour quotidienne |
| bodacc-datadila.opendatasoft.com (DILA) | Proxy temps reel (Opendatasoft v2.1) | Annonces legales BODACC : immatriculations, radiations, cessions, procedures collectives |

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
npx vitest run       # Tests unitaires (459 tests)
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
