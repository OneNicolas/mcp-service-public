/**
 * T72 — consulter_journal_officiel
 * Recherche dans le Journal Officiel de la Republique Francaise (JORF).
 * Utilise l'API PISTE Legifrance officielle via LegifranceClient (fond JORF).
 *
 * Pourquoi PISTE et non le site jorf.legifrance.gouv.fr :
 *   L'API PISTE est l'interface officielle DILA pour le JORF, avec recherche plein texte
 *   et filtrage par nature/date. Elle est deja integree via le LegifranceClient existant.
 */

import type { ToolResult, Env } from "../types.js";
import { searchJorf, LegifranceClientError } from "../utils/legifrance-client.js";

type NatureTexte = "LOI" | "DECRET" | "ARRETE" | "ORDONNANCE" | "CIRCULAIRE" | "AVIS" | "DECISION";

interface JournalOfficielArgs {
  recherche: string;
  type_texte?: NatureTexte;
  date_debut?: string;
  date_fin?: string;
  limit?: number;
}

export async function consulterJournalOfficiel(args: JournalOfficielArgs, env?: Env): Promise<ToolResult> {
  const { recherche, type_texte, date_debut, date_fin, limit = 5 } = args;

  if (!recherche || recherche.trim().length < 2) {
    return {
      content: [{ type: "text", text: "Precisez des termes de recherche (ex: 'teletravail', 'loi n 2024', 'protection donnees')." }],
      isError: true,
    };
  }

  if (!env?.PISTE_CLIENT_ID || !env?.PISTE_CLIENT_SECRET) {
    return {
      content: [{ type: "text", text: "Configuration Legifrance manquante (PISTE_CLIENT_ID / PISTE_CLIENT_SECRET)." }],
      isError: true,
    };
  }

  // Validation du format de date si fourni
  if (date_debut && !/^\d{4}-\d{2}-\d{2}$/.test(date_debut)) {
    return {
      content: [{ type: "text", text: "Format de date invalide pour date_debut. Utilisez le format YYYY-MM-DD (ex: '2024-01-01')." }],
      isError: true,
    };
  }

  if (date_fin && !/^\d{4}-\d{2}-\d{2}$/.test(date_fin)) {
    return {
      content: [{ type: "text", text: "Format de date invalide pour date_fin. Utilisez le format YYYY-MM-DD (ex: '2024-12-31')." }],
      isError: true,
    };
  }

  const clampedLimit = Math.min(Math.max(limit, 1), 20);

  try {
    const text = await searchJorf(env.PISTE_CLIENT_ID, env.PISTE_CLIENT_SECRET, {
      query: recherche.trim(),
      pageSize: clampedLimit,
      sort: date_debut || date_fin ? "DATE_DESC" : "PERTINENCE",
      nature: type_texte,
      dateDebut: date_debut,
      dateFin: date_fin,
    });

    const header = buildHeader(recherche, type_texte, date_debut, date_fin);

    return {
      content: [{
        type: "text",
        text: `${header}\n\n${text}\n\n_Source : Journal Officiel — API PISTE officielle DILA/Legifrance_`,
      }],
    };
  } catch (err) {
    if (err instanceof LegifranceClientError) {
      return {
        content: [{ type: "text", text: `Legifrance indisponible : ${err.message}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: "Erreur lors de la recherche dans le Journal Officiel. Reessayez dans quelques instants." }],
      isError: true,
    };
  }
}

function buildHeader(
  recherche: string,
  typeTexte: NatureTexte | undefined,
  dateDebut: string | undefined,
  dateFin: string | undefined,
): string {
  const parts = [`Journal Officiel (JORF) — "${recherche}"`];
  if (typeTexte) parts.push(typeTexte);
  if (dateDebut && dateFin) parts.push(`du ${dateDebut} au ${dateFin}`);
  else if (dateDebut) parts.push(`depuis ${dateDebut}`);
  else if (dateFin) parts.push(`jusqu'au ${dateFin}`);
  return parts.join(" | ");
}
