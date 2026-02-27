/**
 * Dashboard HTML genere cote serveur (SSR).
 * Injecte les stats directement dans le HTML -- pas de fetch client.
 */

import type { DashboardData } from "../utils/stats.js";

interface DashboardContext {
  version: string;
  ficheCount: number;
  lastSync: { completed_at: string; fiches_count: number } | null;
  stats: DashboardData;
  syncLogs: SyncLogEntry[];
}

interface SyncLogEntry {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  fiches_count: number | null;
}

/** Genere la page HTML du dashboard */
export function renderDashboard(ctx: DashboardContext): string {
  const { version, ficheCount, lastSync, stats, syncLogs } = ctx;

  const toolRows = stats.by_tool
    .map(
      (t) =>
        `<tr>
          <td>${esc(t.tool_name)}</td>
          <td class="num">${t.calls}</td>
          <td class="num ${t.errors > 0 ? "err" : ""}">${t.errors}</td>
          <td class="num">${t.avg_ms} ms</td>
          <td class="num">${t.min_ms} ms</td>
          <td class="num">${t.max_ms} ms</td>
        </tr>`,
    )
    .join("\n");

  const syncRows = syncLogs
    .map((s) => {
      // Calcule la duree depuis les timestamps
      let durationStr = "-";
      if (s.started_at && s.completed_at) {
        const ms = new Date(s.completed_at).getTime() - new Date(s.started_at).getTime();
        if (!isNaN(ms)) durationStr = `${(ms / 1000).toFixed(1)}s`;
      }
      // Extrait le message d'erreur du status
      const isOk = s.status === "completed";
      const errorMsg = !isOk && s.status?.startsWith("error:") ? s.status.slice(7) : "";

      return `<tr>
          <td>${esc(s.started_at)}</td>
          <td class="${isOk ? "ok" : "err"}">${isOk ? "completed" : esc(s.status)}</td>
          <td class="num">${s.fiches_count ?? "-"}</td>
          <td class="num">${durationStr}</td>
          <td>${errorMsg ? esc(errorMsg) : "-"}</td>
        </tr>`;
    })
    .join("\n");

  const errorRows = stats.recent_errors
    .map(
      (e) =>
        `<tr>
          <td>${esc(e.tool_name)}</td>
          <td>${esc(e.args_summary)}</td>
          <td class="num">${e.duration_ms} ms</td>
          <td>${esc(e.created_at)}</td>
        </tr>`,
    )
    .join("\n");

  // Donnees pour le graphique horaire (inline JSON)
  const hourlyJson = JSON.stringify(stats.hourly_calls);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard \u2014 mcp-service-public</title>
<style>
  :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --accent: #3b82f6; --green: #22c55e; --red: #ef4444; --yellow: #eab308; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 1.5rem; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--muted); }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1rem; }
  .card .label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; }
  .card .sub { font-size: 0.8rem; color: var(--muted); margin-top: 0.25rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .ok { color: var(--green); }
  .err { color: var(--red); }
  .section { background: var(--card); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
  .chart-container { height: 180px; position: relative; margin-top: 0.5rem; }
  .bar-chart { display: flex; align-items: flex-end; gap: 2px; height: 150px; }
  .bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; }
  .bar { width: 100%; min-width: 4px; background: var(--accent); border-radius: 2px 2px 0 0; transition: height 0.3s; position: relative; }
  .bar.error { background: var(--red); }
  .bar-label { font-size: 0.6rem; color: var(--muted); margin-top: 4px; writing-mode: vertical-rl; text-orientation: mixed; max-height: 50px; overflow: hidden; }
  .empty { text-align: center; color: var(--muted); padding: 2rem; }
  @media (max-width: 640px) { body { padding: 0.75rem; } .grid { grid-template-columns: 1fr 1fr; } }
</style>
</head>
<body>
  <h1>mcp-service-public</h1>
  <div class="meta">v${esc(version)} &middot; ${ficheCount.toLocaleString("fr-FR")} fiches &middot; Dernier sync : ${lastSync ? esc(lastSync.completed_at) : "jamais"}</div>

  <div class="grid">
    <div class="card">
      <div class="label">Appels (${esc(stats.period)})</div>
      <div class="value">${stats.total_calls.toLocaleString("fr-FR")}</div>
    </div>
    <div class="card">
      <div class="label">Erreurs</div>
      <div class="value ${stats.total_errors > 0 ? "err" : "ok"}">${stats.total_errors}</div>
      <div class="sub">${esc(stats.error_rate)}</div>
    </div>
    <div class="card">
      <div class="label">Temps moyen</div>
      <div class="value">${stats.avg_duration_ms}<span style="font-size:0.9rem"> ms</span></div>
    </div>
    <div class="card">
      <div class="label">Outils actifs</div>
      <div class="value">${stats.by_tool.length}</div>
      <div class="sub">/ 12 disponibles</div>
    </div>
  </div>

  <div class="section">
    <h2>Appels par heure</h2>
    <div id="hourly-chart" class="chart-container">
      ${stats.hourly_calls.length === 0 ? '<div class="empty">Aucune donnee sur cette periode</div>' : ""}
    </div>
  </div>

  <div class="section">
    <h2>Performance par outil</h2>
    ${
      stats.by_tool.length === 0
        ? '<div class="empty">Aucun appel sur cette periode</div>'
        : `<table>
      <thead><tr><th>Outil</th><th class="num">Appels</th><th class="num">Erreurs</th><th class="num">Moy.</th><th class="num">Min</th><th class="num">Max</th></tr></thead>
      <tbody>${toolRows}</tbody>
    </table>`
    }
  </div>

  ${
    stats.recent_errors.length > 0
      ? `<div class="section">
    <h2>Erreurs recentes</h2>
    <table>
      <thead><tr><th>Outil</th><th>Args</th><th class="num">Duree</th><th>Date</th></tr></thead>
      <tbody>${errorRows}</tbody>
    </table>
  </div>`
      : ""
  }

  <div class="section">
    <h2>Historique des syncs</h2>
    ${
      syncLogs.length === 0
        ? '<div class="empty">Aucun sync enregistre</div>'
        : `<table>
      <thead><tr><th>Date</th><th>Statut</th><th class="num">Fiches</th><th class="num">Duree</th><th>Erreur</th></tr></thead>
      <tbody>${syncRows}</tbody>
    </table>`
    }
  </div>

  <script>
    // Graphique horaire en barres CSS
    const data = ${hourlyJson};
    const container = document.getElementById("hourly-chart");
    if (data.length > 0) {
      const maxCalls = Math.max(...data.map(d => d.calls), 1);
      const chart = document.createElement("div");
      chart.className = "bar-chart";
      data.forEach(d => {
        const group = document.createElement("div");
        group.className = "bar-group";
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.height = Math.max((d.calls / maxCalls) * 150, 2) + "px";
        bar.title = d.hour + " : " + d.calls + " appels" + (d.errors > 0 ? ", " + d.errors + " erreurs" : "");
        if (d.errors > 0) bar.classList.add("error");
        group.appendChild(bar);
        const label = document.createElement("div");
        label.className = "bar-label";
        label.textContent = d.hour.slice(11, 16);
        group.appendChild(label);
        chart.appendChild(group);
      });
      container.innerHTML = "";
      container.appendChild(chart);
    }
  </script>
</body>
</html>`;
}

/** Echappe le HTML */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
