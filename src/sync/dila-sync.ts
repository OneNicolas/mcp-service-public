import { Unzip, UnzipInflate } from "fflate";
import { parseFiche } from "../parsers/fiche-parser.js";
import { parseMenu } from "../parsers/menu-parser.js";
import { batchUpsertFiches, batchUpsertThemes } from "./db-writer.js";
import type { Env, Fiche } from "../types.js";

const DILA_ZIP_URL =
  "https://lecomarquage.service-public.fr/vdd/3.4/part/zip/vosdroits-latest.zip";

/**
 * Number of fiches to accumulate before flushing to D1.
 * Kept under the D1 batch limit of 100 statements.
 */
const FLUSH_SIZE = 50;

/** Regex matching DILA fiche/ressource/noeud filenames */
const FICHE_PATTERN = /^[FRN]\d+\.xml$/;

export interface SyncResult {
  fichesCount: number;
  themesCount: number;
  parseErrors: number;
  durationMs: number;
}

/**
 * Full DILA sync pipeline:
 * 1. Stream-download the daily ZIP archive
 * 2. Decompress file-by-file with fflate (memory-safe)
 * 3. Parse XML → Fiche objects via existing parser
 * 4. Batch upsert to D1 every FLUSH_SIZE fiches
 * 5. Parse menu.xml → themes table
 * 6. Log results in sync_log
 */
export async function syncDila(env: Env): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    fichesCount: 0,
    themesCount: 0,
    parseErrors: 0,
    durationMs: 0,
  };

  const logId = await createSyncLog(env.DB);

  try {
    const response = await fetch(DILA_ZIP_URL);
    if (!response.ok || !response.body) {
      throw new Error(`ZIP download failed: HTTP ${response.status}`);
    }

    // Buffers filled by the streaming unzipper
    const pendingFiches: Fiche[] = [];
    let menuXml: string | null = null;

    // Set up streaming ZIP decompression
    const uz = new Unzip((file) => {
      const basename = file.name.split("/").pop() || "";

      // Skip directories and non-XML files
      if (file.name.endsWith("/") || !basename.endsWith(".xml")) {
        file.start();
        return;
      }

      const chunks: Uint8Array[] = [];
      file.ondata = (err, data, final) => {
        if (err) {
          result.parseErrors++;
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
              pendingFiches.push(fiche);
            } else {
              result.parseErrors++;
            }
          }
          // Other XML files (commentFaireSi.xml, servicesEnLigne.xml, etc.) are skipped for now
        }
      };
      file.start();
    });
    uz.register(UnzipInflate);

    // Stream ZIP bytes from the network into the decompressor
    const reader = response.body.getReader();
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (value) uz.push(value);
      if (done) {
        uz.push(new Uint8Array(0), true);
        streamDone = true;
      }

      // Flush accumulated fiches to D1 between stream reads
      while (pendingFiches.length >= FLUSH_SIZE) {
        const batch = pendingFiches.splice(0, FLUSH_SIZE);
        await batchUpsertFiches(env.DB, batch);
        result.fichesCount += batch.length;
      }
    }

    // Flush remaining fiches
    if (pendingFiches.length > 0) {
      await batchUpsertFiches(env.DB, pendingFiches);
      result.fichesCount += pendingFiches.length;
      pendingFiches.length = 0;
    }

    // Process theme hierarchy from menu.xml
    if (menuXml) {
      const themes = parseMenu(menuXml);
      await batchUpsertThemes(env.DB, themes);
      result.themesCount = themes.length;
    }

    result.durationMs = Date.now() - start;
    await completeSyncLog(env.DB, logId, result);
    console.log(
      `Sync complete: ${result.fichesCount} fiches, ${result.themesCount} themes, ${result.parseErrors} errors in ${result.durationMs}ms`,
    );
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.durationMs = Date.now() - start;
    await failSyncLog(env.DB, logId, msg);
    console.error(`Sync failed after ${result.durationMs}ms: ${msg}`);
    throw error;
  }
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
  result: SyncResult,
): Promise<void> {
  await db.prepare(
    `UPDATE sync_log SET completed_at = datetime('now'), fiches_count = ?, status = ? WHERE id = ?`,
  ).bind(result.fichesCount, "completed", logId).run();
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
