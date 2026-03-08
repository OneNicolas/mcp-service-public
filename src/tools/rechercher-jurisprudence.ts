/**
 * T66 — rechercher_jurisprudence
 * Recherche de jurisprudence judiciaire francaise.
 * Utilise l'API PISTE Legifrance officielle via LegifranceClient (fond JURI / CAPP).
 */

import type { ToolResult, Env } from "../types.js";
import { searchJuri, LegifranceClientError } from "../utils/legifrance-client.js";

export type JuridictionType = "Cour de cassation" | "Cours d'appel" | "Toutes";

interface JurisprudenceArgs {
  recherche: string;
  juridiction?: JuridictionType;
  publie_bulletin?: boolean;
  limit?: number;
}

export async function rechercherJurisprudence(args: JurisprudenceArgs, env?: Env): Promise<ToolResult> {
  const { recherche, juridiction = "Toutes", publie_bulletin, limit = 5 } = args;

  if (!recherche || recherche.trim().length < 3) {
    return {
      content: [{ type: "text", text: "Veuillez fournir des termes de recherche (ex: 'licenciement abusif', 'prejudice moral')." }],
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

  // Fond CAPP = cours d'appel ; JURI = Cour de cassation (defaut)
  const fondJuridiction = juridiction === "Cours d'appel" ? "CAPP" : undefined;

  // Publication bulletin : uniquement pour Cour de cassation
  const publicationBulletin =
    publie_bulletin !== undefined && juridiction === "Cour de cassation"
      ? (publie_bulletin ? "T" : "F") as "T" | "F"
      : undefined;

  try {
    const text = await searchJuri(env.PISTE_CLIENT_ID, env.PISTE_CLIENT_SECRET, {
      query: recherche.trim(),
      pageSize: clampedLimit,
      juridiction: fondJuridiction,
      publicationBulletin,
    });

    const header = buildHeader(recherche, juridiction, publie_bulletin);
    return {
      content: [{ type: "text", text: `${header}\n\n${text}\n\n_Source : Legifrance / API PISTE officielle_` }],
    };
  } catch (err) {
    if (err instanceof LegifranceClientError) {
      return { content: [{ type: "text", text: `Legifrance indisponible : ${err.message}` }], isError: true };
    }
    const msg = err instanceof Error ? err.message : "inconnue";
    return {
      content: [{ type: "text", text: `Erreur lors de la recherche de jurisprudence : ${msg}` }],
      isError: true,
    };
  }
}

function buildHeader(
  recherche: string,
  juridiction: JuridictionType,
  publieBulletin: boolean | undefined,
): string {
  const parts = [`Jurisprudence — "${recherche}"`];
  if (juridiction !== "Toutes") parts.push(juridiction);
  if (publieBulletin !== undefined) parts.push(publieBulletin ? "Publiee au bulletin" : "Non publiee");
  return parts.join(" | ");
}
