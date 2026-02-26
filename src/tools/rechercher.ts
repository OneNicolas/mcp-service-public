import type { Env, ToolResult } from "../types.js";
import { rechercherFiche } from "./rechercher-fiche.js";
import { rechercherDoctrineFiscale } from "./rechercher-doctrine-fiscale.js";
import { consulterFiscaliteLocale } from "./consulter-fiscalite-locale.js";
import { consulterTransactionsImmobilieres } from "./consulter-transactions-immobilieres.js";

interface RechercherArgs {
  query: string;
  limit?: number;
}

type QueryCategory = "fiscalite_locale" | "doctrine_bofip" | "fiches_dila" | "transactions_dvf";

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
    case "transactions_dvf": {
      const communeName = extractCommuneName(query);
      const typeLocal = extractTypeLocal(query);
      if (communeName) {
        const result = await consulterTransactionsImmobilieres({ commune: communeName, type_local: typeLocal ?? undefined });
        return prefixResult(result, "🏠 Transactions immobilières (DVF)");
      }
      // Pas de commune → fallback fiches DILA
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (service-public.fr)");
    }

    case "fiscalite_locale": {
      const communeName = extractCommuneName(query);
      if (communeName) {
        const result = await consulterFiscaliteLocale({ commune: communeName });
        return prefixResult(result, "📍 Fiscalité locale");
      }
      const result = await rechercherDoctrineFiscale({ query, limit });
      return prefixResult(result, "📖 Doctrine fiscale (BOFiP)");
    }

    case "doctrine_bofip": {
      const result = await rechercherDoctrineFiscale({ query, limit });
      return prefixResult(result, "📖 Doctrine fiscale (BOFiP)");
    }

    case "fiches_dila": {
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (service-public.fr)");
    }
  }
}

/** Classifie la requête pour router vers la bonne source */
function classifyQuery(query: string): QueryCategory {
  const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Patterns DVF / immobilier
  const dvfPatterns = [
    /\bprix\b.*\b(immobilier|m2|m²|metre|appart|maison)\b/,
    /\b(transaction|mutation|vente)s?\s+(immobili|foncier)/,
    /\bprix\s+(au\s+)?m(2|²|etre)/,
    /\b(dvf|valeurs?\s+foncier)\b/,
    /\bmarche\s+immobilier\b/,
    /\b(acheter|achat|vendre|vente)\b.*\b(appartement|maison|bien|immobilier)\b/,
    /\bprix\s+(des?\s+)?(appartement|maison|bien|immobilier)s?\b/,
    /\bcombien\s+coute\b.*\b(appartement|maison|m2|m²)\b/,
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
function extractCommuneName(query: string): string | null {
  const patterns = [
    /(?:commune\s+de|ville\s+de|taux\s+(?:a|à|de|pour)|prix\s+(?:a|à|de|pour))\s+([a-zàâäéèêëïîôùûüÿç\s-]{2,30})/i,
    /(?:à|a|de|pour)\s+([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ][a-zàâäéèêëïîôùûüÿç\s-]{1,29})\b/,
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

  const upperWords = query.match(/\b[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]{2,}(?:\s+[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]{2,})*\b/g);
  if (upperWords?.length) {
    const candidate = upperWords[0];
    const stopUpper = ["TFB", "TFNB", "TEOM", "CFE", "TH", "TVA", "IR", "IS", "BOFIP", "REI", "DVF"];
    if (!stopUpper.includes(candidate)) return candidate;
  }

  return null;
}

/** Extrait le type de bien immobilier de la requête */
function extractTypeLocal(query: string): string | null {
  const q = query.toLowerCase();
  if (/\bappartement/.test(q)) return "Appartement";
  if (/\bmaison/.test(q)) return "Maison";
  if (/\blocal/.test(q)) return "Local industriel. commercial ou assimilé";
  return null;
}

function prefixResult(result: ToolResult, sourceLabel: string): ToolResult {
  if (result.isError) return result;
  const text = result.content[0]?.text ?? "";
  return {
    content: [{ type: "text", text: `_Recherche via : ${sourceLabel}_\n\n${text}` }],
  };
}
