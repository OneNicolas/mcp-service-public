import type { Env, Fiche, ReferenceLegale, ServiceEnLigne, ToolResult } from "../types.js";

interface LireFicheArgs {
  fiche_id: string;
}

/** Read a specific fiche pratique by its ID */
export async function lireFiche(
  args: LireFicheArgs,
  env: Env,
): Promise<ToolResult> {
  const id = args.fiche_id.toUpperCase().trim();

  try {
    const result = await env.DB.prepare(
      `SELECT * FROM fiches WHERE id = ?`,
    )
      .bind(id)
      .first<Fiche>();

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: `Fiche "${id}" introuvable. V\u00e9rifiez l'identifiant (ex: F14929, N360).`,
          },
        ],
      };
    }

    const sections: string[] = [
      `# ${result.titre}`,
      "",
    ];

    if (result.description) {
      sections.push(result.description, "");
    }

    const meta: string[] = [];
    if (result.sujet) meta.push(`**Sujet** : ${result.sujet}`);
    if (result.audience) meta.push(`**Public** : ${result.audience}`);
    if (result.theme_titre) meta.push(`**Th\u00e8me** : ${result.theme_titre}`);
    if (result.sous_theme) meta.push(`**Sous-th\u00e8me** : ${result.sous_theme}`);
    if (result.dossier_titre) meta.push(`**Dossier** : ${result.dossier_titre}`);
    if (result.url) meta.push(`**URL** : ${result.url}`);
    if (result.date_modification) meta.push(`**Mise \u00e0 jour** : ${result.date_modification}`);
    if (meta.length) {
      sections.push(...meta, "");
    }

    if (result.contenu_texte) {
      sections.push("## Contenu", "", truncateText(result.contenu_texte, 3000), "");
    }

    if (result.services_en_ligne) {
      const services = safeParseJson<ServiceEnLigne[]>(result.services_en_ligne, []);
      if (services.length) {
        sections.push("## Services en ligne", "");
        for (const s of services) {
          const label = s.type ? `[${s.type}]` : "";
          const url = s.url ? ` \u2014 ${s.url}` : "";
          sections.push(`- **${s.titre}** ${label}${url}`);
        }
        sections.push("");
      }
    }

    if (result.references_legales) {
      const refs = safeParseJson<ReferenceLegale[]>(result.references_legales, []);
      if (refs.length) {
        sections.push("## R\u00e9f\u00e9rences l\u00e9gales", "");
        for (const r of refs) {
          const url = r.url ? ` \u2014 ${r.url}` : "";
          sections.push(`- ${r.titre}${url}`);
        }
        sections.push("");
      }
    }

    if (result.liens_internes) {
      const liens = safeParseJson<string[]>(result.liens_internes, []);
      if (liens.length) {
        sections.push("## Fiches li\u00e9es", "");
        sections.push(liens.join(", "));
      }
    }

    return { content: [{ type: "text", text: sections.join("\n") }] };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Erreur : ${error instanceof Error ? error.message : "inconnue"}`,
        },
      ],
      isError: true,
    };
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "\n\n[... contenu tronqu\u00e9, utilisez l'URL pour la version compl\u00e8te]";
}

function safeParseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
