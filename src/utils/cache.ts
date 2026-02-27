/**
 * Cache wrapper pour les appels API externes via Cloudflare Cache API.
 * Divise les temps de reponse par ~10 sur les requetes repetees.
 *
 * Usage : const data = await cachedFetch(url, { ttl: 86400 });
 *
 * TTL recommandes :
 *   - geo.api.gouv.fr (communes) : 7 jours (604800s)
 *   - data.economie.gouv.fr (REI) : 24h (86400s)
 *   - data.gouv.fr (zonage ABC) : 7 jours (604800s)
 *   - data.gouv.fr (DVF) : 24h (86400s)
 *   - annuaire API : 24h (86400s)
 */

interface CachedFetchOptions {
  /** TTL en secondes (defaut: 86400 = 24h) */
  ttl?: number;
  /** Timeout en millisecondes (defaut: 10000 = 10s) */
  timeout?: number;
  /** Nombre de retries sur timeout/5xx (defaut: 1) */
  retries?: number;
  /** Nom de la source pour les messages d'erreur (ex: "geo.api.gouv.fr") */
  source?: string;
}

/**
 * Fetch avec cache Cloudflare, timeout et retry automatique.
 * - Timeout configurable (defaut 10s)
 * - Retry 1x apres 2s sur timeout ou erreur 5xx
 * - Messages d'erreur homogenes avec nom de source
 */
export async function cachedFetch(
  url: string,
  options: CachedFetchOptions = {},
): Promise<Response> {
  const { ttl = 86400, timeout = 10_000, retries = 1, source } = options;
  const sourceName = source ?? extractSourceName(url);

  // Verifier le cache d'abord
  const cache = typeof caches !== "undefined" ? caches.default : null;

  if (cache) {
    const cacheKey = new Request(url, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  // Fetch avec retry
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, timeout);

      // Retry sur 5xx
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`${sourceName} : HTTP ${response.status}`);
        await delay(2000);
        continue;
      }

      // Cacher les reponses OK
      if (cache && response.ok) {
        const cloned = response.clone();
        const headers = new Headers(cloned.headers);
        headers.set("Cache-Control", `public, max-age=${ttl}`);

        const cachedResponse = new Response(cloned.body, {
          status: cloned.status,
          statusText: cloned.statusText,
          headers,
        });

        const cacheKey = new Request(url, { method: "GET" });
        await cache.put(cacheKey, cachedResponse);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Retry sur timeout ou erreur reseau
      if (attempt < retries) {
        await delay(2000);
        continue;
      }
    }
  }

  // Toutes les tentatives echouees
  throw new FetchError(
    `${sourceName} : ${lastError?.message ?? "erreur inconnue"} (apres ${retries + 1} tentative(s))`,
    sourceName,
  );
}

/** Fetch avec AbortController pour le timeout */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Erreur enrichie avec le nom de la source */
export class FetchError extends Error {
  public readonly source: string;

  constructor(message: string, source: string) {
    super(message);
    this.name = "FetchError";
    this.source = source;
  }
}

/** Extrait un nom de domaine lisible depuis une URL */
function extractSourceName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Raccourcir les noms courants
    if (hostname.includes("geo.api.gouv.fr")) return "geo-api";
    if (hostname.includes("data.economie.gouv.fr")) return "data-economie";
    if (hostname.includes("tabular-api.data.gouv.fr")) return "data-gouv-tabular";
    if (hostname.includes("data.gouv.fr")) return "data-gouv";
    if (hostname.includes("etablissements-publics.api")) return "annuaire-api";
    return hostname;
  } catch {
    return "api-externe";
  }
}

/** Pause entre les retries */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** TTL predefinis par source */
export const CACHE_TTL = {
  GEO_API: 604800,       // 7 jours - communes ne changent quasi jamais
  REI: 86400,            // 24h - taux REI mis a jour annuellement
  DVF: 86400,            // 24h - transactions mises a jour trimestriellement
  ZONAGE: 604800,        // 7 jours - zones ABC stables
  ANNUAIRE: 86400,       // 24h - services publics locaux
  BOFIP: 86400,          // 24h - doctrine fiscale
} as const;
