import type { Env, ToolResult } from "./types.js";
import { rechercherFiche } from "./tools/rechercher-fiche.js";
import { lireFiche } from "./tools/lire-fiche.js";
import { rechercherServiceLocal } from "./tools/rechercher-service-local.js";
import { naviguerThemes } from "./tools/naviguer-themes.js";
import { syncDilaFull } from "./sync/dila-sync.js";

const VERSION = "0.2.0";

// --- Tool definitions for tools/list ---

const TOOLS = [
  {
    name: "rechercher_fiche",
    description:
      "Recherche dans les fiches pratiques de service-public.fr (droits, démarches administratives). Utilise la recherche plein texte.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Termes de recherche (ex: 'passeport', 'allocation logement')" },
        theme: { type: "string", description: "Filtrer par thème (ex: 'Papiers', 'Logement')" },
        audience: { type: "string", enum: ["Particuliers", "Professionnels", "Associations"], description: "Public cible" },
        limit: { type: "number", description: "Nombre de résultats (1-20, défaut 10)" },
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
      "Recherche un service public local (mairie, préfecture, CAF, CPAM, France Services...) via l'Annuaire de l'administration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type_organisme: { type: "string", description: "Type de service (ex: 'mairie', 'prefecture', 'caf')" },
        code_postal: { type: "string", description: "Code postal (ex: '75001')" },
        commune: { type: "string", description: "Nom de la commune" },
        code_insee: { type: "string", description: "Code INSEE de la commune" },
        limit: { type: "number", description: "Nombre de résultats (1-20, défaut 5)" },
      },
    },
  },
  {
    name: "naviguer_themes",
    description:
      "Parcourt l'arborescence thématique de service-public.fr. Sans paramètre, liste les thèmes principaux.",
    inputSchema: {
      type: "object" as const,
      properties: {
        theme_id: { type: "string", description: "ID du thème à explorer (ex: N19810, N360)" },
      },
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
    case "rechercher_fiche":
      return rechercherFiche(args as { query: string; theme?: string; audience?: string; limit?: number }, env);
    case "lire_fiche":
      return lireFiche(args as { fiche_id: string }, env);
    case "rechercher_service_local":
      return rechercherServiceLocal(args as { type_organisme?: string; code_postal?: string; commune?: string; code_insee?: string; limit?: number });
    case "naviguer_themes":
      return naviguerThemes(args as { theme_id?: string }, env);
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

    // Health check with last sync info
    if (url.pathname === "/health") {
      const lastSync = await env.DB.prepare(
        `SELECT completed_at, fiches_count, status FROM sync_log WHERE status = 'completed' ORDER BY id DESC LIMIT 1`,
      ).first<{ completed_at: string; fiches_count: number; status: string }>();

      const ficheCount = await env.DB.prepare(
        `SELECT COUNT(*) as total FROM fiches`,
      ).first<{ total: number }>();

      return Response.json({
        status: "ok",
        service: "mcp-service-public",
        version: VERSION,
        fiches_count: ficheCount?.total ?? 0,
        last_sync: lastSync
          ? { completed_at: lastSync.completed_at, fiches_count: lastSync.fiches_count }
          : null,
      });
    }

    // Service description
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json({
        name: "mcp-service-public",
        description: "MCP Server pour les données de service-public.fr",
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
