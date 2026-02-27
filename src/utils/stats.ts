/**
 * Tracking des appels outils pour le dashboard.
 * Table D1 `tool_stats` creee automatiquement si absente.
 */

interface ToolCallLog {
  tool_name: string;
  duration_ms: number;
  is_error: boolean;
  args_summary: string;
}

/** Cree la table si elle n'existe pas */
export async function ensureStatsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS tool_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      args_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  // Index pour les requetes dashboard
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tool_stats_created ON tool_stats(created_at)
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tool_stats_name ON tool_stats(tool_name)
  `).run();
}

/** Enregistre un appel outil (fire-and-forget, ne bloque pas la reponse) */
export async function logToolCall(db: D1Database, log: ToolCallLog): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO tool_stats (tool_name, duration_ms, is_error, args_summary) VALUES (?, ?, ?, ?)`,
    ).bind(
      log.tool_name,
      log.duration_ms,
      log.is_error ? 1 : 0,
      log.args_summary.slice(0, 200),
    ).run();
  } catch {
    // Silencieux : le tracking ne doit jamais casser un appel outil
  }
}

/** Resume un objet d'args en string courte pour debug */
export function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null) continue;
    const val = Array.isArray(v) ? `[${v.join(",")}]` : String(v);
    parts.push(`${k}=${val.slice(0, 50)}`);
  }
  return parts.join(" ") || "(vide)";
}

/** Purge les logs de plus de N jours */
export async function purgeOldStats(db: D1Database, days: number = 30): Promise<number> {
  try {
    const result = await db.prepare(
      `DELETE FROM tool_stats WHERE created_at < datetime('now', '-${days} days')`,
    ).run();
    return result.meta?.changes ?? 0;
  } catch {
    return 0;
  }
}

// --- Requetes dashboard ---

export interface DashboardData {
  period: string;
  total_calls: number;
  total_errors: number;
  error_rate: string;
  avg_duration_ms: number;
  by_tool: ToolStat[];
  recent_errors: RecentError[];
  hourly_calls: HourlyStat[];
}

interface ToolStat {
  tool_name: string;
  calls: number;
  errors: number;
  avg_ms: number;
  p95_ms: number | null;
  min_ms: number;
  max_ms: number;
}

interface RecentError {
  tool_name: string;
  args_summary: string;
  duration_ms: number;
  created_at: string;
}

interface HourlyStat {
  hour: string;
  calls: number;
  errors: number;
}

/** Genere les stats dashboard pour une periode donnee */
export async function getDashboardData(
  db: D1Database,
  hours: number = 24,
): Promise<DashboardData> {
  const since = `datetime('now', '-${hours} hours')`;

  // Stats globales
  const global = await db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      SUM(is_error) as total_errors,
      ROUND(AVG(duration_ms)) as avg_duration_ms
    FROM tool_stats
    WHERE created_at >= ${since}
  `).first<{ total_calls: number; total_errors: number; avg_duration_ms: number }>();

  // Stats par outil
  const byToolRows = await db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as calls,
      SUM(is_error) as errors,
      ROUND(AVG(duration_ms)) as avg_ms,
      MIN(duration_ms) as min_ms,
      MAX(duration_ms) as max_ms
    FROM tool_stats
    WHERE created_at >= ${since}
    GROUP BY tool_name
    ORDER BY calls DESC
  `).all<{ tool_name: string; calls: number; errors: number; avg_ms: number; min_ms: number; max_ms: number }>();

  // Erreurs recentes
  const recentErrors = await db.prepare(`
    SELECT tool_name, args_summary, duration_ms, created_at
    FROM tool_stats
    WHERE is_error = 1 AND created_at >= ${since}
    ORDER BY created_at DESC
    LIMIT 10
  `).all<RecentError>();

  // Repartition horaire (derniere 24h)
  const hourlyRows = await db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00', created_at) as hour,
      COUNT(*) as calls,
      SUM(is_error) as errors
    FROM tool_stats
    WHERE created_at >= ${since}
    GROUP BY hour
    ORDER BY hour ASC
  `).all<HourlyStat>();

  const totalCalls = global?.total_calls ?? 0;
  const totalErrors = global?.total_errors ?? 0;

  return {
    period: `${hours}h`,
    total_calls: totalCalls,
    total_errors: totalErrors,
    error_rate: totalCalls > 0 ? `${((totalErrors / totalCalls) * 100).toFixed(1)}%` : "0%",
    avg_duration_ms: global?.avg_duration_ms ?? 0,
    by_tool: (byToolRows.results ?? []).map((r) => ({
      tool_name: r.tool_name,
      calls: r.calls,
      errors: r.errors,
      avg_ms: r.avg_ms,
      p95_ms: null,
      min_ms: r.min_ms,
      max_ms: r.max_ms,
    })),
    recent_errors: recentErrors.results ?? [],
    hourly_calls: hourlyRows.results ?? [],
  };
}
