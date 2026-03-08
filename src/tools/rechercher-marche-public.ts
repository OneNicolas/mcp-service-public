import type { Env, ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

const BOAMP_API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

// Types d'avis BOAMP
const TYPE_AVIS_LABELS: Record<string, string> = {
  AAC: "Avis d'appel a la concurrence",
  APC: "Avis d'attribution",
  MAPA: "Marche a procedure adaptee",
  DSP: "Delegation de service public",
  MOD: "Modification",
  ANN: "Annulation",
  REG: "Rectificatif",
};

interface RechercherMarchePublicArgs {
  recherche?: string;
  type_avis?: "AAC" | "APC" | "MAPA" | "DSP";
  departement?: string;
  acheteur?: string;
  date_debut?: string; // YYYY-MM-DD
  date_fin?: string;   // YYYY-MM-DD
  limit?: number;
}

interface BoampRecord {
  id?: string;
  idweb?: string;
  objet?: string;
  acheteur?: string | { nom?: string };
  code_departement?: string;
  type_avis?: string;
  famille?: string;
  dateparution?: string;
  datelimitereponse?: string;
  montant?: number | string;
  descripteur_libelle?: string;
  lieu_execution?: string;
}

export async function rechercherMarchePublic(
  args: RechercherMarchePublicArgs,
  _env?: Env,
): Promise<ToolResult> {
  const { recherche, type_avis, departement, acheteur, date_debut, date_fin, limit = 10 } = args;

  if (!recherche && !type_avis && !departement && !acheteur) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins un critere : recherche, type_avis, departement ou acheteur." + suggestAlternative("rechercher_marche_public") }],
      isError: true,
    };
  }

  try {
    // Construction des filtres WHERE
    const filters: string[] = [];

    if (recherche) {
      // Recherche textuelle dans l'objet du marche
      const safe = recherche.replace(/'/g, " ").trim();
      filters.push(`search(objet, '${safe}')`);
    }

    if (type_avis) {
      filters.push(`type_avis = '${type_avis}'`);
    }

    if (departement) {
      const dept = departement.padStart(2, "0");
      filters.push(`code_departement = '${dept}'`);
    }

    if (acheteur) {
      const safe = acheteur.replace(/'/g, " ").trim();
      filters.push(`search(acheteur, '${safe}')`);
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

    const url = `${BOAMP_API}?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.ANNUAIRE });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Erreur API BOAMP : ${response.status} ${response.statusText}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as {
      total_count: number;
      results: BoampRecord[];
    };

    if (!data.results?.length) {
      return {
        content: [{ type: "text", text: "Aucun avis trouve pour ces criteres. Essayez des termes plus generaux ou supprimez certains filtres." }],
      };
    }

    return {
      content: [{ type: "text", text: formatBoampResults(data.results, data.total_count, args) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur recherche marches publics : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

function formatBoampResults(records: BoampRecord[], total: number, args: RechercherMarchePublicArgs): string {
  const lines: string[] = [];

  lines.push(`## Marches publics — BOAMP`);
  lines.push("");

  const subtitle: string[] = [];
  if (args.recherche) subtitle.push(`recherche : "${args.recherche}"`);
  if (args.type_avis) subtitle.push(`type : ${TYPE_AVIS_LABELS[args.type_avis] ?? args.type_avis}`);
  if (args.departement) subtitle.push(`departement : ${args.departement}`);
  if (args.acheteur) subtitle.push(`acheteur : "${args.acheteur}"`);
  if (args.date_debut || args.date_fin) subtitle.push(`periode : ${args.date_debut ?? "..."} → ${args.date_fin ?? "..."}`);

  lines.push(`**${total.toLocaleString("fr-FR")} avis** trouvés${subtitle.length ? ` (${subtitle.join(", ")})` : ""}, ${records.length} affiches.`);
  lines.push("");

  for (const r of records) {
    const objet = r.objet ?? "Objet non renseigne";
    const nomAcheteur = typeof r.acheteur === "object" ? (r.acheteur?.nom ?? "N/A") : (r.acheteur ?? "N/A");
    const typeLabel = r.type_avis ? (TYPE_AVIS_LABELS[r.type_avis] ?? r.type_avis) : "N/A";
    const dept = r.code_departement ? `Dept ${r.code_departement}` : "";
    const dateParution = formatDate(r.dateparution);
    const dateLimite = r.datelimitereponse ? ` — limite : ${formatDate(r.datelimitereponse)}` : "";
    const montant = r.montant ? ` — Montant : ${formatMontant(r.montant)}` : "";
    const descripteur = r.descripteur_libelle ? `\n   🏷️ ${r.descripteur_libelle}` : "";
    const lieuExec = r.lieu_execution ? ` · ${r.lieu_execution}` : "";
    const id = r.idweb ?? r.id ?? "";
    const lien = id ? `\n   🔗 https://www.boamp.fr/avis/detail/${id}` : "";

    lines.push(`### ${objet.substring(0, 120)}${objet.length > 120 ? "..." : ""}`);
    lines.push(`**${typeLabel}** · ${nomAcheteur} · ${dept}${lieuExec}`);
    lines.push(`📅 Paru le : ${dateParution}${dateLimite}${montant}${descripteur}${lien}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("_Source : BOAMP (Bulletin officiel des annonces des marches publics) — DILA. Licence Ouverte v2.0._");
  lines.push("_Recherche directe via boamp.fr : https://www.boamp.fr_");

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

function formatMontant(montant: number | string): string {
  const val = typeof montant === "string" ? parseFloat(montant) : montant;
  if (isNaN(val)) return String(montant);
  return val.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}
