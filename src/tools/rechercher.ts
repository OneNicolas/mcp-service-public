import type { Env, ToolResult } from "../types.js";
import { rechercherFiche } from "./rechercher-fiche.js";
import { rechercherDoctrineFiscale } from "./rechercher-doctrine-fiscale.js";
import { consulterFiscaliteLocale } from "./consulter-fiscalite-locale.js";
import { consulterTransactionsImmobilieres } from "./consulter-transactions-immobilieres.js";
import { simulerTaxeFonciere } from "./simuler-taxe-fonciere.js";

interface RechercherArgs {
  query: string;
  limit?: number;
}

export type QueryCategory = "fiscalite_locale" | "doctrine_bofip" | "fiches_dila" | "transactions_dvf" | "simulation_tf";

/** Recherche unifiée : dispatche automatiquement vers la bonne source */
export async function rechercher(
  args: RechercherArgs,
  env: Env,
): Promise<ToolResult> {
  const { query, limit = 5 } = args;

  if (!query || query.trim().length < 2) {
    return {
      content: [{ type: "text", text: "Veuillez fournir une question ou des termes de recherche." }],
      isError: true,
    };
  }

  const category = classifyQuery(query);

  switch (category) {
    case "simulation_tf": {
      // Tenter d'extraire les paramètres pour le simulateur
      const communeName = extractCommuneName(query);
      const surface = extractSurface(query);
      const typeBien = extractTypeBien(query);

      if (communeName && surface && typeBien) {
        const result = await simulerTaxeFonciere({ commune: communeName, surface, type_bien: typeBien });
        return prefixResult(result, "\ud83e\uddee Simulation taxe foncière");
      }

      // Paramètres insuffisants -> fallback vers fiscalité locale si commune détectée
      if (communeName) {
        const result = await consulterFiscaliteLocale({ commune: communeName });
        return prefixResult(result, "\ud83d\udccd Fiscalité locale (paramètres insuffisants pour simulation, utiliser `simuler_taxe_fonciere` avec surface et type de bien)");
      }

      // Pas de commune -> fiches DILA
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "\ud83d\udccb Fiches pratiques (service-public.fr)");
    }

    case "transactions_dvf": {
      const communeName = extractCommuneName(query);
      const typeLocal = extractTypeLocal(query);
      if (communeName) {
        const result = await consulterTransactionsImmobilieres({ commune: communeName, type_local: typeLocal ?? undefined });
        return prefixResult(result, "\ud83c\udfe0 Transactions immobilières (DVF)");
      }
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "\ud83d\udccb Fiches pratiques (service-public.fr)");
    }

    case "fiscalite_locale": {
      const communeName = extractCommuneName(query);
      if (communeName) {
        const result = await consulterFiscaliteLocale({ commune: communeName });
        return prefixResult(result, "\ud83d\udccd Fiscalité locale");
      }
      const result = await rechercherDoctrineFiscale({ query, limit });
      return prefixResult(result, "\ud83d\udcd6 Doctrine fiscale (BOFiP)");
    }

    case "doctrine_bofip": {
      const result = await rechercherDoctrineFiscale({ query, limit });
      return prefixResult(result, "\ud83d\udcd6 Doctrine fiscale (BOFiP)");
    }

    case "fiches_dila": {
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "\ud83d\udccb Fiches pratiques (service-public.fr)");
    }
  }
}

/** Classifie la requête pour router vers la bonne source */
export function classifyQuery(query: string): QueryCategory {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // T7 — Patterns simulation TF (vérifiés AVANT fiscalité locale)
  const simulationTfPatterns = [
    /\bcombien\b.*\btaxe\s+foncier/,
    /\bestimer?\b.*\btaxe\s+foncier/,
    /\bsimuler?\b.*\b(tf|taxe\s+foncier)/,
    /\btaxe\s+foncier.*\b(pour|sur)\s+(un|une|mon|ma|notre)\b/,
    /\bcalcul(er)?\b.*\btaxe\s+foncier/,
    /\b(montant|cout)\b.*\btaxe\s+foncier/,
    /\btaxe\s+foncier.*\b\d+\s*m/,
  ];

  for (const pattern of simulationTfPatterns) {
    if (pattern.test(q)) return "simulation_tf";
  }

  // Patterns DVF / immobilier
  const dvfPatterns = [
    /\bprix\b.*\b(immobilier|m2|m\u00b2|metre|appart|maison)\b/,
    /\b(transaction|mutation|vente)s?\s+(immobili|foncier)/,
    /\bprix\s+(au\s+)?m(2|\u00b2|etre)/,
    /\b(dvf|valeurs?\s+foncier)\b/,
    /\bmarche\s+immobilier\b/,
    /\b(acheter|achat|vendre|vente)\b.*\b(appartement|maison|bien|immobilier)\b/,
    /\bprix\s+(des?\s+)?(appartement|maison|bien|immobilier)s?\b/,
    /\bcombien\s+coute\b.*\b(appartement|maison|m2|m\u00b2)\b/,
  ];

  for (const pattern of dvfPatterns) {
    if (pattern.test(q)) return "transactions_dvf";
  }

  // Patterns fiscalité locale
  const fiscaliteLocalePatterns = [
    /\btaux\b.*\bfoncier/,
    /\btaxe\s+foncier/,
    /\btaux\b.*\b(habitation|teom|cfe)\b/,
    /\b(taxe|taux)\b.*\b(commune|communal|local|ville)\b/,
    /\b(tfb|tfnb|teom|cfe)\b/,
    /\bfiscalite\s+locale\b/,
    /\btaux\s+d.?imposition\b.*\b(commune|local|ville)\b/,
    /\bordures\s+menageres\b.*\btaux\b/,
  ];

  const bofipPatterns = [
    /\b(impot|imposition)\b.*\b(revenu|societe|fortune)\b/,
    /\b(ir|is|tva|bic|bnc|rfpi)\b/,
    /\bcredit\s+d.?impot\b/,
    /\b(deduction|exoneration|abattement|plus.?value|amortissement)\b/,
    /\b(bofip|doctrine\s+fiscale|bulletin\s+officiel)\b/,
    /\bregime\s+fiscal\b/,
    /\b(micro.?entreprise|auto.?entrepreneur)\b.*\b(fiscal|impot|tva)\b/,
    /\bdeficit\s+foncier\b/,
    /\btaxe\s+sur\s+la\s+valeur\s+ajoutee\b/,
    /\b(droits?\s+de\s+succession|donation)\b.*\b(fiscal|impot|exoner)\b/,
  ];

  for (const pattern of fiscaliteLocalePatterns) {
    if (pattern.test(q)) return "fiscalite_locale";
  }

  for (const pattern of bofipPatterns) {
    if (pattern.test(q)) return "doctrine_bofip";
  }

  const fiscKeywords = ["impot", "fiscal", "taxe", "tva", "deduction", "exoneration", "plus-value", "amortissement"];
  const fiscCount = fiscKeywords.filter((k) => q.includes(k)).length;
  if (fiscCount >= 2) return "doctrine_bofip";

  return "fiches_dila";
}

/** Tente d'extraire un nom de commune de la requête */
export function extractCommuneName(query: string): string | null {
  const patterns = [
    /(?:commune\s+de|ville\s+de|taux\s+(?:a|\u00e0|de|pour)|prix\s+(?:a|\u00e0|de|pour))\s+([a-z\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ef\u00ee\u00f4\u00f9\u00fb\u00fc\u00ff\u00e7\s-]{2,30})/i,
    /(?:\u00e0|a|de|pour)\s+([A-Z\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00cf\u00ce\u00d4\u00d9\u00db\u00dc\u0178\u00c7][a-z\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ef\u00ee\u00f4\u00f9\u00fb\u00fc\u00ff\u00e7\s-]{1,29})\b/,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      const stopWords = ["la", "le", "les", "des", "une", "mon", "ma", "mes", "quel", "cette", "un"];
      if (!stopWords.includes(candidate.toLowerCase())) {
        return candidate.toUpperCase();
      }
    }
  }

  const upperWords = query.match(/\b[A-Z\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00cf\u00ce\u00d4\u00d9\u00db\u00dc\u0178\u00c7]{2,}(?:\s+[A-Z\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00cf\u00ce\u00d4\u00d9\u00db\u00dc\u0178\u00c7]{2,})*\b/g);
  if (upperWords?.length) {
    const candidate = upperWords[0];
    const stopUpper = ["TFB", "TFNB", "TEOM", "CFE", "TH", "TVA", "IR", "IS", "BOFIP", "REI", "DVF", "TF"];
    if (!stopUpper.includes(candidate)) return candidate;
  }

  return null;
}

/** Extrait le type de bien immobilier de la requête */
export function extractTypeLocal(query: string): string | null {
  const q = query.toLowerCase();
  if (/\bappartement/.test(q)) return "Appartement";
  if (/\bmaison/.test(q)) return "Maison";
  if (/\blocal/.test(q)) return "Local industriel. commercial ou assimilé";
  return null;
}

/** T7 — Extrait une surface en m² de la requête */
function extractSurface(query: string): number | null {
  const match = query.match(/(\d+)\s*m[\u00b22]?\b/i);
  if (match) {
    const surface = parseInt(match[1], 10);
    if (surface > 0 && surface < 10000) return surface;
  }
  return null;
}

/** T7 — Extrait le type de bien (Maison/Appartement) de la requête */
function extractTypeBien(query: string): "Maison" | "Appartement" | null {
  const q = query.toLowerCase();
  if (/\bmaison\b/.test(q)) return "Maison";
  if (/\b(appartement|appart|studio|f[1-6]|t[1-6])\b/.test(q)) return "Appartement";
  return null;
}

function prefixResult(result: ToolResult, sourceLabel: string): ToolResult {
  if (result.isError) return result;
  const text = result.content[0]?.text ?? "";
  return {
    content: [{ type: "text", text: `_Recherche via : ${sourceLabel}_\n\n${text}` }],
  };
}
