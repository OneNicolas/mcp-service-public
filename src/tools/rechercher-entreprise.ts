import type { ToolResult } from "../types.js";
import { rechercherConventionCollective } from "./rechercher-convention-collective.js";

/**
 * Recherche d'entreprise par SIRET/SIREN/nom via recherche-entreprises.api.gouv.fr
 * Retourne les infos entreprise + convention(s) collective(s) applicable(s)
 */

const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";

interface RechercherEntrepriseArgs {
  siret?: string;
  siren?: string;
  nom?: string;
}

interface Siege {
  siret: string;
  activite_principale: string;
  libelle_commune: string;
  code_postal: string;
  adresse: string;
  liste_idcc: string[] | null;
  tranche_effectif_salarie: string;
  etat_administratif: string;
}

interface Entreprise {
  siren: string;
  nom_complet: string;
  nom_raison_sociale: string;
  sigle: string | null;
  nature_juridique: string;
  activite_principale: string;
  section_activite_principale: string;
  tranche_effectif_salarie: string;
  annee_tranche_effectif_salarie: string;
  etat_administratif: string;
  date_creation: string;
  date_fermeture: string | null;
  categorie_entreprise: string;
  siege: Siege;
  dirigeants: Array<{
    nom?: string;
    prenoms?: string;
    denomination?: string;
    qualite: string;
    type_dirigeant: string;
  }>;
  nombre_etablissements: number;
  nombre_etablissements_ouverts: number;
}

interface SearchResponse {
  results: Entreprise[];
  total_results: number;
}

/** Normalise un SIRET/SIREN (supprime espaces) */
function cleanSiretSiren(val: string): string {
  return val.replace(/[\s.]/g, "");
}

/** Valide un SIRET (14 chiffres) */
export function isValidSiret(val: string): boolean {
  return /^\d{14}$/.test(cleanSiretSiren(val));
}

/** Valide un SIREN (9 chiffres) */
export function isValidSiren(val: string): boolean {
  return /^\d{9}$/.test(cleanSiretSiren(val));
}

/** Formate la tranche effectif en texte lisible */
function formatEffectif(code: string): string {
  const map: Record<string, string> = {
    "00": "0 salarie",
    "01": "1 ou 2 salaries",
    "02": "3 a 5 salaries",
    "03": "6 a 9 salaries",
    "11": "10 a 19 salaries",
    "12": "20 a 49 salaries",
    "21": "50 a 99 salaries",
    "22": "100 a 199 salaries",
    "31": "200 a 249 salaries",
    "32": "250 a 499 salaries",
    "41": "500 a 999 salaries",
    "42": "1 000 a 1 999 salaries",
    "51": "2 000 a 4 999 salaries",
    "52": "5 000 a 9 999 salaries",
    "53": "10 000 salaries et plus",
  };
  return map[code] ?? code;
}

/** Formate la nature juridique (code INSEE) */
function formatNatureJuridique(code: string): string {
  const prefix = code.substring(0, 2);
  const map: Record<string, string> = {
    "10": "Entrepreneur individuel",
    "21": "Indivision",
    "22": "Societe creee de fait",
    "23": "Societe en participation",
    "27": "Paroisse hors zone concordataire",
    "29": "Groupement de droit prive non dote de la personnalite morale",
    "31": "Personne morale de droit etranger (immatriculee au RCS)",
    "32": "Personne morale de droit etranger (non immatriculee au RCS)",
    "41": "Etablissement public national a caractere industriel ou commercial",
    "51": "Societe cooperative commerciale particuliere",
    "52": "Societe en nom collectif",
    "53": "Societe en commandite",
    "54": "Societe a responsabilite limitee (SARL)",
    "55": "Societe anonyme (SA) a conseil d'administration",
    "56": "Societe anonyme (SA) a directoire",
    "57": "Societe par actions simplifiee (SAS)",
    "58": "Societe europeenne",
    "61": "Caisse d'epargne et de prevoyance",
    "65": "Societe de courtage d'assurances",
    "71": "Administration de l'Etat",
    "73": "Departement",
    "74": "Commune et commune nouvelle",
    "92": "Association loi 1901 ou assimile",
  };
  return map[prefix] ?? `Code ${code}`;
}

/** Recherche d'entreprise et conventions collectives associees */
export async function rechercherEntreprise(
  args: RechercherEntrepriseArgs,
): Promise<ToolResult> {
  const { siret, siren, nom } = args;

  if (!siret && !siren && !nom) {
    return {
      content: [{ type: "text", text: "Veuillez fournir un SIRET, un SIREN ou un nom d'entreprise." }],
      isError: true,
    };
  }

  // Construire la query de recherche
  let queryParam: string;

  if (siret) {
    const clean = cleanSiretSiren(siret);
    if (!isValidSiret(clean)) {
      return {
        content: [{ type: "text", text: `SIRET invalide : "${siret}". Un SIRET comporte 14 chiffres.` }],
        isError: true,
      };
    }
    queryParam = clean;
  } else if (siren) {
    const clean = cleanSiretSiren(siren);
    if (!isValidSiren(clean)) {
      return {
        content: [{ type: "text", text: `SIREN invalide : "${siren}". Un SIREN comporte 9 chiffres.` }],
        isError: true,
      };
    }
    queryParam = clean;
  } else {
    queryParam = nom!;
  }

  try {
    const url = `${API_BASE}?q=${encodeURIComponent(queryParam)}&page=1&per_page=5`;
    const response = await fetch(url);

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Erreur API recherche-entreprises : ${response.status} ${response.statusText}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as SearchResponse;

    if (!data.results?.length) {
      return {
        content: [{ type: "text", text: `Aucune entreprise trouvee pour "${queryParam}".` }],
      };
    }

    // Si recherche par SIRET/SIREN, prendre le premier resultat
    // Si recherche par nom, lister les resultats
    const isByIdentifier = !!(siret || siren);
    const entreprises = isByIdentifier ? [data.results[0]] : data.results;

    const sections: string[] = [];

    for (const e of entreprises) {
      const idccs = e.siege.liste_idcc ?? [];
      const etat = e.etat_administratif === "A" ? "Active" : "Fermee";

      const lines = [
        `## ${e.nom_complet}`,
        `- **SIREN** : ${e.siren}`,
        `- **SIRET siege** : ${e.siege.siret}`,
        `- **Forme juridique** : ${formatNatureJuridique(e.nature_juridique)}`,
        `- **Activite (NAF)** : ${e.activite_principale}`,
        `- **Adresse** : ${e.siege.adresse}`,
        `- **Effectif** : ${formatEffectif(e.tranche_effectif_salarie)} (${e.annee_tranche_effectif_salarie || "N/A"})`,
        `- **Categorie** : ${e.categorie_entreprise || "N/A"}`,
        `- **Etat** : ${etat}`,
        `- **Creation** : ${e.date_creation || "N/A"}`,
        `- **Etablissements** : ${e.nombre_etablissements_ouverts} ouvert(s) / ${e.nombre_etablissements} total`,
      ];

      // Dirigeants (max 3)
      if (e.dirigeants?.length) {
        const dirs = e.dirigeants.slice(0, 3).map((d) => {
          const name = d.type_dirigeant === "personne physique"
            ? `${d.prenoms ?? ""} ${d.nom ?? ""}`.trim()
            : d.denomination ?? "";
          return `  - ${name} (${d.qualite})`;
        });
        lines.push(`- **Dirigeant(s)** :`);
        lines.push(...dirs);
      }

      // Convention(s) collective(s)
      if (idccs.length > 0) {
        lines.push(`- **Convention(s) collective(s)** : IDCC ${idccs.join(", IDCC ")}`);
      } else {
        lines.push(`- **Convention collective** : non renseignee`);
      }

      sections.push(lines.join("\n"));
    }

    // Enrichissement KALI pour les IDCC trouves (seulement en recherche par identifiant)
    let kaliEnrichment = "";
    if (isByIdentifier) {
      const idccs = entreprises[0].siege.liste_idcc ?? [];
      if (idccs.length > 0) {
        const kaliResults = await Promise.all(
          idccs.map((idcc) => rechercherConventionCollective({ idcc, limit: 1 })),
        );
        const kaliTexts = kaliResults
          .filter((r) => !r.isError)
          .map((r) => r.content[0].text);
        if (kaliTexts.length > 0) {
          kaliEnrichment = "\n\n---\n### Detail convention(s) (KALI)\n\n" + kaliTexts.join("\n\n");
        }
      }
    }

    const header = isByIdentifier
      ? `# Fiche entreprise`
      : `# ${data.total_results} resultat(s) pour "${nom}"`;

    const text = [
      header,
      "",
      sections.join("\n\n---\n\n"),
      kaliEnrichment,
      "",
      "---",
      "*Source : API Recherche d'entreprises (DINUM) + KALI (DILA)*",
    ].join("\n");

    return { content: [{ type: "text", text }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}
