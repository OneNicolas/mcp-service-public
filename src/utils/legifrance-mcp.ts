/**
 * Helper proxy vers le MCP Legifrance (openlegi.fr)
 * Encapsule l'appel JSON-RPC MCP en un fetch HTTP simple depuis Cloudflare Workers.
 * Pourquoi : le MCP Legifrance expose une API REST/MCP sans auth, plus robuste
 * que de reverse-engineer l'API Legifrance officielle (OAuth2).
 */

const OPENLEGI_MCP_URL = "https://openlegi.fr/mcp";
const TIMEOUT_MS = 15000;

interface McpTextContent {
  type: "text";
  text: string;
}

interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: McpToolResult;
  error?: { code: number; message: string };
}

/** Appelle un outil du MCP Legifrance et retourne le texte formaté */
export async function callLegifranceTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENLEGI_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erreur réseau";
    throw new LegifranceMcpError(`Legifrance MCP inaccessible : ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new LegifranceMcpError(`Legifrance MCP erreur HTTP ${response.status}`);
  }

  // Streamable HTTP peut répondre en JSON direct ou en SSE.
  // On demande Accept: application/json donc on attend du JSON.
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseLegifranceSse(await response.text());
  }

  const data = (await response.json()) as McpJsonRpcResponse;

  if (data.error) {
    throw new LegifranceMcpError(`Legifrance MCP erreur : ${data.error.message}`);
  }

  const result = data.result;
  if (!result || !result.content?.length) {
    return "Aucun résultat Legifrance.";
  }

  if (result.isError) {
    throw new LegifranceMcpError(result.content[0]?.text ?? "Erreur Legifrance MCP");
  }

  return result.content.map((c) => c.text).join("\n");
}

/** Parse une réponse SSE du MCP Legifrance pour extraire le contenu textuel */
function parseLegifranceSse(sseBody: string): string {
  // Format SSE : "data: {...}\n\n"
  const lines = sseBody.split("\n");
  const texts: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      const parsed = JSON.parse(line.slice(6)) as Partial<McpJsonRpcResponse>;
      const content = parsed.result?.content;
      if (content) {
        texts.push(...content.map((c) => c.text));
      }
    } catch {
      // Ignorer les lignes non-JSON
    }
  }

  return texts.join("\n") || "Aucun résultat Legifrance.";
}

export class LegifranceMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegifranceMcpError";
  }
}
