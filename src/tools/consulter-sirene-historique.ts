/**
 * T85d — consulter_sirene_historique
 * Creations et cessations d'entreprises par secteur d'activite (code NAF)
 * et zone geographique, avec filtrage par periode et etat administratif.
 * Source : API Recherche Entreprises (DINUM) — sans authentification requise
 */

import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";

// Libelles NAF frequents pour l'affichage
const NAF_LIBELLES: Record<string, string> = {
  "10.71C": "Boulangerie",
  "47.11B": "Superettes",
  "47.25Z": "Commerce alcools/boissons",
  "56.10A": "Restauration traditionnelle",
  "56.30Z": "Debits de boissons",
  "62.01Z": "Programmation informatique",
  "68.20A": "Location logements",
  "85.10Z": "Enseignement pre-primaire",
  "86.21Z": "Medecine generaliste",
  "86.22Z": "Medecine specialisee",
  "96.02A": "Coiffure",
};

interface SireneHistoriqueArgs {
  code_naf?: string;            // code NAF/APE (ex: "62.01Z", "56.10A")
  commune?: string;             // nom de commune (ex: "Lyon")
  code_postal?: string;         // code postal (ex: "69001")
  code_departement?: string;    // code departement (ex: "69")
  etat?: "actif" | "cesse";     // filtre etat administratif (defaut: tous)
  limit?: number;
}

interface EntrepriseResult {
  siren: string;
  nom: string;
  etat: string;
  dateCreation: string | null;
  dateFermeture: string | null;
  activitePrincipale: string;
  categorieEntreprise: string | null;
  adresse: string | null;
}

function buildAdresse(siege: Record<string, unknown> | undefined): string | null {
  if (!siege) return null;
  const parts = [
    siege.adresse,
    siege.code_postal,
    siege.libelle_commune ?? siege.commune,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function parseEntreprise(r: Record<string, unknown>): EntrepriseResult {
  const siege = r.siege as Record<string, unknown> | undefined;
  return {
    siren: String(r.siren ?? ""),
    nom: String(r.nom_complet ?? r.nom_raison_sociale ?? "N/A"),
    etat: String(r.etat_administratif ?? ""),
    dateCreation: r.date_creation ? String(r.date_creation) : null,
    dateFermeture: r.date_fermeture ? String(r.date_fermeture) : null,
    activitePrincipale: String(r.activite_principale ?? ""),
    categorieEntreprise: r.categorie_entreprise ? String(r.categorie_entreprise) : null,
    adresse: buildAdresse(siege),
  };
}

function formatDate(d: string | null): string {
  if (!d) return "N/A";
  try {
    return new Date(d).toLocaleDateString("fr-FR");
  } catch {
    return d;
  }
}

export async function consulterSireneHistorique(args: SireneHistoriqueArgs): Promise<ToolResult> {
  const { code_naf, commune, code_postal, code_departement, etat, limit = 10 } = args;

  if (!code_naf && !commune && !code_postal && !code_departement) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins un critere : code_naf, commune, code_postal ou code_departement." + suggestAlternative("consulter_sirene_historique") }],
      isError: true,
    };
  }

  try {
    const params = new URLSearchParams({
      per_page: String(Math.min(limit, 25)),
      page: "1",
    });

    // Filtre NAF
    if (code_naf) {
      params.set("activite_principale", sanitize(code_naf));
    }

    // Filtre geographique
    if (code_postal) {
      params.set("code_postal", sanitize(code_postal));
    } else if (commune) {
      params.set("commune", sanitize(commune));
    } else if (code_departement) {
      params.set("departement", sanitize(code_departement));
    }

    // Filtre etat administratif
    if (etat === "actif") {
      params.set("etat_administratif", "A");
    } else if (etat === "cesse") {
      params.set("etat_administratif", "C");
    }

    const url = `${API_BASE}?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Erreur API Recherche Entreprises : HTTP ${response.status}` }],
        isError: true,
      };
    }

    const data = await response.json() as {
      results: Array<Record<string, unknown>>;
      total_results: number;
      page: number;
      per_page: number;
    };

    if (!data.results?.length) {
      return {
        content: [{ type: "text", text: "Aucune entreprise trouvee pour ces criteres. Verifiez le code NAF ou la zone geographique." }],
      };
    }

    const entreprises = data.results.map(parseEntreprise);

    return { content: [{ type: "text", text: formatSireneReport(entreprises, args, data.total_results) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur consulter_sirene_historique : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

function formatSireneReport(entreprises: EntrepriseResult[], args: SireneHistoriqueArgs, total: number): string {
  const lines: string[] = [];

  // En-tete
  const subtitle: string[] = [];
  if (args.code_naf) {
    const libelle = NAF_LIBELLES[args.code_naf] ?? args.code_naf;
    subtitle.push(`secteur : ${libelle} (NAF ${args.code_naf})`);
  }
  if (args.commune) subtitle.push(`commune : ${args.commune}`);
  if (args.code_postal) subtitle.push(`CP : ${args.code_postal}`);
  if (args.code_departement) subtitle.push(`dept : ${args.code_departement}`);
  if (args.etat) subtitle.push(`etat : ${args.etat}`);

  lines.push(`**Entreprises SIRENE** — ${total.toLocaleString("fr-FR")} resultat(s)${subtitle.length ? ` (${subtitle.join(", ")})` : ""}`);
  lines.push(`Affichage : ${entreprises.length} entreprises`);
  lines.push("");

  // Stats rapides
  const actives = entreprises.filter((e) => e.etat === "A").length;
  const cessees = entreprises.filter((e) => e.etat === "C").length;
  if (actives > 0 || cessees > 0) {
    lines.push(`Parmi les resultats : ${actives} active(s), ${cessees} cessee(s)`);
    lines.push("");
  }

  // Liste des entreprises
  for (const e of entreprises) {
    const etatLabel = e.etat === "A" ? "✅ Active" : e.etat === "C" ? "🔴 Cessée" : e.etat;
    lines.push(`**${e.nom}** (SIREN : ${e.siren})`);
    lines.push(`${etatLabel} | NAF : ${e.activitePrincipale}`);
    lines.push(`Creation : ${formatDate(e.dateCreation)}${e.dateFermeture ? ` | Fermeture : ${formatDate(e.dateFermeture)}` : ""}`);
    if (e.adresse) lines.push(`Adresse : ${e.adresse}`);
    if (e.categorieEntreprise) lines.push(`Categorie : ${e.categorieEntreprise}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("_Source : API Recherche Entreprises (DINUM) — donnees SIRENE (INSEE). Open Data._");
  lines.push("_Pour consulter l'historique complet d'une entreprise, utilisez `rechercher_entreprise` avec son SIREN._");

  return lines.join("\n");
}

function sanitize(s: string): string {
  return s.replace(/['"\\]/g, "");
}
