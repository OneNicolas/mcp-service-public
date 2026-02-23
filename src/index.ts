import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./types.js";
import { rechercherFiche } from "./tools/rechercher-fiche.js";
import { lireFiche } from "./tools/lire-fiche.js";
import { rechercherServiceLocal } from "./tools/rechercher-service-local.js";
import { naviguerThemes } from "./tools/naviguer-themes.js";
import { syncDila } from "./sync/dila-sync.js";

export class ServicePublicMcp extends McpAgent<Env> {
  server = new McpServer({
    name: "service-public",
    version: "0.1.0",
  });

  async init() {
    this.server.tool(
      "rechercher_fiche",
      "Recherche dans les fiches pratiques de service-public.fr (droits, démarches administratives). Utilise la recherche plein texte.",
      {
        query: z.string().describe("Termes de recherche (ex: 'passeport', 'allocation logement', 'permis de conduire')"),
        theme: z.string().optional().describe("Filtrer par thème (ex: 'Papiers', 'Logement', 'Travail')"),
        audience: z.enum(["Particuliers", "Professionnels", "Associations"]).optional().describe("Public cible"),
        limit: z.number().min(1).max(20).default(10).optional().describe("Nombre de résultats"),
      },
      async (args) => rechercherFiche(args, this.env),
    );

    this.server.tool(
      "lire_fiche",
      "Lit le contenu complet d'une fiche pratique par son identifiant (ex: F14929 pour le passeport). Inclut le texte, les services en ligne, les références légales et les liens.",
      {
        fiche_id: z.string().describe("Identifiant de la fiche (ex: F14929, N360, R42946)"),
      },
      async (args) => lireFiche(args, this.env),
    );

    this.server.tool(
      "rechercher_service_local",
      "Recherche un service public local (mairie, préfecture, CAF, CPAM, France Services...) via l'Annuaire de l'administration.",
      {
        type_organisme: z.string().optional().describe("Type de service (ex: 'mairie', 'prefecture', 'caf', 'cpam', 'france_services', 'tribunal')"),
        code_postal: z.string().optional().describe("Code postal (ex: '75001')"),
        commune: z.string().optional().describe("Nom de la commune"),
        code_insee: z.string().optional().describe("Code INSEE de la commune"),
        limit: z.number().min(1).max(20).default(5).optional().describe("Nombre de résultats"),
      },
      async (args) => rechercherServiceLocal(args),
    );

    this.server.tool(
      "naviguer_themes",
      "Parcourt l'arborescence thématique de service-public.fr. Sans paramètre, liste les thèmes principaux. Avec un ID, affiche les sous-catégories et fiches associées.",
      {
        theme_id: z.string().optional().describe("ID du thème à explorer (ex: N19810, N360)"),
      },
      async (args) => naviguerThemes(args, this.env),
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "mcp-service-public",
        version: "0.1.0",
      });
    }

    // Service description
    if (url.pathname === "/") {
      return Response.json({
        name: "mcp-service-public",
        description: "MCP Server pour les données de service-public.fr",
        mcp_endpoint: "/mcp",
        transport: "streamable-http",
        tools: [
          "rechercher_fiche",
          "lire_fiche",
          "rechercher_service_local",
          "naviguer_themes",
        ],
        source: "https://github.com/OneNicolas/mcp-service-public",
      });
    }

    // Manual sync trigger (protected)
    if (url.pathname === "/admin/sync" && request.method === "POST") {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!env.ADMIN_SECRET || token !== env.ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Run sync in background, return immediately
      ctx.waitUntil(
        syncDila(env).then((result) => {
          console.log("Admin sync completed:", JSON.stringify(result));
        }).catch((error) => {
          console.error("Admin sync failed:", error);
        }),
      );

      return Response.json(
        { status: "started", message: "Sync démarré en arrière-plan" },
        { status: 202 },
      );
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

    // All other paths → McpAgent Durable Object
    return (env as Record<string, DurableObjectNamespace>).MCP_OBJECT
      .get((env as Record<string, DurableObjectNamespace>).MCP_OBJECT.idFromName("default"))
      .fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("Cron: starting daily DILA sync...");
    ctx.waitUntil(
      syncDila(env).then((result) => {
        console.log("Cron sync completed:", JSON.stringify(result));
      }).catch((error) => {
        console.error("Cron sync failed:", error);
      }),
    );
  },
};
