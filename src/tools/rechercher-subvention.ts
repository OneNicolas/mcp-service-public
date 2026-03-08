/**
 * T85b — rechercher_subvention
 * Subventions versees par les collectivites locales et organismes publics.
 * Source : data.gouv.fr Tabular API — dataset "subventions depuis 2017"
 * Obligation de publication des subventions > 23 000 EUR (loi transparence).
 */

import type { ToolResult } from "../types.js";
import { cachedFetch, CACHE_TTL } from "../utils/cache.js";
import { suggestAlternative } from "../utils/suggest-alternative.js";

// Dataset agrege : subventions depuis 2017 (collectivites sous obligation legale)
const RESOURCE_ID = "818ce77b-7be6-4c64-bbe3-a4b509c9d164";
const TABULAR_API = `https://tabular-api.data.gouv.fr/api/resources/${RESOURCE_ID}/data/`;

interface RechercherSubventionArgs {
  beneficiaire?: string;       // nom du beneficiaire (recherche partielle)
  attribuant?: string;         // nom de l'organisme attribuant (commune, departement...)
  montant_min?: number;        // montant minimum en euros
  annee?: number;              // annee de la convention
  objet?: string;              // objet ou descriptif de la subvention
  limit?: number;
}

interface SubventionRow {
  nomAttribuant: string;
  idAttribuant: string;
  dateConvention: string;
  referenceDecision: string;
  nomBeneficiaire: string;
  idBeneficiaire: string;
  rnaBeneficiaire: string;
  objet: string;
  montant: number;
  nature: string;
  conditionsVersement: string;
  dispositifAide: string;
}

interface TabularResponse {
  data: Array<Record<string, unknown>>;
  next_page?: string;
  page_number?: number;
  total?: number;
}

/** Extrait une colonne d'une row par regex sur les noms de champs */
function getField(row: Record<string, unknown>, patterns: RegExp[]): unknown {
  for (const [k, v] of Object.entries(row)) {
    for (const pat of patterns) {
      if (pat.test(k)) return v;
    }
  }
  return undefined;
}

function parseRow(raw: Record<string, unknown>): SubventionRow {
  return {
    nomAttribuant: String(getField(raw, [/^nomattribuant$/i, /attribuant.*nom/i]) ?? ""),
    idAttribuant: String(getField(raw, [/^idattribuant$/i]) ?? ""),
    dateConvention: String(getField(raw, [/^dateconvention$/i, /^date_convention$/i]) ?? ""),
    referenceDecision: String(getField(raw, [/^referencedecision$/i, /^reference_decision$/i]) ?? ""),
    nomBeneficiaire: String(getField(raw, [/^nombeneficiaire$/i, /beneficiaire.*nom/i]) ?? ""),
    idBeneficiaire: String(getField(raw, [/^idbeneficiaire$/i]) ?? ""),
    rnaBeneficiaire: String(getField(raw, [/^rnabeneficiaire$/i]) ?? ""),
    objet: String(getField(raw, [/^objet$/i]) ?? ""),
    montant: Number(getField(raw, [/^montant$/i]) ?? 0),
    nature: String(getField(raw, [/^nature$/i]) ?? ""),
    conditionsVersement: String(getField(raw, [/^conditionsversement$/i, /^conditions_versement$/i]) ?? ""),
    dispositifAide: String(getField(raw, [/^dispositifaide$/i, /^dispositif_aide$/i]) ?? ""),
  };
}

export async function rechercherSubvention(args: RechercherSubventionArgs): Promise<ToolResult> {
  const { beneficiaire, attribuant, montant_min, annee, objet, limit = 10 } = args;

  if (!beneficiaire && !attribuant && !objet) {
    return {
      content: [{ type: "text", text: "Veuillez fournir au moins un critere : beneficiaire, attribuant ou objet." + suggestAlternative("rechercher_subvention") }],
      isError: true,
    };
  }

  try {
    const params = new URLSearchParams({ page_size: String(Math.min(limit, 50)) });

    // Filtres Tabular API (exact ou contains)
    if (beneficiaire) {
      params.set("nomBeneficiaire__contains", beneficiaire);
    }
    if (attribuant) {
      params.set("nomAttribuant__contains", attribuant);
    }
    if (objet) {
      params.set("objet__contains", objet);
    }
    if (montant_min !== undefined) {
      params.set("montant__gte", String(montant_min));
    }
    if (annee) {
      // Filtre sur l'annee de la convention (format YYYY-MM-DD)
      params.set("dateConvention__gte", `${annee}-01-01`);
      params.set("dateConvention__lte", `${annee}-12-31`);
    }

    // Tri par montant decroissant
    params.set("montant__sort", "desc");

    const url = `${TABULAR_API}?${params}`;
    const response = await cachedFetch(url, { ttl: CACHE_TTL.DVF });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Erreur API data.gouv.fr Tabular : HTTP ${response.status}` }],
        isError: true,
      };
    }

    const json = (await response.json()) as TabularResponse;
    const rows = (json.data ?? []).map(parseRow).filter((r) => r.nomBeneficiaire || r.nomAttribuant);

    if (rows.length === 0) {
      return {
        content: [{ type: "text", text: "Aucune subvention trouvee pour ces criteres. Essayez des termes plus generaux." }],
      };
    }

    return { content: [{ type: "text", text: formatSubventions(rows, args, json.total) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur rechercher_subvention : ${error instanceof Error ? error.message : "inconnue"}` }],
      isError: true,
    };
  }
}

function formatSubventions(rows: SubventionRow[], args: RechercherSubventionArgs, total?: number): string {
  const lines: string[] = [];

  // En-tete
  const subtitle: string[] = [];
  if (args.beneficiaire) subtitle.push(`beneficiaire : "${args.beneficiaire}"`);
  if (args.attribuant) subtitle.push(`attribuant : "${args.attribuant}"`);
  if (args.objet) subtitle.push(`objet : "${args.objet}"`);
  if (args.montant_min) subtitle.push(`montant >= ${args.montant_min.toLocaleString("fr-FR")} EUR`);
  if (args.annee) subtitle.push(`annee : ${args.annee}`);

  const totalLabel = total !== undefined ? `${total.toLocaleString("fr-FR")} subvention(s) trouvee(s)` : `${rows.length} subvention(s)`;
  lines.push(`**Subventions** — ${totalLabel}${subtitle.length ? ` (${subtitle.join(", ")})` : ""}`);
  lines.push("");

  // Calcul du montant total affiche
  const totalMontant = rows.reduce((s, r) => s + (r.montant || 0), 0);
  lines.push(`Montant total affiche : **${totalMontant.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} EUR**`);
  lines.push("");

  for (const r of rows) {
    const montant = r.montant > 0
      ? `**${r.montant.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} EUR**`
      : "Non renseigne";

    const anneeConv = r.dateConvention ? r.dateConvention.slice(0, 4) : "N/A";

    lines.push(`### ${r.nomBeneficiaire || "Beneficiaire inconnu"}`);
    lines.push(`**Attribuant :** ${r.nomAttribuant || "N/A"}${r.idAttribuant ? ` (SIRET : ${r.idAttribuant})` : ""}`);
    lines.push(`**Montant :** ${montant} | **Annee :** ${anneeConv}`);

    if (r.objet) lines.push(`**Objet :** ${r.objet.slice(0, 200)}${r.objet.length > 200 ? "..." : ""}`);
    if (r.nature) lines.push(`**Nature :** ${r.nature}`);
    if (r.dispositifAide) lines.push(`**Dispositif :** ${r.dispositifAide}`);
    if (r.rnaBeneficiaire) lines.push(`**RNA :** ${r.rnaBeneficiaire}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("_Source : data.gouv.fr — subventions publiques depuis 2017 (obligation legale > 23 000 EUR)._");
  lines.push("_Couverture : collectivites locales, EPCI, departements, regions. Non exhaustif (hors Etat central)._");

  return lines.join("\n");
}
