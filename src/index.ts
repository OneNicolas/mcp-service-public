import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./types.js";
import { rechercherFiche } from "./tools/rechercher-fiche.js";
import { lireFiche } from "./tools/lire-fiche.js";
import { rechercherServiceLocal } from "./tools/rechercher-service-local.js";
import { naviguerThemes } from "./tools/naviguer-themes.js";

export class ServicePublicMcp extends McpAgent<Env> {
  server = new McpServer({
    name: "service-public",
    version: "0.1.0",
  });

  async init() {
    this.server.tool(
      "rechercher_fiche",
      "Recherche dans les fiches pratiques de service-public.fr (droits, d\u00e9marches administratives). Utilise la recherche plein texte.",
      {
        query: z.string().describe("Termes de recherche (ex: 'passeport', 'allocation logement', 'permis de conduire')"),
        theme: z.string().optional().describe("Filtrer par th\u00e8me (ex: 'Papiers', 'Logement', 'Travail')"),
        audience: z.enum(["Particuliers", "Professionnels", "Associations"]).optional().describe("Public cible"),
        limit: z.number().min(1).max(20).default(10).optional().describe("Nombre de r\u00e9sultats"),
      },
      async (args) => rechercherFiche(args, this.env),
    );

    this.server.tool(
      "lire_fiche",
      "Lit le contenu complet d'une fiche pratique par son identifiant (ex: F14929 pour le passeport). Inclut le texte, les services en ligne, les r\u00e9f\u00e9rences l\u00e9gales et les liens.",
      {
        fiche_id: z.string().describe("Identifiant de la fiche (ex: F14929, N360, R42946)"),
      },
      async (args) => lireFiche(args, this.env),
    );

    this.server.tool(
      "rechercher_service_local",
      "Recherche un service public local (mairie, pr\u00e9fecture, CAF, CPAM, France Services...) via l'Annuaire de l'administration.",
      {
        type_organisme: z.string().optional().describe("Type de service (ex: 'mairie', 'prefecture', 'caf', 'cpam', 'france_services', 'tribunal')"),
        code_postal: z.string().optional().describe("Code postal (ex: '75001')"),
        commune: z.string().optional().describe("Nom de la commune"),
        code_insee: z.string().optional().describe("Code INSEE de la commune"),
        limit: z.number().min(1).max(20).default(5).optional().describe("Nombre de r\u00e9sultats"),
      },
      async (args) => rechercherServiceLocal(args),
    );

    this.server.tool(
      "naviguer_themes",
      "Parcourt l'arborescence th\u00e9matique de service-public.fr. Sans param\u00e8tre, liste les th\u00e8mes principaux. Avec un ID, affiche les sous-cat\u00e9gories et fiches associ\u00e9es.",
      {
        theme_id: z.string().optional().describe("ID du th\u00e8me \u00e0 explorer (ex: N19810, N360)"),
      },
      async (args) => naviguerThemes(args, this.env),
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "mcp-service-public",
        version: "0.1.0",
      });
    }

    if (url.pathname === "/") {
      return Response.json({
        name: "mcp-service-public",
        description: "MCP Server pour les donn\u00e9es de service-public.fr",
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

    // All other paths -> McpAgent Durable Object
    return (env as Record<string, DurableObjectNamespace>).MCP_OBJECT
      .get((env as Record<string, DurableObjectNamespace>).MCP_OBJECT.idFromName("default"))
      .fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    console.log("Starting daily DILA sync...");
    await env.DB.prepare(
      `INSERT INTO sync_log (started_at, status) VALUES (datetime('now'), 'not_implemented')`,
    ).run();
  },
};
