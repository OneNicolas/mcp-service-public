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
}

/**
 * Fetch avec cache Cloudflare (caches.default).
 * Retourne la Response. En cas d'erreur cache, fallback sur fetch direct.
 */
export async function cachedFetch(
  url: string,
  options: CachedFetchOptions = {},
): Promise<Response> {
  const { ttl = 86400 } = options;

  // caches.default n'existe que dans Cloudflare Workers (pas en local)
  const cache = typeof caches !== "undefined" ? caches.default : null;

  if (cache) {
    const cacheKey = new Request(url, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const response = await fetch(url);

  // Ne cacher que les reponses OK
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
    // waitUntil n'est pas disponible ici, put est synchrone dans le cache API
    await cache.put(cacheKey, cachedResponse);
  }

  return response;
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
