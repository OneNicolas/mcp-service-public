import type { Env, ToolResult } from "./types.js";
import { rechercherFiche } from "./tools/rechercher-fiche.js";
import { lireFiche } from "./tools/lire-fiche.js";
import { rechercherServiceLocal } from "./tools/rechercher-service-local.js";
import { naviguerThemes } from "./tools/naviguer-themes.js";
import { consulterFiscaliteLocale } from "./tools/consulter-fiscalite-locale.js";
import { rechercherDoctrineFiscale } from "./tools/rechercher-doctrine-fiscale.js";
import { rechercher } from "./tools/rechercher.js";
import { consulterTransactionsImmobilieres } from "./tools/consulter-transactions-immobilieres.js";
import { simulerTaxeFonciere } from "./tools/simuler-taxe-fonciere.js";
import { simulerFraisNotaire } from "./tools/simuler-frais-notaire.js";
import { consulterZonageImmobilier } from "./tools/consulter-zonage-immobilier.js";
import { comparerCommunes } from "./tools/comparer-communes.js";
import { syncDilaFull } from "./sync/dila-sync.js";

const VERSION = "0.8.1";

// --- Tool definitions for tools/list ---

const TOOLS = [
  {
    name: "rechercher",
    description:
      "Recherche unifi\u00e9e intelligente dans les sources service-public.fr. Dispatche automatiquement selon la nature de la question : fiches pratiques DILA (d\u00e9marches/droits), doctrine fiscale BOFiP, fiscalit\u00e9 locale (taux par commune), transactions immobili\u00e8res DVF, simulation de taxe fonci\u00e8re, simulation de frais de notaire, ou zonage immobilier ABC (Pinel, PTZ). \u00c0 utiliser en premier si la source appropri\u00e9e n'est pas \u00e9vidente.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Question ou termes de recherche en langage naturel (ex: 'taxe fonci\u00e8re \u00e0 Lyon', 'renouveler passeport', 'prix immobilier \u00e0 Bondy', 'frais de notaire 250000 euros', 'zone Pinel Bordeaux')" },
        limit: { type: "number", description: "Nombre de r\u00e9sultats (1-10, d\u00e9faut 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "rechercher_fiche",
    description:
      "Recherche dans les fiches pratiques de service-public.fr (droits, d\u00e9marches administratives). Utilise la recherche plein texte.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Termes de recherche (ex: 'passeport', 'allocation logement')" },
        theme: { type: "string", description: "Filtrer par th\u00e8me (ex: 'Papiers', 'Logement')" },
        audience: { type: "string", enum: ["Particuliers", "Professionnels", "Associations"], description: "Public cible" },
        limit: { type: "number", description: "Nombre de r\u00e9sultats (1-20, d\u00e9faut 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "lire_fiche",
    description:
      "Lit le contenu complet d'une fiche pratique par son identifiant (ex: F14929 pour le passeport).",
    inputSchema: {
      type: "object" as const,
      properties: {
        fiche_id: { type: "string", description: "Identifiant de la fiche (ex: F14929, N360, R42946)" },
      },
      required: ["fiche_id"],
    },
  },
  {
    name: "rechercher_service_local",
    description:
      "Recherche un service public local (mairie, pr\u00e9fecture, CAF, CPAM, France Services...) via l'Annuaire de l'administration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type_organisme: { type: "string", description: "Type de service (ex: 'mairie', 'prefecture', 'caf')" },
        code_postal: { type: "string", description: "Code postal (ex: '75001')" },
        commune: { type: "string", description: "Nom de la commune" },
        code_insee: { type: "string", description: "Code INSEE de la commune" },
        limit: { type: "number", description: "Nombre de r\u00e9sultats (1-20, d\u00e9faut 5)" },
      },
    },
  },
  {
    name: "naviguer_themes",
    description:
      "Parcourt l'arborescence th\u00e9matique de service-public.fr. Sans param\u00e8tre, liste les th\u00e8mes principaux.",
    inputSchema: {
      type: "object" as const,
      properties: {
        theme_id: { type: "string", description: "ID du th\u00e8me \u00e0 explorer (ex: N19810, N360)" },
      },
    },
  },
  {
    name: "consulter_fiscalite_locale",
    description:
      "Consulte les taux d'imposition locale d'une commune (taxe fonci\u00e8re, taxe d'habitation, TEOM, CFE). Accepte un nom de commune, un code INSEE ou un code postal. Sans exercice pr\u00e9cis\u00e9, affiche l'\u00e9volution sur 4 ans avec tendance. Donn\u00e9es REI de la DGFiP via data.economie.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'PARIS', 'LYON')" },
        communes: {
          type: "array",
          items: { type: "string" },
          description: "Liste de communes \u00e0 comparer (2-5 noms en majuscules, ex: ['PARIS', 'LYON', 'MARSEILLE']). Active le mode comparaison c\u00f4te \u00e0 c\u00f4te.",
          maxItems: 5,
          minItems: 2,
        },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '75056', '69123')" },
        code_postal: { type: "string", description: "Code postal (ex: '93140', '75001'). R\u00e9sout automatiquement vers le(s) code(s) INSEE." },
        exercice: { type: "string", description: "Ann\u00e9e fiscale (ex: '2024'). Sans exercice : affiche l'\u00e9volution sur toutes les ann\u00e9es disponibles." },
        type: { type: "string", enum: ["particuliers", "entreprises"], description: "Type de fiscalit\u00e9 (d\u00e9faut: particuliers)" },
      },
    },
  },
  {
    name: "rechercher_doctrine_fiscale",
    description:
      "Recherche dans la doctrine fiscale officielle (BOFiP - Bulletin Officiel des Finances Publiques). Couvre IR, TVA, IS, plus-values, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Termes de recherche (ex: 'plus-values immobili\u00e8res', 'cr\u00e9dit imp\u00f4t recherche')" },
        serie: { type: "string", description: "Filtrer par s\u00e9rie BOFiP (ex: 'IR', 'TVA', 'IS', 'RFPI', 'BIC')" },
        limit: { type: "number", description: "Nombre de r\u00e9sultats (1-10, d\u00e9faut 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "consulter_transactions_immobilieres",
    description:
      "Consulte les transactions immobili\u00e8res (DVF - Demandes de Valeurs Fonci\u00e8res) d'une commune. Fournit prix m\u00e9dians, prix au m\u00b2, r\u00e9partition par type de bien et nombre de pi\u00e8ces. Donn\u00e9es DGFiP via data.gouv.fr. Hors Alsace, Moselle et Mayotte.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Bondy', 'Lyon')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '93010')" },
        code_postal: { type: "string", description: "Code postal (ex: '93140'). R\u00e9sout automatiquement vers le(s) code(s) INSEE." },
        type_local: { type: "string", enum: ["Appartement", "Maison", "Local industriel. commercial ou assimil\u00e9"], description: "Filtrer par type de bien" },
        annee: { type: "number", description: "Filtrer sur une ann\u00e9e sp\u00e9cifique (ex: 2024). Par d\u00e9faut : 2 derni\u00e8res ann\u00e9es." },
      },
    },
  },
  {
    name: "simuler_taxe_fonciere",
    description:
      "Estime la taxe fonci\u00e8re annuelle d'un bien immobilier. Combine les vrais taux communaux (REI DGFiP) avec une estimation de la valeur locative cadastrale ajust\u00e9e au march\u00e9 local via les transactions DVF. Accepte un nom de commune, un code INSEE ou un code postal. R\u00e9sultat indicatif uniquement.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bordeaux')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '69123')" },
        code_postal: { type: "string", description: "Code postal (ex: '33000'). R\u00e9sout automatiquement vers le code INSEE." },
        surface: { type: "number", description: "Surface habitable en m\u00b2 (ex: 75)" },
        type_bien: { type: "string", enum: ["Maison", "Appartement"], description: "Type de bien immobilier" },
        nombre_pieces: { type: "number", description: "Nombre de pi\u00e8ces principales (optionnel, estim\u00e9 si absent)" },
        annee_construction: { type: "number", description: "Ann\u00e9e de construction (optionnel, influence le coefficient d'entretien)" },
      },
      required: ["surface", "type_bien"],
    },
  },
  {
    name: "simuler_frais_notaire",
    description:
      "Estime les frais de notaire (frais d'acquisition) pour un achat immobilier. Calcule les droits de mutation (DMTO), \u00e9moluments du notaire (bar\u00e8me d\u00e9gressif r\u00e9glement\u00e9), contribution de s\u00e9curit\u00e9 immobili\u00e8re et d\u00e9bours. Distingue ancien (7-8 %) et neuf (2-3 %). Si le d\u00e9partement est pr\u00e9cis\u00e9, applique le taux DMTO exact (normal 5,81 % ou major\u00e9 6,32 % selon le d\u00e9partement, LF 2025). Sans d\u00e9partement, affiche les deux hypoth\u00e8ses. Accepte un code d\u00e9partement, un code postal ou un num\u00e9ro de d\u00e9partement.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prix: { type: "number", description: "Prix d'achat du bien en euros (ex: 250000)" },
        type: { type: "string", enum: ["ancien", "neuf"], description: "Type de bien : ancien ou neuf" },
        departement: { type: "string", description: "D\u00e9partement (code 2-3 chiffres, code postal 5 chiffres, ou '2A'/'2B' pour la Corse). Permet d'appliquer le taux DMTO exact." },
      },
      required: ["prix", "type"],
    },
  },
  {
    name: "consulter_zonage_immobilier",
    description:
      "Consulte la zone ABC d'une commune (A bis, A, B1, B2, C) utilis\u00e9e pour les dispositifs immobiliers (Pinel, PTZ, plafonds loyers). Accepte un nom de commune, un code INSEE ou un code postal. Retourne la zone, les plafonds de loyer, les plafonds de ressources et l'\u00e9ligibilit\u00e9 aux dispositifs. Source : Minist\u00e8re de la Transition \u00e9cologique via data.gouv.fr.",
    inputSchema: {
      type: "object" as const,
      properties: {
        commune: { type: "string", description: "Nom de la commune (ex: 'Lyon', 'Bordeaux')" },
        code_insee: { type: "string", description: "Code INSEE de la commune (ex: '69123')" },
        code_postal: { type: "string", description: "Code postal (ex: '33000'). R\u00e9sout automatiquement vers le code INSEE." },
      },
    },
  },
  {
    name: "comparer_communes",
    description:
      "Compare 2 \u00e0 5 communes sur un tableau crois\u00e9 : fiscalit\u00e9 locale (taux TFB, TEOM), prix immobiliers (DVF m\u00e9dian/m\u00b2 appart et maison), zonage ABC, nombre de services publics locaux (mairies, CAF, CPAM...) et intercommunalit\u00e9. Aide \u00e0 la d\u00e9cision pour un d\u00e9m\u00e9nagement ou un investissement. Accepte des noms de communes, codes postaux ou codes INSEE.",
    inputSchema: {
      type: "object" as const,
      properties: {
        communes: {
          type: "array",
          items: { type: "string" },
          description: "Liste de 2 \u00e0 5 communes \u00e0 comparer (noms, codes postaux ou codes INSEE). Ex: ['Lyon', 'Bordeaux', 'Nantes']",
          minItems: 2,
          maxItems: 5,
        },
      },
      required: ["communes"],
    },
  },
];

// --- Tool execution dispatcher ---

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
): Promise<ToolResult> {
  switch (name) {
    case "rechercher":
      return rechercher(args as { query: string; limit?: number }, env);
    case "rechercher_fiche":
      return rechercherFiche(args as { query: string; theme?: string; audience?: string; limit?: number }, env);
    case "lire_fiche":
      return lireFiche(args as { fiche_id: string }, env);
    case "rechercher_service_local":
      return rechercherServiceLocal(args as { type_organisme?: string; code_postal?: string; commune?: string; code_insee?: string; limit?: number });
    case "naviguer_themes":
      return naviguerThemes(args as { theme_id?: string }, env);
    case "consulter_fiscalite_locale":
      return consulterFiscaliteLocale(args as { commune?: string; communes?: string[]; code_insee?: string; code_postal?: string; exercice?: string; type?: "particuliers" | "entreprises" });
    case "rechercher_doctrine_fiscale":
      return rechercherDoctrineFiscale(args as { query: string; serie?: string; limit?: number });
    case "consulter_transactions_immobilieres":
      return consulterTransactionsImmobilieres(args as { commune?: string; code_insee?: string; code_postal?: string; type_local?: string; annee?: number });
    case "simuler_taxe_fonciere":
      return simulerTaxeFonciere(args as { commune?: string; code_insee?: string; code_postal?: string; surface: number; type_bien: "Maison" | "Appartement"; nombre_pieces?: number; annee_construction?: number });
    case "simuler_frais_notaire":
      return simulerFraisNotaire(args as { prix: number; type: "ancien" | "neuf"; departement?: string });
    case "consulter_zonage_immobilier":
      return consulterZonageImmobilier(args as { commune?: string; code_insee?: string; code_postal?: string });
    case "comparer_communes":
      return comparerCommunes(args as { communes: string[] });
    default:
      return { content: [{ type: "text", text: `Outil inconnu: ${name}` }], isError: true };
  }
}

// --- Streamable HTTP MCP handler ---

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

function jsonRpcResponse(id: number | string | undefined, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(id: number | string | undefined, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleMcpPost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as JsonRpcRequest;

  switch (body.method) {
    case "initialize":
      return jsonRpcResponse(body.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "service-public", version: VERSION },
      });

    case "notifications/initialized":
      return new Response(null, { status: 204 });

    case "ping":
      return jsonRpcResponse(body.id, {});

    case "tools/list":
      return jsonRpcResponse(body.id, { tools: TOOLS });

    case "tools/call": {
      const params = body.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return jsonRpcError(body.id, -32602, "Missing tool name");
      }
      try {
        const result = await executeTool(params.name, params.arguments || {}, env);
        return jsonRpcResponse(body.id, result);
      } catch (error) {
        return jsonRpcResponse(body.id, {
          content: [{ type: "text", text: `Erreur: ${error instanceof Error ? error.message : "inconnue"}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`);
  }
}

// --- Main fetch handler ---

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
        },
      });
    }

    // T14 — Health check enrichi
    if (url.pathname === "/health") {
      const lastSync = await env.DB.prepare(
        `SELECT completed_at, fiches_count, status FROM sync_log WHERE status = 'completed' ORDER BY id DESC LIMIT 1`,
      ).first<{ completed_at: string; fiches_count: number; status: string }>();

      const ficheCount = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM fiches`,
      ).first<{ total: number }>();

      const lastError = await env.DB.prepare(
        `SELECT started_at, status, error_message FROM sync_log WHERE status != 'completed' ORDER BY id DESC LIMIT 1`,
      ).first<{ started_at: string; status: string; error_message: string | null }>();

      return Response.json({
        status: "ok",
        service: "mcp-service-public",
        version: VERSION,
        tools_count: TOOLS.length,
        tools: TOOLS.map((t) => t.name),
        fiches_count: ficheCount?.total ?? 0,
        last_sync: lastSync
          ? { completed_at: lastSync.completed_at, fiches_count: lastSync.fiches_count }
          : null,
        last_error: lastError
          ? { at: lastError.started_at, status: lastError.status, message: lastError.error_message }
          : null,
      });
    }

    // Service description
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json({
        name: "mcp-service-public",
        description: "MCP Server pour les donn\u00e9es de service-public.fr",
        version: VERSION,
        mcp_endpoint: "/mcp",
        transport: "streamable-http",
        tools: TOOLS.map((t) => t.name),
        source: "https://github.com/OneNicolas/mcp-service-public",
      });
    }

    // MCP Streamable HTTP endpoint
    if (url.pathname === "/mcp" && request.method === "POST") {
      const resp = await handleMcpPost(request, env);
      resp.headers.set("Access-Control-Allow-Origin", "*");
      return resp;
    }

    // MCP GET (SSE for server notifications — not needed, but acknowledge)
    if (url.pathname === "/mcp" && request.method === "GET") {
      return new Response("SSE not implemented", { status: 405 });
    }

    // MCP DELETE (session termination — stateless, just accept)
    if (url.pathname === "/mcp" && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    // Full sync trigger
    if (url.pathname === "/admin/sync/full" && request.method === "POST") {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      try {
        const result = await syncDilaFull(env);
        return Response.json(result);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : "unknown" },
          { status: 500 },
        );
      }
    }

    // Sync status
    if (url.pathname === "/admin/sync" && request.method === "GET") {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const logs = await env.DB.prepare(
        `SELECT * FROM sync_log ORDER BY id DESC LIMIT 5`,
      ).all();

      const count = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM fiches`,
      ).first<{ total: number }>();

      return Response.json({
        fiches_in_db: count?.total ?? 0,
        recent_syncs: logs.results,
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log("Cron: starting daily DILA full sync...");
    try {
      const result = await syncDilaFull(env);
      console.log(
        `Cron sync done: ${result.fichesInserted} fiches, ${result.themesCount} themes in ${result.durationMs}ms`,
      );
    } catch (error) {
      console.error("Cron sync failed:", error);
    }
  },
};
