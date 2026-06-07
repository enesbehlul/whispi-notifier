// Hangi soruların daha önce görüldüğünü kalıcı olarak saklar.
// GitHub Actions üzerinde bu dosya her çalışmada repo'ya geri commit'lenir,
// böylece çalışmalar arasında "en son görülen soru" bilgisi korunur.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const STATE_PATH = fileURLToPath(new URL("../state.json", import.meta.url));

// seenIds listesini sınırlı tut (sonsuz büyümesin). Genelde index.js zaten
// gelen kutusuyla budar; bu yalnızca son güvenlik tavanı. Env ile ayarlanabilir.
const MAX_SEEN = Number(process.env.STATE_MAX_SEEN) || 500;

/**
 * @returns {Promise<{initialized: boolean, seenIds: string[]}>}
 */
export async function readState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    // Başta BOM varsa (dosya UTF-8-BOM kaydedilmişse) ayıkla, yoksa JSON.parse patlar.
    const parsed = JSON.parse(raw.replace(/^﻿/, ""));
    return {
      initialized: Boolean(parsed.initialized),
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds : [],
    };
  } catch {
    // Dosya yok / bozuk → ilk çalışma kabul et.
    return { initialized: false, seenIds: [] };
  }
}

/**
 * @param {{initialized: boolean, seenIds: string[]}} state
 */
export async function writeState(state) {
  const trimmed = {
    initialized: true,
    seenIds: state.seenIds.slice(-MAX_SEEN),
  };
  await writeFile(STATE_PATH, JSON.stringify(trimmed, null, 2) + "\n", "utf8");
}
