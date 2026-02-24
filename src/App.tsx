import React from "react";
import { Routes, Route, Link, useNavigate, Navigate } from "react-router-dom";

// ✅ 你的 4 个 JSON
import waterUp from "./datasets/json/water_up.json";
import waterDown from "./datasets/json/water_down.json";
import mineralOilUp from "./datasets/json/mineral_oil_up.json";
import mineralOilDown from "./datasets/json/mineral_oil_down.json";

type Fluid = "water" | "mineral_oil";
type Sweep = "up" | "down";

type Region = {
  index: number;
  drive_frequency: number | null;
  Frequency: number | null;
  df: number;
  f_min: number | null;
  f_max: number | null;
  gamma_lower_mV: number | null;
  gamma_upper_mV: number | null;
  Gamma_lower: number | null;
  Gamma_upper: number | null;
  picture_id: string; // "-" => no image yet
};

type Dataset = {
  id: string;
  source_csv: string;
  meta?: Record<string, unknown>;
  regions: Region[];
};

const DATASETS: Record<`${Fluid}_${Sweep}`, Dataset> = {
  water_up: waterUp as Dataset,
  water_down: waterDown as Dataset,
  mineral_oil_up: mineralOilUp as Dataset,
  mineral_oil_down: mineralOilDown as Dataset,
};

// ---------- helpers ----------
function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dd = d1 - d0;
  const rr = r1 - r0;
  return (x: number) => (dd === 0 ? (r0 + r1) / 2 : r0 + ((x - d0) / dd) * rr);
}

function niceNum(x: number) {
  if (!Number.isFinite(x)) return String(x);
  const abs = Math.abs(x);
  if (abs === 0) return "0";
  if (abs >= 10) return x.toFixed(2);
  if (abs >= 1) return x.toFixed(3);
  return x.toFixed(4);
}

function toPngName(pictureId: string) {
  return pictureId.replace(/\.tiff?$/i, ".png");
}

function getImageCandidates(fluid: Fluid, pictureId: string) {
  // Vite 在 GH pages 下 BASE_URL 会是 "/FAR/"，本地 dev 是 "/"
  const base = import.meta.env.BASE_URL; // always ends with "/"
  const png = `${base}patterns_png/${fluid}/${toPngName(pictureId)}`;
  const orig = `${base}patterns/${fluid}/${pictureId}`;
  return [png, orig];
}

function useGlobalClickClose(onClose: () => void, enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    const onDown = () => onClose();
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [enabled, onClose]);
}

function useEscClose(onClose: () => void, enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onClose]);
}

function makeTicks(min: number, max: number, step: number) {
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

// boundary：每个 frequency 取最小 Gamma_lower（最早出现 pattern 的阈值）
function extractLowerBoundary(regions: Region[]) {
  const map = new Map<number, number>();

  for (const r of regions) {
    if (r.Frequency == null || r.Gamma_lower == null) continue;

    // ✅ 忽略 base state（你的 "-" 年轮状）
    if (r.picture_id === "-") continue;

    // ✅ 也可以再保险：忽略 0（避免有人把 picture_id 填错）
    if (r.Gamma_lower <= 0) continue;

    const f = r.Frequency;
    const g = r.Gamma_lower;

    if (!map.has(f) || g < (map.get(f) as number)) {
      map.set(f, g);
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([f, g]) => ({ f, g }));
}

// ---------- styles ----------
const btnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.92)",
  cursor: "pointer",
  fontSize: 13.5,
  fontWeight: 650,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 8px)",
  minWidth: 180,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(20,20,22,0.98)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 6,
  zIndex: 10,
};

const menuItemStyle = (active: boolean): React.CSSProperties => ({
  width: "100%",
  textAlign: "left",
  padding: "9px 10px",
  borderRadius: 12,
  border: "none",
  background: active ? "rgba(255,255,255,0.10)" : "transparent",
  color: "rgba(255,255,255,0.92)",
  cursor: "pointer",
  fontSize: 13.5,
});

const codeStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.10)",
  padding: "1px 6px",
  borderRadius: 8,
};

// ---------- App router shell ----------
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PhaseMapPage />} />
      <Route path="/overlay" element={<OverlayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ---------- Page 1: 原相图 ----------
function PhaseMapPage() {
  const [fluid, setFluid] = React.useState<Fluid>("water");
  const [sweep, setSweep] = React.useState<Sweep>("down");
  const [openMenu, setOpenMenu] = React.useState<"fluid" | "sweep" | null>(null);

  const datasetKey = `${fluid}_${sweep}` as const;
  const ds = DATASETS[datasetKey];

  const [active, setActive] = React.useState<Region | null>(null);
  useGlobalClickClose(() => setOpenMenu(null), openMenu !== null);
  useEscClose(() => setActive(null), active !== null);

  // 只依赖中心频率，固定 df=1：每块 [f-0.5, f+0.5]
  const regions = ds.regions.filter((r) => r.Frequency !== null && r.Gamma_lower !== null);

  const fCenters = regions.map((r) => r.Frequency as number);
  const fMin = Math.min(...fCenters) - 0.5;
  const fMax = Math.max(...fCenters) + 0.5;

  const gammaCandidates: number[] = [];
  for (const r of regions) {
    if (typeof r.Gamma_lower === "number") gammaCandidates.push(r.Gamma_lower);
    if (typeof r.Gamma_upper === "number") gammaCandidates.push(r.Gamma_upper);
  }
  const gBaseMax = gammaCandidates.length ? Math.max(...gammaCandidates) : 1;
  const gMax = gBaseMax + Math.max(0.05, gBaseMax * 0.1);
  const gMin = 0;

  // SVG layout
  const W = 980;
  const H = 620;
  const pad = { l: 80, r: 26, t: 22, b: 78 };

  const x = scaleLinear([fMin, fMax], [pad.l, W - pad.r]);
  const y = scaleLinear([gMin, gMax], [H - pad.b, pad.t]);

  const xTicks = makeTicks(fMin, fMax, 0.5);
  const yTicks = makeTicks(gMin, gMax, 0.05);

  const prettyFluid = fluid === "water" ? "Water" : "Mineral Oil";
  const prettySweep = sweep === "up" ? "Sweep up" : "Sweep down";

  return (
    <div style={pageShellStyle}>
      <div style={{ width:"min(1400px, 95vw)", margin: "0 auto" }}>
        <Header
          title="FAR Phase Diagram"
          subtitle={`Dataset: ${ds.id} · ${ds.source_csv}`}
          right={
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Link to="/overlay" style={btnStyle}>
                Overlay View →
              </Link>

              {/* Fluid dropdown */}
              <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => setOpenMenu((v) => (v === "fluid" ? null : "fluid"))} style={btnStyle}>
                  {prettyFluid} ▾
                </button>
                {openMenu === "fluid" && (
                  <div style={menuStyle}>
                    <button
                      style={menuItemStyle(fluid === "water")}
                      onClick={() => {
                        setFluid("water");
                        setOpenMenu(null);
                      }}
                    >
                      Water
                    </button>
                    <button
                      style={menuItemStyle(fluid === "mineral_oil")}
                      onClick={() => {
                        setFluid("mineral_oil");
                        setOpenMenu(null);
                      }}
                    >
                      Mineral Oil
                    </button>
                  </div>
                )}
              </div>

              {/* Sweep dropdown */}
              <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => setOpenMenu((v) => (v === "sweep" ? null : "sweep"))} style={btnStyle}>
                  {prettySweep} ▾
                </button>
                {openMenu === "sweep" && (
                  <div style={menuStyle}>
                    <button
                      style={menuItemStyle(sweep === "up")}
                      onClick={() => {
                        setSweep("up");
                        setOpenMenu(null);
                      }}
                    >
                      Sweep up
                    </button>
                    <button
                      style={menuItemStyle(sweep === "down")}
                      onClick={() => {
                        setSweep("down");
                        setOpenMenu(null);
                      }}
                    >
                      Sweep down
                    </button>
                  </div>
                )}
              </div>
            </div>
          }
        />

        <PlotCard>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} shapeRendering="crispEdges">
            {/* plot background */}
            <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="white" />

            {/* y ticks */}
            {yTicks.map((t) => {
              const yy = y(t);
              return (
                <g key={`yt-${t}`}>
                  <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="rgba(0,0,0,0.08)" />
                  <line x1={pad.l - 6} y1={yy} x2={pad.l} y2={yy} stroke="white" />
                  <text x={pad.l - 10} y={yy + 4} textAnchor="end" fill="white" fontSize={12}>
                    {t.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* x ticks */}
            {xTicks.map((t) => {
              const xx = x(t);
              return (
                <g key={`xt-${t}`}>
                  <line x1={xx} y1={pad.t} x2={xx} y2={H - pad.b} stroke="rgba(0,0,0,0.08)" />
                  <line x1={xx} y1={H - pad.b} x2={xx} y2={H - pad.b + 6} stroke="white" />
                  <text x={xx} y={H - pad.b + 22} textAnchor="middle" fill="white" fontSize={12}>
                    {t}
                  </text>
                </g>
              );
            })}

            {/* regions: white fill + black border */}
            {regions.map((r) => {
              const f0 = r.Frequency as number;
              const fmin = f0 - 0.25;
              const fmax = f0 + 0.25;
              const g0 = r.Gamma_lower as number;
              const g1 = (r.Gamma_upper ?? gMax) as number;

              const rx = x(fmin);
              const ry = y(g1);
              const rw = Math.max(1, x(fmax) - x(fmin));
              const rh = Math.max(1, y(g0) - y(g1));

              return (
                <rect
                  key={`${f0}-${r.index}`}
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill="white"
                  stroke="black"
                  strokeWidth={1}
                  onClick={() => setActive(r)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}

            {/* axes */}
            <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="white" strokeWidth={1.2} />
            <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="white" strokeWidth={1.2} />

            <text x={(pad.l + (W - pad.r)) / 2} y={H - 18} textAnchor="middle" fill="white" fontSize={14} fontWeight={700}>
              Frequency (Hz)
            </text>
            <text
              x={18}
              y={H / 2}
              textAnchor="middle"
              fill="white"
              fontSize={14}
              fontWeight={700}
              transform={`rotate(-90 18 ${H / 2})`}
            >
              Γ (dimensionless)
            </text>
          </svg>

          <div style={cardFooterStyle}>
            Click any region to view the corresponding pattern image. If picture_id is "-", it will show <b>No image yet</b>.
          </div>
        </PlotCard>

        {active && <PatternModal fluid={fluid} sweep={sweep} region={active} onClose={() => setActive(null)} gMaxFallback={gMax} />}
      </div>
    </div>
  );
}

// ---------- Page 2: 新界面（叠加 up/down boundary） ----------
function OverlayPage() {
  const navigate = useNavigate();
  const [fluid, setFluid] = React.useState<Fluid>("water");
  const [openMenu, setOpenMenu] = React.useState<"fluid" | null>(null);
  const [showRegions, setShowRegions] = React.useState(true);

  useGlobalClickClose(() => setOpenMenu(null), openMenu !== null);

  const up = DATASETS[`${fluid}_up`].regions.filter((r) => r.Frequency !== null && r.Gamma_lower !== null);
  const down = DATASETS[`${fluid}_down`].regions.filter((r) => r.Frequency !== null && r.Gamma_lower !== null);

  const upBoundary = extractLowerBoundary(up);
  const downBoundary = extractLowerBoundary(down);

  // bounds from BOTH sweeps
  const fCenters = [...up, ...down].map((r) => r.Frequency as number);
  const fMin = Math.min(...fCenters) - 0.5;
  const fMax = Math.max(...fCenters) + 0.5;

  const gammaCandidates: number[] = [];
  for (const r of [...up, ...down]) {
    if (typeof r.Gamma_lower === "number") gammaCandidates.push(r.Gamma_lower);
    if (typeof r.Gamma_upper === "number") gammaCandidates.push(r.Gamma_upper);
  }
  const gBaseMax = gammaCandidates.length ? Math.max(...gammaCandidates) : 1;
  const gMax = gBaseMax + Math.max(0.05, gBaseMax * 0.1);
  const gMin = 0;

  // SVG
  const W = 980;
  const H = 620;
  const pad = { l: 80, r: 26, t: 22, b: 78 };
  const x = scaleLinear([fMin, fMax], [pad.l, W - pad.r]);
  const y = scaleLinear([gMin, gMax], [H - pad.b, pad.t]);

  const xTicks = makeTicks(fMin, fMax, 0.5);
  const yTicks = makeTicks(gMin, gMax, 0.05);

  const prettyFluid = fluid === "water" ? "Water" : "Mineral Oil";

  // polyline points
  const upPts = upBoundary.map((p) => `${x(p.f)},${y(p.g)}`).join(" ");
  const downPts = downBoundary.map((p) => `${x(p.f)},${y(p.g)}`).join(" ");

  return (
    <div style={pageShellStyle}>
      <div style={{ width: "min(1400px, 95vw)", margin: "0 auto" }}>
        <Header
          title="Overlay View"
          subtitle="Up vs Down lower-threshold boundary (hysteresis)"
          right={
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => navigate("/")} style={btnStyle}>
                ← Back
              </button>

              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13.5, opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={showRegions}
                  onChange={(e) => setShowRegions(e.target.checked)}
                  style={{ transform: "translateY(1px)" }}
                />
                Show regions
              </label>

              {/* fluid dropdown */}
              <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => setOpenMenu((v) => (v === "fluid" ? null : "fluid"))} style={btnStyle}>
                  {prettyFluid} ▾
                </button>
                {openMenu === "fluid" && (
                  <div style={menuStyle}>
                    <button
                      style={menuItemStyle(fluid === "water")}
                      onClick={() => {
                        setFluid("water");
                        setOpenMenu(null);
                      }}
                    >
                      Water
                    </button>
                    <button
                      style={menuItemStyle(fluid === "mineral_oil")}
                      onClick={() => {
                        setFluid("mineral_oil");
                        setOpenMenu(null);
                      }}
                    >
                      Mineral Oil
                    </button>
                  </div>
                )}
              </div>
            </div>
          }
        />

        <PlotCard>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} shapeRendering="crispEdges">
            <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="white" />

            {/* y ticks */}
            {yTicks.map((t) => {
              const yy = y(t);
              return (
                <g key={`yt-${t}`}>
                  <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="rgba(0,0,0,0.08)" />
                  <line x1={pad.l - 6} y1={yy} x2={pad.l} y2={yy} stroke="white" />
                  <text x={pad.l - 10} y={yy + 4} textAnchor="end" fill="white" fontSize={12}>
                    {t.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* x ticks */}
            {xTicks.map((t) => {
              const xx = x(t);
              return (
                <g key={`xt-${t}`}>
                  <line x1={xx} y1={pad.t} x2={xx} y2={H - pad.b} stroke="rgba(0,0,0,0.08)" />
                  <line x1={xx} y1={H - pad.b} x2={xx} y2={H - pad.b + 6} stroke="white" />
                  <text x={xx} y={H - pad.b + 22} textAnchor="middle" fill="white" fontSize={12}>
                    {t}
                  </text>
                </g>
              );
            })}

            {/* optional regions (pick DOWN as base) */}
            {showRegions &&
              down.map((r) => {
                const f0 = r.Frequency as number;
                const fmin = f0 - 0.25;
                const fmax = f0 + 0.25;
                const g0 = r.Gamma_lower as number;
                const g1 = (r.Gamma_upper ?? gMax) as number;

                const rx = x(fmin);
                const ry = y(g1);
                const rw = Math.max(1, x(fmax) - x(fmin));
                const rh = Math.max(1, y(g0) - y(g1));

                return <rect key={`${f0}-${r.index}`} x={rx} y={ry} width={rw} height={rh} fill="white" stroke="black" strokeWidth={1} />;
              })}

            {/* overlay boundaries */}
            <polyline fill="none" stroke="red" strokeWidth={2.2} points={upPts} />
            <polyline fill="none" stroke="blue" strokeWidth={2.2} strokeDasharray="6 4" points={downPts} />

            {/* axes */}
            <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="white" strokeWidth={1.2} />
            <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="white" strokeWidth={1.2} />

            <text x={(pad.l + (W - pad.r)) / 2} y={H - 18} textAnchor="middle" fill="white" fontSize={14} fontWeight={700}>
              Frequency (Hz)
            </text>
            <text
              x={18}
              y={H / 2}
              textAnchor="middle"
              fill="white"
              fontSize={14}
              fontWeight={700}
              transform={`rotate(-90 18 ${H / 2})`}
            >
              Γ (dimensionless)
            </text>
          </svg>

          <div style={cardFooterStyle}>
            <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              <span>
                <span style={{ color: "red", fontWeight: 800 }}>—</span> sweep up threshold
              </span>
              <span>
                <span style={{ color: "deepskyblue", fontWeight: 800 }}>- -</span> sweep down threshold
              </span>
            </span>
          </div>
        </PlotCard>
      </div>
    </div>
  );
}

// ---------- Modal ----------
function PatternModal({
  fluid,
  sweep,
  region,
  onClose,
  gMaxFallback,
}: {
  fluid: Fluid;
  sweep: Sweep;
  region: Region;
  onClose: () => void;
  gMaxFallback: number;
}) {
  const hasImage = region.picture_id !== "-" && region.picture_id.trim() !== "";

  const [src, setSrc] = React.useState<string | null>(null);
  const [tryIndex, setTryIndex] = React.useState(0);
  const candidates = React.useMemo(() => (hasImage ? getImageCandidates(fluid, region.picture_id) : []), [fluid, region.picture_id, hasImage]);

  React.useEffect(() => {
    if (!hasImage) return;
    setTryIndex(0);
    setSrc(candidates[0] ?? null);
  }, [hasImage, candidates]);

  const onImgError = () => {
    const next = tryIndex + 1;
    if (next < candidates.length) {
      setTryIndex(next);
      setSrc(candidates[next]);
    } else {
      setSrc(null);
    }
  };

  const f = region.Frequency ?? NaN;
  const g0 = region.Gamma_lower ?? NaN;
  const g1 = region.Gamma_upper ?? gMaxFallback;

  const titleFluid = fluid === "water" ? "Water" : "Mineral Oil";
  const titleSweep = sweep === "up" ? "Sweep up" : "Sweep down";

  return (
    <div onMouseDown={onClose} style={modalBackdropStyle}>
      <div onMouseDown={(e) => e.stopPropagation()} style={modalCardStyle}>
        <div style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 800 }}>
              {titleFluid} · {titleSweep}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
              f = <b>{niceNum(f)}</b> Hz <span style={{ opacity: 0.55 }}>·</span> Γ ∈ [{niceNum(g0)}, {region.Gamma_upper == null ? "—" : niceNum(g1)}]
            </div>
            <div style={{ marginTop: 6, fontSize: 12.5, opacity: 0.7 }}>
              picture_id: <span style={{ opacity: 0.95 }}>{region.picture_id}</span>
            </div>
          </div>

          <button onClick={onClose} style={btnStyle}>
            Close
          </button>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          {!hasImage ? (
            <div style={{ padding: 18, fontSize: 14, opacity: 0.85 }}>
              <b>No image yet.</b>
              <div style={{ marginTop: 6, opacity: 0.7 }}>(picture_id is "-".)</div>
            </div>
          ) : src ? (
            <div style={{ padding: 12 }}>
              <img
                src={src}
                alt={region.picture_id}
                onError={onImgError}
                style={{ width: "100%", borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", display: "block" }}
              />
              <div style={{ marginTop: 8, fontSize: 12.5, opacity: 0.75 }}>
                Loading order: <code style={codeStyle}>/patterns_png/</code> then fallback <code style={codeStyle}>/patterns/</code>
              </div>
            </div>
          ) : (
            <div style={{ padding: 18, fontSize: 14, opacity: 0.85 }}>
              <b>Image file not found or unsupported.</b>
              <div style={{ marginTop: 6, opacity: 0.7 }}>
                Check <code style={codeStyle}>public/patterns_png/{fluid}/</code>.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- small layout components ----------
function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 750, letterSpacing: 0.2 }}>{title}</div>
        <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 4 }}>{subtitle}</div>
      </div>
      {right}
    </div>
  );
}

function PlotCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.03)",
        overflow: "hidden",
        boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
      }}
    >
      {children}
    </div>
  );
}

// ---------- shared styles ----------
const pageShellStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, rgba(18,18,20,1), rgba(10,10,12,1))",
  color: "rgba(255,255,255,0.92)",
  padding: 18,
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
};

const cardFooterStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12.5,
  opacity: 0.78,
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

const modalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.62)",
  display: "grid",
  placeItems: "center",
  padding: 16,
  zIndex: 50,
};

const modalCardStyle: React.CSSProperties = {
  width: "min(980px, 96vw)",
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(18,18,20,0.98)",
  boxShadow: "0 26px 90px rgba(0,0,0,0.55)",
  overflow: "hidden",
};