import type { Env, ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";

const BODACC_API = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";

// Types d'annonces BODACC
const TYPE_ANNONCE_LABELS: Record<string, string> = {
  "01": "Vente et cession",
  "02": "Immatriculation",
  "03": "Creation",
  "04": "Modification generale",
  "05": "Radiation",
  "06": "Depot des comptes",
  "07": "Procedure collective",
  "08": "Modification de procédure collective",
  "09": "Cloture de procedure collective",
};

interface RechercherAnnonceLegaleArgs {
  recherche?: string;
  nom_entreprise?: string;
  siren?: string;
  type_annonce?: "vente_cession" | "immatriculation" | "radiation" | "procedure_collective" | "modification";
  departement?: string;
  date_debut?: string; // YYYY-MM-DD
  date_fin?: string;
  limit?: number;
}

interface BodaccRecord {
  id?: string;
  numeroannonce?: number | string;
  typeavis?: string;
  typeavis_lib?: string;
  nomEntreprise?: string;
  registre?: string;
  tribunal?: string;
  ville?: string;
  cp?: string;
  dateparution?: string;
  familleavis?: string;
  familleavis_lib?: string;
  commercant?: string;
  depot?: { siren?: string; denomination?: string } | string;
  acte?: { categorie?: string; dateDebutActivite?: string } | string;
  jugement?: { famille?: string; nature?: string; date?: string } | string;
}

// Mapping type_annonce (parametre simplifie) vers familleavis BODACC
const FAMILLE_MAP: Record<string, string> = {
  vente_cession: "Vente et cessions",
  immatriculation: "Immatriculations",
  radiation: "Radiations",
  procedure_collective: "Procedures collectives",
  modification: "Modifications générales",
};

export async function rechercherAnnonceLegale(
  args: RechercherAnnonceLegaleArgs,
  _env?: Env,
): Promise<ToolResult> {
  const { recherche, nom_entreprise, siren, type_annonce, departement, date_debut, date_fin, limit = 10 } = args;

  if (!recherche && !nom_entreprise && !siren && !type_annonce && !departement) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins un critere : recherche, nom_entreprise, siren, type_annonce ou departement." }],
      isError: true,
    };
  }

  try {
    const filters: string[] = [];

    if (siren) {
      // Recherche par SIREN dans les champs depot ou registre
      const safeSiren = siren.replace(/\D/g, "").substring(0, 9);
      filters.push(`search(registre, '${safeSiren}')`);
    } else if (nom_entreprise) {
      const safe = nom_entreprise.replace(/'/g, " ").trim();
      filters.push(`search(commercant, '${safe}')`);
    } else if (recherche) {
      const safe = recherche.replace(/'/g, " ").trim();
      // Recherche globale dans commercant et ville
      filters.push(`(search(commercant, '${safe}') OR search(ville, '${safe}'))`);
    }

    if (type_annonce) {
      const famille = FAMILLE_MAP[type_annonce];
      if (famille) {
        filters.push(`familleavis_lib = '${famille}'`);
      }
    }

    if (departement) {
      const dept = departement.padStart(2, "0");
      filters.push(`cp LIKE '${dept}%'`);
    }

    if (date_debut) {
      filters.push(`dateparution >= '${date_debut}'`);
    }

    if (date_fin) {
      filters.push(`dateparution <= '${date_fin}'`);
    }

    const params = new URLSearchParams({
      limit: String(Math.min(limit, 20)),
      order_by: "dateparution DESC",
    });

    if (filters.length > 0) {
      params.set("where", filters.join(" AND "));
    }

    const url = `${BODACC_API}?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Erreur API BODACC : ${response.status} ${response.statusText}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as {
      total_count: number;
      results: BodaccRecord[];
    };

    if (!data.results?.length) {
      return {
        content: [{ type: "text", text: "Aucune annonce trouvee pour ces criteres." }],
      };
    }

    return {
      content: [{ type: "text", text: formatBodaccResults(data.results, data.total_count, args) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur recherche annonces BODACC : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

function formatBodaccResults(records: BodaccRecord[], total: number, args: RechercherAnnonceLegaleArgs): string {
  const lines: string[] = [];

  lines.push(`## Annonces legales — BODACC`);
  lines.push("");

  const subtitle: string[] = [];
  if (args.siren) subtitle.push(`SIREN : ${args.siren}`);
  if (args.nom_entreprise) subtitle.push(`entreprise : "${args.nom_entreprise}"`);
  if (args.recherche) subtitle.push(`recherche : "${args.recherche}"`);
  if (args.type_annonce) subtitle.push(`type : ${FAMILLE_MAP[args.type_annonce] ?? args.type_annonce}`);
  if (args.departement) subtitle.push(`departement : ${args.departement}`);
  if (args.date_debut || args.date_fin) subtitle.push(`periode : ${args.date_debut ?? "..."} → ${args.date_fin ?? "..."}`);

  lines.push(`**${total.toLocaleString("fr-FR")} annonces** trouvees${subtitle.length ? ` (${subtitle.join(", ")})` : ""}, ${records.length} affichees.`);
  lines.push("");

  for (const r of records) {
    const nomEntreprise = r.commercant ?? r.nomEntreprise ?? "Entreprise non renseignee";
    const famille = r.familleavis_lib ?? (r.familleavis ? (TYPE_ANNONCE_LABELS[r.familleavis] ?? r.familleavis) : "N/A");
    const localisation = [r.ville, r.cp ? `(${r.cp})` : ""].filter(Boolean).join(" ");
    const tribunal = r.tribunal ? ` · Tribunal : ${r.tribunal}` : "";
    const dateParution = formatDate(r.dateparution);
    const registre = r.registre ? ` · RCS : ${r.registre}` : "";

    // Details supplementaires selon le type d'annonce
    const details: string[] = [];
    if (r.jugement && typeof r.jugement === "object") {
      if (r.jugement.nature) details.push(`Nature : ${r.jugement.nature}`);
      if (r.jugement.date) details.push(`Date jugement : ${formatDate(r.jugement.date)}`);
    }
    if (r.acte && typeof r.acte === "object") {
      if (r.acte.categorie) details.push(`Categorie : ${r.acte.categorie}`);
      if (r.acte.dateDebutActivite) details.push(`Debut activite : ${formatDate(r.acte.dateDebutActivite)}`);
    }

    const detailsLine = details.length > 0 ? `\n   📋 ${details.join(" · ")}` : "";
    const numAnnonce = r.numeroannonce ? ` n°${r.numeroannonce}` : "";

    lines.push(`### ${nomEntreprise}`);
    lines.push(`**${famille}**${numAnnonce} · ${localisation}${tribunal}`);
    lines.push(`📅 ${dateParution}${registre}${detailsLine}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("_Source : BODACC (Bulletin officiel des annonces civiles et commerciales) — DILA. Licence Ouverte v2.0._");
  lines.push("_Consultation directe : https://www.bodacc.fr_");

  return lines.join("\n");
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "N/A";
  try {
    return new Date(dateStr).toLocaleDateString("fr-FR");
  } catch {
    return dateStr;
  }
}
