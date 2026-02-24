import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

// === config ===
const CSV_DIR = path.resolve("src/datasets/csv");
const OUT_DIR = path.resolve("src/datasets/json");

// Accelerometer sensitivity (typ): 250 mV/g
// Scope mode: AC coupling + "Maximum" => peak amplitude => Gamma = Vmax/S
const SENSITIVITY_MV_PER_G = 250;
const DEFAULT_DF_HZ = 1;

/** Convert a CSV cell to number or null (supports "-" as null). */
function numOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Normalize string cell; "-" becomes "-" (kept) unless you want null. */
function str(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/** Compute Gamma (dimensionless) from mV. */
function mvToGamma(mv) {
  if (mv === null) return null;
  return mv / SENSITIVITY_MV_PER_G;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function buildJsonForFile(csvPath) {
  const baseName = path.basename(csvPath, ".csv"); // e.g. mineral_oil_down
  const rows = readCsv(csvPath);

  // Map/convert each row; keep original columns + computed fields
  const regions = rows.map((r, idx) => {
    // keep your original column names as-is
    const drive_frequency = numOrNull(r.drive_frequency);
    const frequency = numOrNull(r.Frequency); // you have "Frequency" (e.g., 6.5)
    const gamma_lower_mV = numOrNull(r.gamma_lower);
    const gamma_upper_mV = numOrNull(r.gamma_upper);
    const picture_id = str(r.picture_id) || "-";

    // computed
    const Gamma_lower = mvToGamma(gamma_lower_mV);
    const Gamma_upper = mvToGamma(gamma_upper_mV);

    // frequency bin (center ± df/2)
    const df = DEFAULT_DF_HZ;
    const f_min = frequency === null ? null : frequency - df / 2;
    const f_max = frequency === null ? null : frequency + df / 2;

    return {
      index: idx,
      drive_frequency,
      Frequency: frequency,
      df,
      f_min,
      f_max,
      gamma_lower_mV,
      gamma_upper_mV, // null means "-" (unknown/not measured yet)
      Gamma_lower,
      Gamma_upper,    // null means "-" (unknown/not measured yet)
      picture_id,     // "-" => show "no image yet"
    };
  });

  return {
    id: baseName,
    source_csv: `src/datasets/csv/${path.basename(csvPath)}`,
    meta: {
      gamma_input_unit: "mV (peak, scope Maximum, AC coupled)",
      Gamma_definition: "Gamma = a_max/g = Vmax(mV) / 250(mV/g)",
      sensitivity_mV_per_g: SENSITIVITY_MV_PER_G,
      df_hz_default: DEFAULT_DF_HZ,
      note_picture_id_dash: "picture_id '-' means: no image yet (still a valid pattern/phase).",
      note_gamma_upper_null: "Gamma_upper null (from '-') means: upper boundary not measured yet; fill later.",
    },
    regions,
  };
}

function main() {
  if (!fs.existsSync(CSV_DIR)) {
    console.error(`CSV directory not found: ${CSV_DIR}`);
    process.exit(1);
  }
  ensureDir(OUT_DIR);

  const files = fs
    .readdirSync(CSV_DIR)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => path.join(CSV_DIR, f));

  if (files.length === 0) {
    console.log(`No CSV files found in ${CSV_DIR}`);
    return;
  }

  for (const csvPath of files) {
    const json = buildJsonForFile(csvPath);
    const outPath = path.join(OUT_DIR, `${json.id}.json`);
    fs.writeFileSync(outPath, JSON.stringify(json, null, 2), "utf8");
    console.log(`Wrote: ${outPath}`);
  }
}

main();