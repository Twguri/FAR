// src/datasets/convertCsvToJson.mjs
// Convert all CSVs in src/datasets/csv -> JSON in src/datasets/json
// Supports columns:
// drive_frequency, Frequency, gamma_lower, gamma_upper, picture_id, color
//
// Notes:
// - gamma_lower / gamma_upper are in mV (your oscilloscope "Maximum" reading).
// - Convert to dimensionless Gamma using sensitivity 250 mV/g:
//     Gamma = mV / 250
// - If gamma_upper is "-" => null
// - picture_id is "-" means "no image yet" (base/rings state).
// - Merge rows that share (Frequency, gamma_lower, gamma_upper) into one region,
//   storing pictures in picture_items: [{id, color}]

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

const ROOT = process.cwd();
const CSV_DIR = path.join(ROOT, "src", "datasets", "csv");
const JSON_DIR = path.join(ROOT, "src", "datasets", "json");

// accelerometer sensitivity: 250 mV per g (dimensionless Gamma)
const SENSITIVITY_MV_PER_G = 250;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readCsv(filePath) {
  const txt = fs.readFileSync(filePath, "utf-8");
  return parse(txt, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function normStr(x) {
  if (x == null) return "";
  return String(x).trim();
}

function parseNumOrNull(x) {
  const s = normStr(x);
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseColor(x) {
  const s = normStr(x).toLowerCase();
  if (!s || s === "-") return null;
  // accept only your known codes
  const ok = new Set(["blue", "purple", "red", "brown", "black"]);
  return ok.has(s) ? s : s; // allow custom words too, but you can tighten if you want
}

// severity: higher means more "overlap/complex"
const COLOR_PRIORITY = ["blue", "purple", "red", "brown", "black"];
function chooseSummaryColor(items) {
  // items: [{id,color}]
  let bestIdx = -1;
  for (const it of items) {
    const c = (it.color || "").toLowerCase();
    const idx = COLOR_PRIORITY.indexOf(c);
    if (idx > bestIdx) bestIdx = idx;
  }
  return bestIdx >= 0 ? COLOR_PRIORITY[bestIdx] : null;
}

function fileBaseNameNoExt(p) {
  const base = path.basename(p);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(0, dot) : base;
}

function makeDatasetId(csvName) {
  // e.g. mineral_oil_down.csv -> mineral_oil_down
  return fileBaseNameNoExt(csvName).toLowerCase();
}

function main() {
  if (!fs.existsSync(CSV_DIR)) {
    console.error("CSV dir not found:", CSV_DIR);
    process.exit(1);
  }
  ensureDir(JSON_DIR);

  const files = fs
    .readdirSync(CSV_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"));

  if (files.length === 0) {
    console.log("No CSV files found in:", CSV_DIR);
    return;
  }

  for (const f of files) {
    const csvPath = path.join(CSV_DIR, f);
    const rows = readCsv(csvPath);

    // merge key = Frequency|gamma_lower|gamma_upper  (use original mV values)
    const phaseMap = new Map();

    for (const row of rows) {
      const drive_frequency = parseNumOrNull(row.drive_frequency);
      const Frequency = parseNumOrNull(row.Frequency);
      const gamma_lower_mV = parseNumOrNull(row.gamma_lower);
      const gamma_upper_mV = parseNumOrNull(row.gamma_upper);
      const picture_id = normStr(row.picture_id) || "-";
      const color = parseColor(row.color);

      // basic validation: need Frequency and lower to define a region
      if (Frequency == null || gamma_lower_mV == null) continue;

      // convert to dimensionless Gamma
      const Gamma_lower = gamma_lower_mV / SENSITIVITY_MV_PER_G;
      const Gamma_upper =
        gamma_upper_mV == null ? null : gamma_upper_mV / SENSITIVITY_MV_PER_G;

      // fixed df = 1 Hz centered at Frequency
      const df = 1;
      const f_min = Frequency - 0.5;
      const f_max = Frequency + 0.5;

      const key = `${Frequency}|${gamma_lower_mV}|${gamma_upper_mV ?? "-"}`;

      if (!phaseMap.has(key)) {
        phaseMap.set(key, {
          // index assigned later
          drive_frequency,
          Frequency,
          df,
          f_min,
          f_max,
          gamma_lower_mV,
          gamma_upper_mV,
          Gamma_lower,
          Gamma_upper,

          // legacy field (keep)
          picture_id: "-",

          // new multi-image field
          picture_items: [],

          // region summary color (computed later)
          color: null,
        });
      }

      const region = phaseMap.get(key);

      // collect image item (only if not "-")
      if (picture_id && picture_id !== "-") {
        region.picture_items.push({ id: picture_id, color });
        // set legacy picture_id as first image (for backward compat)
        if (region.picture_id === "-") region.picture_id = picture_id;
      } else {
        // if you want to preserve color even for "-" rows, you can store it:
        // (usually base state is blue in your legend; keep it if you want)
        if (color && region.picture_items.length === 0 && region.picture_id === "-") {
          // store as a pseudo item? I'd rather not. Leave region.color decided by real images.
        }
      }
    }

    const regions = Array.from(phaseMap.values()).map((r, i) => {
      r.index = i + 1;
      // compute a region summary color:
      // if there are multiple pictures, pick the highest priority color in those pictures
      // if no pictures, leave null
      r.color = chooseSummaryColor(r.picture_items);
      return r;
    });

    const datasetId = makeDatasetId(f);
    const out = {
      id: datasetId,
      source_csv: `src/datasets/csv/${f}`,
      meta: {
        sensitivity_mV_per_g: SENSITIVITY_MV_PER_G,
        df_hz: 1,
        note: "Gamma = mV / 250. gamma_upper '-' => null. picture_items merges same (Frequency, gamma_lower, gamma_upper).",
      },
      regions,
    };

    const outPath = path.join(JSON_DIR, `${datasetId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
    console.log("Wrote:", path.relative(ROOT, outPath), `(${regions.length} regions)`);
  }
}

main();