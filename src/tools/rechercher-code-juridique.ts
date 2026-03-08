/**
 * T65 — rechercher_code_juridique
 * Recherche d'articles dans les codes de loi francais.
 * Utilise l'API PISTE Legifrance officielle via LegifranceClient (fond CODE).
 */

import type { ToolResult, Env } from "../types.js";
import { searchCode, LegifranceClientError } from "../utils/legifrance-client.js";

export type ChampCode = "ALL" | "TITLE" | "ARTICLE" | "NUM_ARTICLE";

interface CodeJuridiqueArgs {
  recherche: string;
  code: string;
  champ?: ChampCode;
  type_recherche?: "TOUS_LES_MOTS_DANS_UN_CHAMP" | "EXACTE" | "UN_DES_MOTS";
  limit?: number;
}

export async function rechercherCodeJuridique(args: CodeJuridiqueArgs, env?: Env): Promise<ToolResult> {
  const { recherche, code, champ = "ALL", type_recherche = "TOUS_LES_MOTS_DANS_UN_CHAMP", limit = 5 } = args;

  if (!recherche || recherche.trim().length < 2) {
    return {
      content: [{ type: "text", text: "Veuillez fournir des termes de recherche (ex: 'contrat de travail', 'legitime defense')." }],
      isError: true,
    };
  }

  if (!code || code.trim().length < 3) {
    return {
      content: [{ type: "text", text: "Veuillez preciser un code juridique (ex: 'Code civil', 'Code du travail', 'Code penal')." }],
      isError: true,
    };
  }

  if (!env?.PISTE_CLIENT_ID || !env?.PISTE_CLIENT_SECRET) {
    return {
      content: [{ type: "text", text: "Configuration Legifrance manquante (PISTE_CLIENT_ID / PISTE_CLIENT_SECRET)." }],
      isError: true,
    };
  }

  const clampedLimit = Math.min(Math.max(limit, 1), 20);

  try {
    const text = await searchCode(env.PISTE_CLIENT_ID, env.PISTE_CLIENT_SECRET, {
      query: recherche.trim(),
      champ,
      typeRecherche: type_recherche,
      pageSize: clampedLimit,
      codeName: code.trim(),
    });

    const header = `${code} — "${recherche}"${champ !== "ALL" ? ` | Champ : ${champ}` : ""}`;
    return {
      content: [{ type: "text", text: `${header}\n\n${text}\n\n_Source : Legifrance / API PISTE officielle_` }],
    };
  } catch (err) {
    if (err instanceof LegifranceClientError) {
      const suggestion = buildCodeSuggestion(code);
      return {
        content: [{ type: "text", text: `Legifrance indisponible : ${err.message}\n\n${suggestion}` }],
        isError: true,
      };
    }
    const msg = err instanceof Error ? err.message : "inconnue";
    return {
      content: [{ type: "text", text: `Erreur lors de la recherche dans les codes juridiques : ${msg}` }],
      isError: true,
    };
  }
}

/** Propose des noms de codes courants si le code saisi semble invalide */
function buildCodeSuggestion(codeSaisi: string): string {
  const CODES_COURANTS = [
    "Code civil", "Code du travail", "Code penal", "Code de commerce",
    "Code de la securite sociale", "Code general des impots",
    "Code de procedure civile", "Code de procedure penale",
    "Code de l'urbanisme", "Code de l'environnement",
    "Code de la consommation", "Code de l'education",
  ];

  const q = codeSaisi.toLowerCase();
  const suggestions = CODES_COURANTS.filter((c) =>
    c.toLowerCase().includes(q) || q.includes(c.toLowerCase().replace("code ", ""))
  );

  if (suggestions.length > 0) {
    return `Codes similaires disponibles :\n${suggestions.map((c) => `- ${c}`).join("\n")}`;
  }

  return `Codes courants : ${CODES_COURANTS.slice(0, 6).join(", ")}`;
}
