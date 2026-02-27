/**
 * Generateur OpenAPI 3.1 dynamique a partir du tableau TOOLS[].
 * Expose chaque outil MCP comme un endpoint POST /tools/{tool_name}.
 * Ces endpoints sont fictifs (le vrai transport est JSON-RPC sur /mcp)
 * mais documentent parfaitement les schemas d'entree/sortie.
 */

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    contact?: { url: string };
    license?: { name: string };
  };
  servers: { url: string; description: string }[];
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
  tags: { name: string; description: string }[];
}

/** Categories d'outils pour les tags OpenAPI */
const TOOL_TAGS: Record<string, string> = {
  rechercher: "Recherche",
  rechercher_fiche: "Fiches pratiques",
  lire_fiche: "Fiches pratiques",
  naviguer_themes: "Fiches pratiques",
  rechercher_service_local: "Services publics",
  consulter_fiscalite_locale: "Fiscalite",
  rechercher_doctrine_fiscale: "Fiscalite",
  simuler_taxe_fonciere: "Simulateurs",
  simuler_frais_notaire: "Simulateurs",
  simuler_impot_revenu: "Simulateurs",
  consulter_transactions_immobilieres: "Immobilier",
  consulter_zonage_immobilier: "Immobilier",
  comparer_communes: "Immobilier",
  rechercher_convention_collective: "Travail",
};

export function generateOpenAPISpec(tools: ToolDefinition[], version: string): OpenAPISpec {
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {};

  // Collecter les tags uniques
  const tagSet = new Set<string>();

  for (const tool of tools) {
    const tag = TOOL_TAGS[tool.name] ?? "Autre";
    tagSet.add(tag);

    // Schema d'entree
    const inputSchemaName = `${tool.name}_input`;
    schemas[inputSchemaName] = {
      type: "object",
      description: `Parametres d'entree pour ${tool.name}`,
      properties: tool.inputSchema.properties ?? {},
      ...(tool.inputSchema.required?.length ? { required: tool.inputSchema.required } : {}),
    };

    // Endpoint fictif documentant l'outil
    paths[`/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description.split(".")[0] + ".",
        description: tool.description,
        tags: [tag],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${inputSchemaName}` },
            },
          },
        },
        responses: {
          "200": {
            description: "Resultat de l'outil",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ToolResult" },
              },
            },
          },
          "400": {
            description: "Parametres invalides",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ToolError" },
              },
            },
          },
        },
      },
    };
  }

  // Schemas communs
  schemas["ToolResult"] = {
    type: "object",
    properties: {
      content: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["text"] },
            text: { type: "string" },
          },
          required: ["type", "text"],
        },
      },
    },
    required: ["content"],
  };

  schemas["ToolError"] = {
    type: "object",
    properties: {
      content: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["text"] },
            text: { type: "string" },
          },
        },
      },
      isError: { type: "boolean", enum: [true] },
    },
    required: ["content", "isError"],
  };

  // Tags tries alphabetiquement
  const tags = Array.from(tagSet).sort().map((name) => ({
    name,
    description: getTagDescription(name),
  }));

  return {
    openapi: "3.1.0",
    info: {
      title: "mcp-service-public",
      version,
      description:
        "Serveur MCP pour les donnees publiques francaises. " +
        "14 outils couvrant les fiches pratiques service-public.fr, la fiscalite locale, " +
        "les transactions immobilieres DVF, la doctrine BOFiP, le zonage ABC, " +
        "les conventions collectives et les simulateurs (TF, frais de notaire, IR). " +
        "Transport reel : JSON-RPC via POST /mcp (Streamable HTTP). " +
        "Les endpoints /tools/* ci-dessous documentent les schemas d'entree/sortie de chaque outil.",
      contact: { url: "https://github.com/OneNicolas/mcp-service-public" },
      license: { name: "MIT" },
    },
    servers: [
      {
        url: "https://mcp-service-public.nhaultcoeur.workers.dev",
        description: "Production (Cloudflare Workers)",
      },
    ],
    paths,
    components: { schemas },
    tags,
  };
}

function getTagDescription(tag: string): string {
  const descriptions: Record<string, string> = {
    "Recherche": "Recherche unifiee multi-sources avec dispatch intelligent",
    "Fiches pratiques": "Fiches service-public.fr (droits, demarches, themes)",
    "Services publics": "Annuaire des services publics locaux (mairies, prefectures, CAF...)",
    "Fiscalite": "Taux d'imposition locale REI et doctrine fiscale BOFiP",
    "Simulateurs": "Simulateurs : taxe fonciere, frais de notaire, impot sur le revenu",
    "Immobilier": "Transactions DVF, zonage ABC (Pinel/PTZ), comparaison de communes",
    "Travail": "Conventions collectives nationales (base KALI)",
  };
  return descriptions[tag] ?? tag;
}
