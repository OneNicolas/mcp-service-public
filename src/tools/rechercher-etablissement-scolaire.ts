import type { ToolResult } from "../types.js";
import { resolveCodePostal, resolveNomCommune } from "../utils/geo-api.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const EDUCATION_API = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets";
const DATASET_ANNUAIRE = "fr-en-annuaire-education";

/** Types d'etablissement normalises vers les valeurs API */
const TYPE_MAP: Record<string, string> = {
  ecole: "Ecole",
  école: "Ecole",
  maternelle: "Ecole",
  elementaire: "Ecole",
  primaire: "Ecole",
  college: "Collège",
  collège: "Collège",
  lycee: "Lycée",
  lycée: "Lycée",
  erea: "EREA",
};

interface RechercherEtablissementArgs {
  commune?: string;
  code_postal?: string;
  code_insee?: string;
  type?: string;
  statut?: "public" | "prive";
  nom?: string;
  limit?: number;
}

interface AnnuaireRecord {
  identifiant_de_l_etablissement?: string;
  nom_etablissement?: string;
  type_etablissement?: string;
  statut_public_prive?: string;
  adresse_1?: string;
  adresse_2?: string;
  code_postal?: string;
  code_commune?: string;
  nom_commune?: string;
  code_departement?: string;
  libelle_departement?: string;
  telephone?: string;
  mail?: string;
  web?: string;
  restauration?: number;
  hebergement?: number;
  ulis?: number;
  segpa?: string;
  apprentissage?: string;
  section_arts?: string;
  section_cinema?: string;
  section_theatre?: string;
  section_sport?: string;
  section_internationale?: string;
  section_europeenne?: string;
  voie_generale?: string;
  voie_technologique?: string;
  voie_professionnelle?: string;
  post_bac?: string;
  lycee_des_metiers?: string;
  appartenance_education_prioritaire?: string;
  libelle_nature?: string;
  fiche_onisep?: string;
  etat?: string;
  nombre_d_eleves?: string;
}

interface ExploreResponse {
  total_count: number;
  results: Array<{ additional_properties: AnnuaireRecord }>;
}

export async function rechercherEtablissementScolaire(
  args: RechercherEtablissementArgs,
): Promise<ToolResult> {
  const { commune, code_postal, code_insee, type, statut, nom, limit = 10 } = args;
  const maxLimit = Math.min(Math.max(limit, 1), 20);

  if (!commune && !code_postal && !code_insee && !nom) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins un critere : commune, code_postal, code_insee ou nom." }],
      isError: true,
    };
  }

  try {
    // Resolution de la localisation
    const location = await resolveLocation(commune, code_postal, code_insee);
    const whereClauses: string[] = [];

    // Filtre localisation par nom de commune (couvre les arrondissements PLM)
    if (location) {
      whereClauses.push(`search(nom_commune, '${sanitize(location.nom)}')`);
    }

    // Filtre type d'etablissement
    if (type) {
      const normalized = normalizeType(type);
      if (normalized) {
        whereClauses.push(`type_etablissement = '${sanitize(normalized)}'`);
      }
    }

    // Filtre statut public/prive
    if (statut) {
      const statutValue = statut === "public" ? "Public" : "Privé";
      whereClauses.push(`statut_public_prive = '${sanitize(statutValue)}'`);
    }

    // Recherche par nom d'etablissement
    if (nom) {
      whereClauses.push(`search(nom_etablissement, '${sanitize(nom)}')`);
    }

    // Uniquement les etablissements ouverts
    whereClauses.push(`etat = 'OUVERT'`);

    const params = new URLSearchParams({
      limit: String(maxLimit),
      where: whereClauses.join(" AND "),
      order_by: "type_etablissement ASC, nom_etablissement ASC",
    });

    const url = `${EDUCATION_API}/${DATASET_ANNUAIRE}/records?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE, source: "education-gouv" });

    if (!response.ok) {
      const body = await response.text();
      return {
        content: [{ type: "text", text: `Erreur API Education : ${response.status} — ${body.slice(0, 200)}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as ExploreResponse;

    if (!data.results?.length) {
      const criteres = [
        location ? `commune "${location.nom}"` : null,
        type ? `type "${type}"` : null,
        statut ? `statut "${statut}"` : null,
        nom ? `nom "${nom}"` : null,
      ].filter(Boolean).join(", ");
      return {
        content: [{ type: "text", text: `Aucun etablissement trouve pour : ${criteres}. Verifiez les criteres ou elargissez la recherche.` }],
      };
    }

    const formatted = data.results.map((r) => formatEtablissement(r.additional_properties));
    const locationLabel = location ? ` a ${location.nom}` : "";

    return {
      content: [{
        type: "text",
        text: [
          `**${data.total_count} etablissement(s) trouve(s)${locationLabel}** (${data.results.length} affiches)\n`,
          ...formatted,
        ].join("\n---\n"),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Erreur : ${error instanceof Error ? error.message : "inconnue"}`,
      }],
      isError: true,
    };
  }
}

/** Resout commune/code_postal/code_insee en nom + code */
async function resolveLocation(
  commune?: string,
  code_postal?: string,
  code_insee?: string,
): Promise<{ nom: string; code: string } | null> {
  if (code_insee) {
    return { nom: code_insee, code: code_insee };
  }
  if (code_postal) {
    const communes = await resolveCodePostal(code_postal);
    if (communes.length > 0) {
      return { nom: communes[0].nom, code: communes[0].code };
    }
  }
  if (commune) {
    const resolved = await resolveNomCommune(commune);
    if (resolved) return resolved;
    // Fallback : utiliser le nom tel quel
    return { nom: commune, code: "" };
  }
  return null;
}

function normalizeType(input: string): string | null {
  const key = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return TYPE_MAP[key] ?? null;
}

function sanitize(input: string): string {
  return input.replace(/['"\\\n\r]/g, "");
}

function formatEtablissement(r: AnnuaireRecord): string {
  const sections: string[] = [];

  // Titre
  const titre = r.nom_etablissement ?? "Etablissement";
  const badge = r.statut_public_prive === "Public" ? "🟢 Public" : "🔵 Prive";
  sections.push(`## ${titre} (${badge})`);

  // Type et nature
  const typeParts = [r.type_etablissement, r.libelle_nature].filter(Boolean);
  if (typeParts.length) sections.push(`**Type** : ${typeParts.join(" — ")}`);

  // Adresse
  const adresse = [r.adresse_1, r.adresse_2, r.code_postal, r.nom_commune].filter(Boolean).join(", ");
  if (adresse) sections.push(`**Adresse** : ${adresse}`);
  if (r.libelle_departement) sections.push(`**Departement** : ${r.libelle_departement}`);

  // Contact
  if (r.telephone) sections.push(`**Telephone** : ${r.telephone}`);
  if (r.mail) sections.push(`**Email** : ${r.mail}`);
  if (r.web) sections.push(`**Site** : ${r.web}`);

  // Voies (lycees)
  const voies: string[] = [];
  if (r.voie_generale === "1") voies.push("Generale");
  if (r.voie_technologique === "1") voies.push("Technologique");
  if (r.voie_professionnelle === "1") voies.push("Professionnelle");
  if (voies.length) sections.push(`**Voies** : ${voies.join(", ")}`);

  // Services
  const services: string[] = [];
  if (r.restauration === 1) services.push("Restauration");
  if (r.hebergement === 1) services.push("Internat");
  if (r.ulis === 1) services.push("ULIS");
  if (r.segpa === "1") services.push("SEGPA");
  if (r.apprentissage === "1") services.push("Apprentissage");
  if (r.post_bac === "1") services.push("Post-bac");
  if (r.lycee_des_metiers === "1") services.push("Lycee des metiers");
  if (services.length) sections.push(`**Services** : ${services.join(", ")}`);

  // Sections
  const sectionsList: string[] = [];
  if (r.section_europeenne === "1") sectionsList.push("Europeenne");
  if (r.section_internationale === "1") sectionsList.push("Internationale");
  if (r.section_sport === "1") sectionsList.push("Sport");
  if (r.section_arts === "1") sectionsList.push("Arts");
  if (r.section_cinema === "1") sectionsList.push("Cinema");
  if (r.section_theatre === "1") sectionsList.push("Theatre");
  if (sectionsList.length) sections.push(`**Sections** : ${sectionsList.join(", ")}`);

  // Education prioritaire
  if (r.appartenance_education_prioritaire && r.appartenance_education_prioritaire !== "HORS EP") {
    sections.push(`**Education prioritaire** : ${r.appartenance_education_prioritaire}`);
  }

  // Effectifs
  if (r.nombre_d_eleves) sections.push(`**Effectif** : ${r.nombre_d_eleves} eleves`);

  // Identifiant UAI + lien Onisep
  if (r.identifiant_de_l_etablissement) sections.push(`**UAI** : ${r.identifiant_de_l_etablissement}`);
  if (r.fiche_onisep) sections.push(`**Fiche Onisep** : ${r.fiche_onisep}`);

  return sections.join("\n");
}
