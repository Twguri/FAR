import React from "react";
import { Routes, Route, Link, useNavigate, Navigate } from "react-router-dom";

import waterUp from "./datasets/json/water_up.json";
import waterDown from "./datasets/json/water_down.json";
import mineralOilUp from "./datasets/json/mineral_oil_up.json";
import mineralOilDown from "./datasets/json/mineral_oil_down.json";

type Fluid = "water" | "mineral_oil";
type Sweep = "up" | "down";

type PictureItem = {
  id: string;
  color?: string | null;
};

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

  picture_id: string; // legacy
  picture_items?: PictureItem[]; // new
  color?: string | null; // region summary color
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

function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dd = d1 - d0;
  const rr = r1 - r0;
  return (x: number) => (dd === 0 ? (r0 + r1) / 2 : r0 + ((x - d0) / dd) * rr);
}

function makeTicks(min: number, max: number, step: number) {
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
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

// ✅ GitHub Pages base-aware paths
function getImageCandidates(fluid: Fluid, pictureId: string) {
  const base = import.meta.env.BASE_URL; // ends with "/"
  const png = `${base}patterns_png/${fluid}/${toPngName(pictureId)}`;
  const orig = `${base}patterns/${fluid}/${pictureId}`;
  return [png, orig];
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

function useGlobalClickClose(onClose: () => void, enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    const onDown = () => onClose();
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [enabled, onClose]);
}

// boundary: per frequency choose minimal Gamma_lower among *non-base* regions
function extractLowerBoundary(regions: Region[]) {
  const map = new Map<number, number>();
  for (const r of regions) {
    if (r.Frequency == null || r.Gamma_lower == null) continue;
    // ignore base state (no images)
    const items = r.picture_items ?? [];
    const hasAnyImage = items.length > 0 || (r.picture_id && r.picture_id !== "-");
    if (!hasAnyImage) continue;
    if (r.Gamma_lower <= 0) continue;

    const f = r.Frequency;
    const g = r.Gamma_lower;
    if (!map.has(f) || g < (map.get(f) as number)) map.set(f, g);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([f, g]) => ({ f, g }));
}

const LEGEND = [
  { color: "blue", label: "Rings" },
  { color: "purple", label: "Two-ring superposition" },
  { color: "red", label: "Central + rings superposition" },
  { color: "brown", label: "Multiple patterns (periodic evolution)" },
  { color: "black", label: "3+ patterns superposition" },
] as const;

function legendBox() {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(20,20,22,0.92)",
        padding: 10,
        minWidth: 220,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>Legend</div>
      <div style={{ display: "grid", gap: 6 }}>
        {LEGEND.map((it) => (
          <div key={it.color} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, opacity: 0.92 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                background: it.color,
                display: "inline-block",
              }}
            />
            <span style={{ opacity: 0.95 }}>{it.label}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.72 }}>
        Rect stroke color = phase category
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PhaseMapPage />} />
      <Route path="/overlay" element={<OverlayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PhaseMapPage() {
  const [fluid, setFluid] = React.useState<Fluid>("water");
  const [sweep, setSweep] = React.useState<Sweep>("down");
  const [openMenu, setOpenMenu] = React.useState<"fluid" | "sweep" | null>(null);

  const key = `${fluid}_${sweep}` as const;
  const ds = DATASETS[key];

  const [active, setActive] = React.useState<Region | null>(null);
  useEscClose(() => setActive(null), active !== null);
  useGlobalClickClose(() => setOpenMenu(null), openMenu !== null);

  const regions = ds.regions.filter((r) => r.Frequency !== null && r.Gamma_lower !== null);

  const fCenters = regions.map((r) => r.Frequency as number);
  const fMin = Math.min(...fCenters) - 0.25;
  const fMax = Math.max(...fCenters) + 0.25;

  const gammaCandidates: number[] = [];
  for (const r of regions) {
    if (typeof r.Gamma_lower === "number") gammaCandidates.push(r.Gamma_lower);
    if (typeof r.Gamma_upper === "number") gammaCandidates.push(r.Gamma_upper);
  }
  const gBaseMax = gammaCandidates.length ? Math.max(...gammaCandidates) : 1;
  const gMax = gBaseMax + Math.max(0.05, gBaseMax * 0.1);
  const gMin = 0;

  const W = 1400;
  const H = 850;
  const pad = { l: 86, r: 28, t: 22, b: 82 };

  const x = scaleLinear([fMin, fMax], [pad.l, W - pad.r]);
  const y = scaleLinear([gMin, gMax], [H - pad.b, pad.t]);

  const xTicks = makeTicks(fMin, fMax, 0.5);
  const yTicks = makeTicks(gMin, gMax, 0.05);

  const prettyFluid = fluid === "water" ? "Water" : "Mineral Oil";
  const prettySweep = sweep === "up" ? "Sweep up" : "Sweep down";

  return (
    <div style={pageShellStyle}>
      <div style={{ width: "min(1400px, 95vw)", margin: "0 auto" }}>
        <Header
          title="FAR Phase Diagram"
          subtitle={`Dataset: ${ds.id} · ${ds.source_csv}`}
          right={
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
              <Link to="/overlay" style={btnStyle}>
                Overlay View →
              </Link>

              <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => setOpenMenu((v) => (v === "fluid" ? null : "fluid"))} style={btnStyle}>
                  {prettyFluid} ▾
                </button>
                {openMenu === "fluid" && (
                  <div style={menuStyle}>
                    <button style={menuItemStyle(fluid === "water")} onClick={() => (setFluid("water"), setOpenMenu(null))}>
                      Water
                    </button>
                    <button
                      style={menuItemStyle(fluid === "mineral_oil")}
                      onClick={() => (setFluid("mineral_oil"), setOpenMenu(null))}
                    >
                      Mineral Oil
                    </button>
                  </div>
                )}
              </div>

              <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => setOpenMenu((v) => (v === "sweep" ? null : "sweep"))} style={btnStyle}>
                  {prettySweep} ▾
                </button>
                {openMenu === "sweep" && (
                  <div style={menuStyle}>
                    <button style={menuItemStyle(sweep === "up")} onClick={() => (setSweep("up"), setOpenMenu(null))}>
                      Sweep up
                    </button>
                    <button
                      style={menuItemStyle(sweep === "down")}
                      onClick={() => (setSweep("down"), setOpenMenu(null))}
                    >
                      Sweep down
                    </button>
                  </div>
                )}
              </div>

              {legendBox()}
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

            {/* regions: fill white; stroke depends on region.color; default black */}
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

              const stroke = r.color ? String(r.color) : "black";
              const strokeWidth = r.color ? 2 : 1;

              return (
                <rect
                  key={`${f0}-${r.index}`}
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill={r.color ? r.color : "white"} 
                  stroke="black"
                  strokeWidth={strokeWidth}
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

          <div style={cardFooterStyle}>Click any region to view the corresponding pattern image(s).</div>
        </PlotCard>

        {active && <PatternModal fluid={fluid} sweep={sweep} region={active} onClose={() => setActive(null)} gMaxFallback={gMax} />}
      </div>
    </div>
  );
}

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

  const fCenters = [...up, ...down].map((r) => r.Frequency as number);
  const fMin = Math.min(...fCenters) - 0.25;
  const fMax = Math.max(...fCenters) + 0.25;

  const gammaCandidates: number[] = [];
  for (const r of [...up, ...down]) {
    if (typeof r.Gamma_lower === "number") gammaCandidates.push(r.Gamma_lower);
    if (typeof r.Gamma_upper === "number") gammaCandidates.push(r.Gamma_upper);
  }
  const gBaseMax = gammaCandidates.length ? Math.max(...gammaCandidates) : 1;
  const gMax = gBaseMax + Math.max(0.05, gBaseMax * 0.1);
  const gMin = 0;

  const W = 1400;
  const H = 850;
  const pad = { l: 86, r: 28, t: 22, b: 82 };

  const x = scaleLinear([fMin, fMax], [pad.l, W - pad.r]);
  const y = scaleLinear([gMin, gMax], [H - pad.b, pad.t]);

  const xTicks = makeTicks(fMin, fMax, 0.5);
  const yTicks = makeTicks(gMin, gMax, 0.05);

  const prettyFluid = fluid === "water" ? "Water" : "Mineral Oil";
  const upPts = upBoundary.map((p) => `${x(p.f)},${y(p.g)}`).join(" ");
  const downPts = downBoundary.map((p) => `${x(p.f)},${y(p.g)}`).join(" ");

  return (
    <div style={pageShellStyle}>
      <div style={{ width: "min(1400px, 95vw)", margin: "0 auto" }}>
        <Header
          title="Overlay View"
          subtitle="Up vs Down lower-threshold boundary (hysteresis)"
          right={
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
              <button onClick={() => navigate("/")} style={btnStyle}>
                ← Back
              </button>

              <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13.5, opacity: 0.9 }}>
                <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} />
                Show regions
              </label>

              <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
                <button onClick={() => setOpenMenu((v) => (v === "fluid" ? null : "fluid"))} style={btnStyle}>
                  {prettyFluid} ▾
                </button>
                {openMenu === "fluid" && (
                  <div style={menuStyle}>
                    <button style={menuItemStyle(fluid === "water")} onClick={() => (setFluid("water"), setOpenMenu(null))}>
                      Water
                    </button>
                    <button
                      style={menuItemStyle(fluid === "mineral_oil")}
                      onClick={() => (setFluid("mineral_oil"), setOpenMenu(null))}
                    >
                      Mineral Oil
                    </button>
                  </div>
                )}
              </div>

              {legendBox()}
            </div>
          }
        />

        <PlotCard>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} shapeRendering="crispEdges">
            <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="white" />

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

            {/* optional regions (use DOWN as base), keep colored strokes */}
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

                const stroke = r.color ? String(r.color) : "black";
                const strokeWidth = r.color ? 2 : 1;

                return <rect key={`${f0}-${r.index}`} x={rx} y={ry} width={rw} height={rh} fill="white" stroke={stroke} strokeWidth={strokeWidth} />;
              })}

            {/* overlay boundaries */}
            <polyline fill="none" stroke="red" strokeWidth={2.4} points={upPts} />
            <polyline fill="none" stroke="blue" strokeWidth={2.4} strokeDasharray="6 4" points={downPts} />

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
                <span style={{ color: "red", fontWeight: 900 }}>—</span> sweep up threshold
              </span>
              <span>
                <span style={{ color: "deepskyblue", fontWeight: 900 }}>- -</span> sweep down threshold
              </span>
            </span>
          </div>
        </PlotCard>
      </div>
    </div>
  );
}

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
  useEscClose(onClose, true);
  React.useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";  

    return () => {
      document.body.style.overflow = original; 
    };
  }, []);
  // resolve image list
  const items: PictureItem[] =
    region.picture_items && region.picture_items.length > 0
      ? region.picture_items
      : region.picture_id && region.picture_id !== "-"
      ? [{ id: region.picture_id, color: region.color }]
      : [];

  const hasImage = items.length > 0;

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
            <div style={{ fontSize: 16.5, fontWeight: 900 }}>
              {titleFluid} · {titleSweep}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.82 }}>
              f = <b>{niceNum(f)}</b> Hz <span style={{ opacity: 0.55 }}>·</span> Γ ∈ [{niceNum(g0)}, {region.Gamma_upper == null ? "—" : niceNum(g1)}]
            </div>
            <div style={{ marginTop: 6, fontSize: 12.5, opacity: 0.7 }}>
              region color:{" "}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: region.color ?? "transparent", border: "1px solid rgba(255,255,255,0.25)" }} />
                <span>{region.color ?? "—"}</span>
              </span>
            </div>
          </div>

          <button onClick={onClose} style={btnStyle}>
            Close
          </button>
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.10)" ,overflowY:"auto",maxHeight:"70vh"}}>
          {!hasImage ? (
            <div style={{ padding: 18, fontSize: 14, opacity: 0.85 }}>
              <b>No image yet.</b>
              <div style={{ marginTop: 6, opacity: 0.7 }}>(picture_id is "-")</div>
            </div>
          ) : (
            <div style={{ padding: 12, display: "grid", gap: 12 }}>
              {items.map((it) => (
                <div key={it.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 4, background: it.color ?? "transparent", border: "1px solid rgba(255,255,255,0.18)" }} />
                    <div style={{ fontSize: 12.5, opacity: 0.8 }}>{it.id}</div>
                  </div>
                  <ImgWithFallback fluid={fluid} id={it.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImgWithFallback({ fluid, id }: { fluid: Fluid; id: string }) {
  const candidates = getImageCandidates(fluid, id);
  const [idx, setIdx] = React.useState(0);

  return (
    <img
      src={candidates[idx]}
      onError={() => {
        if (idx + 1 < candidates.length) setIdx(idx + 1);
      }}
      alt={id}
      style={{
        width: "100%",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        display: "block",
      }}
    />
  );
}

function Header({ title, subtitle, right }: { title: string; subtitle: string; right: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0.2 }}>{title}</div>
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
const btnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.92)",
  cursor: "pointer",
  fontSize: 13.5,
  fontWeight: 750,
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
  alignItems: "flex-start",   
  overflowY: "hidden",
  padding: 16,
  zIndex: 50,
};

const modalCardStyle: React.CSSProperties = {
  width: "min(980px, 96vw)",
  marginTop: 16,
  maxHeight: "calc(100vh - 32px)",

  display: "flex",
  flexDirection: "column",
  overflow: "hidden",

  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(18,18,20,0.98)",
  boxShadow: "0 26px 90px rgba(0,0,0,0.55)",
};