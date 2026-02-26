import { Unzip, UnzipInflate } from "fflate";
import { parseFiche } from "../parsers/fiche-parser.js";
import { parseMenu } from "../parsers/menu-parser.js";
import { batchUpsertFiches, batchUpsertThemes } from "./db-writer.js";
import type { Env, Fiche } from "../types.js";

const DILA_ZIP_URL =
  "https://lecomarquage.service-public.fr/vdd/3.4/part/zip/vosdroits-latest.zip";

/** Regex matching DILA fiche/ressource/noeud filenames */
const FICHE_PATTERN = /^[FRN]\d+\.xml$/;

export interface SyncResult {
  fichesInserted: number;
  themesCount: number;
  parseErrors: number;
  durationMs: number;
}

/**
 * Full DILA sync: downloads ZIP once, parses everything, inserts all.
 * Designed for Cloudflare Workers paid plan (30s CPU budget).
 */
export async function syncDilaFull(env: Env): Promise<SyncResult> {
  const start = Date.now();
  const logId = await createSyncLog(env.DB);

  try {
    const { fiches, menuXml, parseErrors } = await downloadAndParse();

    // Insert fiches in batches of 100 (D1 limit)
    for (let i = 0; i < fiches.length; i += 100) {
      await batchUpsertFiches(env.DB, fiches.slice(i, i + 100));
    }

    // Insert themes from menu.xml
    let themesCount = 0;
    if (menuXml) {
      const themes = parseMenu(menuXml);
      await batchUpsertThemes(env.DB, themes);
      themesCount = themes.length;
    }

    const result: SyncResult = {
      fichesInserted: fiches.length,
      themesCount,
      parseErrors,
      durationMs: Date.now() - start,
    };

    await completeSyncLog(env.DB, logId, fiches.length);
    console.log(
      `Sync complete: ${fiches.length} fiches, ${themesCount} themes in ${result.durationMs}ms (${parseErrors} errors)`,
    );
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await failSyncLog(env.DB, logId, msg);
    console.error(`Sync failed after ${Date.now() - start}ms: ${msg}`);
    throw error;
  }
}

/** Download ZIP via streaming and parse all XML files */
async function downloadAndParse(): Promise<{
  fiches: Fiche[];
  menuXml: string | null;
  parseErrors: number;
}> {
  const response = await fetch(DILA_ZIP_URL);
  if (!response.ok || !response.body) {
    throw new Error(`ZIP download failed: HTTP ${response.status}`);
  }

  const fiches: Fiche[] = [];
  let menuXml: string | null = null;
  let parseErrors = 0;

  const uz = new Unzip((file) => {
    const basename = file.name.split("/").pop() || "";

    if (file.name.endsWith("/") || !basename.endsWith(".xml")) {
      file.start();
      return;
    }

    const chunks: Uint8Array[] = [];
    file.ondata = (err, data, final) => {
      if (err) {
        parseErrors++;
        return;
      }
      chunks.push(data);
      if (final) {
        const xml = new TextDecoder().decode(concatBuffers(chunks));

        if (basename === "menu.xml") {
          menuXml = xml;
        } else if (FICHE_PATTERN.test(basename)) {
          const fiche = parseFiche(xml, basename);
          if (fiche) {
            fiches.push(fiche);
          } else {
            parseErrors++;
          }
        }
      }
    };
    file.start();
  });
  uz.register(UnzipInflate);

  // Stream ZIP bytes to avoid stack overflow
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (value) uz.push(value);
    if (done) {
      uz.push(new Uint8Array(0), true);
      break;
    }
  }

  return { fiches, menuXml, parseErrors };
}

// --- Helpers ---

function concatBuffers(arrays: Uint8Array[]): Uint8Array {
  if (arrays.length === 1) return arrays[0];
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// --- Sync log management ---

async function createSyncLog(db: D1Database): Promise<number> {
  const res = await db.prepare(
    `INSERT INTO sync_log (started_at, status) VALUES (datetime('now'), 'running')`,
  ).run();
  return res.meta.last_row_id;
}

async function completeSyncLog(
  db: D1Database,
  logId: number,
  totalFiches: number,
): Promise<void> {
  await db.prepare(
    `UPDATE sync_log SET completed_at = datetime('now'), fiches_count = ?, status = ? WHERE id = ?`,
  ).bind(totalFiches, "completed", logId).run();
}

async function failSyncLog(
  db: D1Database,
  logId: number,
  error: string,
): Promise<void> {
  await db.prepare(
    `UPDATE sync_log SET completed_at = datetime('now'), status = ? WHERE id = ?`,
  ).bind(`error: ${error.slice(0, 500)}`, logId).run();
}
