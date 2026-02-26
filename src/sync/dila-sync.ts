import { Unzip, UnzipInflate } from "fflate";
import { parseFiche } from "../parsers/fiche-parser.js";
import { parseMenu } from "../parsers/menu-parser.js";
import { batchUpsertFiches, batchUpsertThemes } from "./db-writer.js";
import type { Env, Fiche } from "../types.js";

const DILA_ZIP_URL =
  "https://lecomarquage.service-public.fr/vdd/3.4/part/zip/vosdroits-latest.zip";

/** Number of fiches to insert per HTTP call */
const CHUNK_SIZE = 1000;

/** Regex matching DILA fiche/ressource/noeud filenames */
const FICHE_PATTERN = /^[FRN]\d+\.xml$/;

export interface SyncResult {
  fichesInserted: number;
  totalParsed: number;
  themesCount: number;
  parseErrors: number;
  durationMs: number;
  nextOffset: number | null;
  done: boolean;
}

/**
 * Chunked DILA sync pipeline.
 * Downloads ZIP via streaming, parses all fiches, but only inserts
 * fiches from `offset` to `offset + CHUNK_SIZE`.
 */
export async function syncDila(env: Env, offset = 0): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    fichesInserted: 0,
    totalParsed: 0,
    themesCount: 0,
    parseErrors: 0,
    durationMs: 0,
    nextOffset: null,
    done: false,
  };

  const logId = offset === 0 ? await createSyncLog(env.DB) : null;

  try {
    const { fiches, menuXml, parseErrors } = await downloadAndParse();
    result.totalParsed = fiches.length;
    result.parseErrors = parseErrors;

    // Insert only the current chunk
    const chunk = fiches.slice(offset, offset + CHUNK_SIZE);
    for (let i = 0; i < chunk.length; i += 100) {
      await batchUpsertFiches(env.DB, chunk.slice(i, i + 100));
    }
    result.fichesInserted = chunk.length;

    // Determine if more work remains
    const nextOffset = offset + CHUNK_SIZE;
    if (nextOffset < fiches.length) {
      result.nextOffset = nextOffset;
      result.done = false;
    } else {
      result.done = true;

      if (menuXml) {
        const themes = parseMenu(menuXml);
        await batchUpsertThemes(env.DB, themes);
        result.themesCount = themes.length;
      }
    }

    result.durationMs = Date.now() - start;

    if (logId !== null && result.done) {
      await completeSyncLog(env.DB, logId, fiches.length);
    }

    console.log(
      `Sync chunk [${offset}-${offset + chunk.length}/${fiches.length}]: ${chunk.length} inserted in ${result.durationMs}ms${result.done ? " (DONE)" : ""}`,
    );
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    result.durationMs = Date.now() - start;
    if (logId !== null) {
      await failSyncLog(env.DB, logId, msg);
    }
    console.error(`Sync failed at offset ${offset} after ${result.durationMs}ms: ${msg}`);
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
