/**
 * T64 — rechercher_texte_legal
 * Recherche dans les textes legislatifs et reglementaires (lois, decrets, arretes, ordonnances).
 * Utilise l'API PISTE Legifrance officielle via LegifranceClient (fond LODA).
 */

import type { ToolResult } from "../types.js";
import type { Env } from "../types.js";
import { searchLoda, LegifranceClientError } from "../utils/legifrance-client.js";

export type ChampTexteLegal = "ALL" | "TITLE" | "ARTICLE" | "NUM_ARTICLE";

interface TexteLegalArgs {
  recherche: string;
  champ?: ChampTexteLegal;
  type_recherche?: "TOUS_LES_MOTS_DANS_UN_CHAMP" | "EXACTE" | "UN_DES_MOT";
  limit?: number;
}

export async function rechercherTexteLegal(args: TexteLegalArgs, env?: Env): Promise<ToolResult> {
  const { recherche, champ = "ALL", type_recherche = "TOUS_LES_MOTS_DANS_UN_CHAMP", limit = 5 } = args;

  if (!recherche || recherche.trim().length < 2) {
    return {
      content: [{ type: "text", text: "Veuillez fournir des termes de recherche (ex: 'protection donnees personnelles', 'teletravail')." }],
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
    const text = await searchLoda(env.PISTE_CLIENT_ID, env.PISTE_CLIENT_SECRET, {
      query: recherche.trim(),
      champ,
      typeRecherche: type_recherche,
      pageSize: clampedLimit,
    });

    const header = buildHeader(recherche, champ);
    return {
      content: [{ type: "text", text: `${header}\n\n${text}\n\n_Source : Legifrance / API PISTE officielle_` }],
    };
  } catch (err) {
    if (err instanceof LegifranceClientError) {
      return { content: [{ type: "text", text: `Legifrance indisponible : ${err.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: "Erreur lors de la recherche dans les textes legaux. Reessayez dans quelques instants." }],
      isError: true,
    };
  }
}

function buildHeader(recherche: string, champ: ChampTexteLegal): string {
  const parts = [`Textes legaux — "${recherche}"`];
  if (champ !== "ALL") parts.push(`Champ : ${champ}`);
  return parts.join(" | ");
}
