import type { Env, ToolResult } from "../types.js";
import { rechercherFiche } from "./rechercher-fiche.js";
import { rechercherDoctrineFiscale } from "./rechercher-doctrine-fiscale.js";
import { consulterFiscaliteLocale } from "./consulter-fiscalite-locale.js";
import { consulterTransactionsImmobilieres } from "./consulter-transactions-immobilieres.js";
import { simulerTaxeFonciere } from "./simuler-taxe-fonciere.js";
import { simulerFraisNotaire } from "./simuler-frais-notaire.js";
import { consulterZonageImmobilier } from "./consulter-zonage-immobilier.js";

interface RechercherArgs {
  query: string;
  limit?: number;
}

export type QueryCategory =
  | "fiscalite_locale"
  | "doctrine_bofip"
  | "fiches_dila"
  | "transactions_dvf"
  | "simulation_tf"
  | "simulation_frais_notaire"
  | "zonage_immobilier";

/** Recherche unifiee : dispatche automatiquement vers la bonne source */
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
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const surface = extractSurface(query);
      const typeBien = extractTypeBien(query);
      const loc = communeName ? { commune: communeName } : codePostal ? { code_postal: codePostal } : null;

      if (loc && surface && typeBien) {
        const result = await simulerTaxeFonciere({ ...loc, surface, type_bien: typeBien });
        return prefixResult(result, "🧮 Simulation taxe fonciere");
      }

      if (loc) {
        const result = await consulterFiscaliteLocale(loc);
        return prefixResult(result, "📍 Fiscalite locale (parametres insuffisants pour simulation, utiliser `simuler_taxe_fonciere` avec surface et type de bien)");
      }

      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (service-public.fr)");
    }

    case "simulation_frais_notaire": {
      const prix = extractPrix(query);
      const typeAchat = extractTypeAchat(query);

      if (prix) {
        const result = await simulerFraisNotaire({ prix, type: typeAchat ?? "ancien" });
        const suffix = typeAchat ? "" : " (ancien par defaut)";
        return prefixResult(result, `🏠 Simulation frais de notaire${suffix}`);
      }

      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (precisez un montant pour simuler les frais de notaire via `simuler_frais_notaire`)");
    }

    case "zonage_immobilier": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      if (communeName) {
        const result = await consulterZonageImmobilier({ commune: communeName });
        return prefixResult(result, "📍 Zonage immobilier");
      }
      if (codePostal) {
        const result = await consulterZonageImmobilier({ code_postal: codePostal });
        return prefixResult(result, "📍 Zonage immobilier");
      }
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (precisez une commune pour le zonage via `consulter_zonage_immobilier`)");
    }

    case "transactions_dvf": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      const typeLocal = extractTypeLocal(query);
      if (communeName) {
        const result = await consulterTransactionsImmobilieres({ commune: communeName, type_local: typeLocal ?? undefined });
        return prefixResult(result, "🏠 Transactions immobilieres (DVF)");
      }
      if (codePostal) {
        const result = await consulterTransactionsImmobilieres({ code_postal: codePostal, type_local: typeLocal ?? undefined });
        return prefixResult(result, "🏠 Transactions immobilieres (DVF)");
      }
      const result = await rechercherFiche({ query, limit }, env);
      return prefixResult(result, "📋 Fiches pratiques (service-public.fr)");
    }

    case "fiscalite_locale": {
      const communeName = extractCommuneName(query);
      const codePostal = extractCodePostal(query);
      if (communeName) {
        const result = await consulterFiscaliteLocale({ commune: communeName });
        return prefixResult(result, "📍 Fiscalite locale");
      }
      if (codePostal) {
        const result = await consulterFiscaliteLocale({ code_postal: codePostal });
        return prefixResult(result, "📍 Fiscalite locale");
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

/** Classifie la requete pour router vers la bonne source */
export function classifyQuery(query: string): QueryCategory {
  const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Patterns simulation TF (avant fiscalite locale)
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

  // T15 -- Patterns frais de notaire (avant DVF)
  const fraisNotairePatterns = [
    /\bfrais\s+(de\s+)?notaire\b/,
    /\bfrais\s+d.?acquisition\b/,
    /\bdroits?\s+(de\s+)?mutation\b/,
    /\bsimuler?\b.*\bnotaire\b/,
    /\bcombien\b.*\bnotaire\b/,
    /\b(cout|montant)\b.*\bnotaire\b/,
    /\bemoluments?\b.*\bnotaire\b/,
    /\bdmto\b/,
  ];

  for (const pattern of fraisNotairePatterns) {
    if (pattern.test(q)) return "simulation_frais_notaire";
  }

  // T15 -- Patterns zonage immobilier (avant DVF)
  const zonagePatterns = [
    /\bzone\s+(abc|a\s*bis|pinel|tendue|detendue)\b/,
    /\bzonage\b.*\b(immobilier|abc|pinel|logement)\b/,
    /\bptz\b.*\b(eligible|zone|commune)\b/,
    /\bpinel\b.*\b(eligible|zone|commune)\b/,
    /\bdenormandie\b.*\b(eligible|zone)\b/,
    /\bplafond\b.*\b(loyer|ressource).*\b(pinel|zone)\b/,
    /\bzone\b.*\b(b1|b2|abis)\b/,
    /\blli\b.*\beligible\b/,
  ];

  for (const pattern of zonagePatterns) {
    if (pattern.test(q)) return "zonage_immobilier";
  }

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

  // Patterns fiscalite locale
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

/** Mots-cles thematiques a ne pas confondre avec des noms de commune */
const STOP_LOWER = new Set([
  "la", "le", "les", "des", "une", "un", "mon", "ma", "mes",
  "quel", "cette", "tout", "tous", "son", "ses",
  // mots-cles thematiques courants
  "taxe", "taux", "prix", "zone", "commune", "ville",
  "foncier", "fonciere", "immobilier", "immobiliere",
  "habitation", "impot", "fiscal", "fiscale",
]);

const STOP_UPPER = new Set([
  "TFB", "TFNB", "TEOM", "CFE", "TH", "TVA", "IR", "IS",
  "BOFIP", "REI", "DVF", "TF", "DMTO", "PTZ", "LLI", "ABC",
  "CEHR", "CSG", "CRDS", "PLM",
]);

/** Prefixes qui font partie du nom de commune (Le Mans, La Rochelle, Saint-Denis...) */
const COMMUNE_PREFIX = /^(?:saint|sainte|le|la|les|l')[\s-]?/i;

/** Tente d'extraire un nom de commune de la requete */
export function extractCommuneName(query: string): string | null {
  // 1. Patterns explicites : "a/de/pour/commune de/ville de COMMUNE"
  const explicitPatterns = [
    /(?:commune\s+de|ville\s+de|taux\s+(?:a|à|de|pour)|prix\s+(?:a|à|de|pour))\s+([a-zàâäéèêëïîôùûüÿç][a-zàâäéèêëïîôùûüÿç\s'-]{1,30})/i,
    /(?:à|a|de|pour)\s+([A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ][a-zàâäéèêëïîôùûüÿç][a-zàâäéèêëïîôùûüÿç\s'-]{0,28})/,
  ];

  for (const pattern of explicitPatterns) {
    const match = query.match(pattern);
    if (match?.[1]) {
      const candidate = cleanCommuneCandidate(match[1]);
      if (candidate) return candidate;
    }
  }

  // 2. Mot capitalise en debut de phrase ("Bondy taxe fonciere", "Saint-Denis taux")
  //    Continuation apres espace uniquement si mot capitalise ; apres tiret : tout mot
  const startMatch = query.match(
    /^((?:(?:Saint|Sainte|Le|La|Les|L')[\s-]?)?[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ][a-zàâäéèêëïîôùûüÿç]+(?:-[a-zàâäéèêëïîôùûüÿçA-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]+)*(?:\s[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ][a-zàâäéèêëïîôùûüÿç]+)?)\b/,
  );
  if (startMatch?.[1]) {
    const candidate = cleanCommuneCandidate(startMatch[1]);
    if (candidate) return candidate;
  }

  // 3. Nom compose avec tiret n'importe ou ("Saint-Denis", "Fontenay-sous-Bois")
  const hyphenMatch = query.match(
    /\b((?:(?:Saint|Sainte|Le|La|Les|L')[\s-]?)?[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇa-zàâäéèêëïîôùûüÿç]+-[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇa-zàâäéèêëïîôùûüÿç]+(?:-[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇa-zàâäéèêëïîôùûüÿç]+)*)\b/,
  );
  if (hyphenMatch?.[1]) {
    const candidate = cleanCommuneCandidate(hyphenMatch[1]);
    if (candidate) return candidate;
  }

  // 4. Mots tout en majuscules ("taux PARIS")
  const upperWords = query.match(/\b[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]{2,}(?:[\s-]+[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]{2,})*\b/g);
  if (upperWords?.length) {
    for (const candidate of upperWords) {
      if (!STOP_UPPER.has(candidate)) return candidate;
    }
  }

  return null;
}

/** Nettoie un candidat commune et verifie qu'il n'est pas un faux positif */
function cleanCommuneCandidate(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) return null;

  // Rejeter si c'est un stop word simple
  if (STOP_LOWER.has(trimmed.toLowerCase())) return null;

  // Rejeter si c'est un acronyme fiscal
  if (STOP_UPPER.has(trimmed.toUpperCase())) return null;

  return trimmed.toUpperCase();
}

/** Extrait un code postal 5 chiffres de la requete */
export function extractCodePostal(query: string): string | null {
  const match = query.match(/\b(\d{5})\b/);
  if (!match) return null;
  const cp = match[1];
  // Exclure les nombres qui ressemblent a des prix (> 97999) ou des surfaces
  const num = parseInt(cp, 10);
  if (num < 1000 || num > 97699) return null;
  return cp;
}

/** Extrait le type de bien immobilier de la requete */
export function extractTypeLocal(query: string): string | null {
  const q = query.toLowerCase();
  if (/\bappartement/.test(q)) return "Appartement";
  if (/\bmaison/.test(q)) return "Maison";
  if (/\blocal/.test(q)) return "Local industriel. commercial ou assimile";
  return null;
}

/** T15 -- Extrait un prix en euros de la requete */
export function extractPrix(query: string): number | null {
  // "250000 euros", "250 000 EUR", "250000EUR", "250 000€"
  const matchEuro = query.match(/(\d[\d\s.,]*\d)\s*(?:€|euros?\b|eur\b)/i);
  if (matchEuro) {
    const val = parseNumberFr(matchEuro[1]);
    if (val > 0 && val < 100_000_000) return val;
  }
  // "250k", "250k EUR"
  const matchK = query.match(/(\d+)\s*k\s*(?:€|euros?|eur)?\b/i);
  if (matchK) {
    const val = parseInt(matchK[1], 10) * 1000;
    if (val > 0 && val < 100_000_000) return val;
  }
  // Nombre seul > 10000 dans un contexte frais notaire (deja route)
  const matchBare = query.match(/\b(\d{5,8})\b/);
  if (matchBare) {
    const val = parseInt(matchBare[1], 10);
    if (val >= 10_000 && val < 100_000_000) return val;
  }
  return null;
}

/** T15 -- Extrait le type d'achat ancien/neuf */
export function extractTypeAchat(query: string): "ancien" | "neuf" | null {
  const q = query.toLowerCase();
  if (/\bneuf\b/.test(q) || /\bvefa\b/.test(q)) return "neuf";
  if (/\bancien\b/.test(q)) return "ancien";
  return null;
}

/** Extrait une surface en m2 de la requete */
function extractSurface(query: string): number | null {
  const match = query.match(/(\d+)\s*m[²2]?\b/i);
  if (match) {
    const surface = parseInt(match[1], 10);
    if (surface > 0 && surface < 10000) return surface;
  }
  return null;
}

/** Extrait le type de bien (Maison/Appartement) */
function extractTypeBien(query: string): "Maison" | "Appartement" | null {
  const q = query.toLowerCase();
  if (/\bmaison\b/.test(q)) return "Maison";
  if (/\b(appartement|appart|studio|f[1-6]|t[1-6])\b/.test(q)) return "Appartement";
  return null;
}

/** Nettoie et parse un nombre au format FR ("250 000" ou "250.000" ou "250,000") */
function parseNumberFr(raw: string): number {
  const cleaned = raw.replace(/[\s.,]/g, "");
  return parseInt(cleaned, 10) || 0;
}

function prefixResult(result: ToolResult, sourceLabel: string): ToolResult {
  if (result.isError) return result;
  const text = result.content[0]?.text ?? "";
  return {
    content: [{ type: "text", text: `_Recherche via : ${sourceLabel}_\n\n${text}` }],
  };
}
