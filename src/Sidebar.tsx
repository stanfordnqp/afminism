import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { drawColormapStripH, COLORMAP_LABELS, COLORMAP_ORDER } from "./colormap";
import type { ColormapName } from "./colormap";
import type { ProcessingOptions } from "./types";

function ColormapSwatch({ name, selected, onClick }: { name: ColormapName; selected: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = c.offsetWidth || 64;
    c.height = c.offsetHeight || 14;
    drawColormapStripH(c.getContext("2d")!, c.width, c.height, name);
  }, [name]);
  return (
    <button
      className={`cmap-swatch${selected ? " cmap-swatch--active" : ""}`}
      onClick={onClick}
      title={COLORMAP_LABELS[name]}
    >
      <canvas ref={ref} className="cmap-canvas" />
      <span className="cmap-label">{COLORMAP_LABELS[name]}</span>
    </button>
  );
}

function InfoTip({ text }: { text: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const show = useCallback(() => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
  }, []);
  const hide = useCallback(() => setRect(null), []);

  return (
    <span className="infotip-wrap">
      <button
        ref={btnRef}
        className="infotip-btn"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label="More info"
        tabIndex={0}
      >ⓘ</button>
      {rect && createPortal(
        <span
          className="infotip-box"
          role="tooltip"
          style={{ top: rect.bottom + 6, left: rect.left }}
        >{text}</span>,
        document.body
      )}
    </span>
  );
}

interface Props {
  open: boolean;
  onToggle: (_: void) => void;
  opts: ProcessingOptions;
  onChange: (patch: Partial<ProcessingOptions>) => void;
  isExpanded: boolean;
  viewMode: "grid" | "psd";
  onSparklesToggle: () => void;
}

const MAX_POLY_ORDER = 5;

export default function Sidebar({ open, onToggle, opts, onChange, isExpanded, viewMode, onSparklesToggle }: Props) {
  function bumpPolyOrder() {
    const cur = isNaN(opts.polyOrder) ? 1 : (opts.polyOrder ?? 1);
    if (cur >= MAX_POLY_ORDER) return;
    onChange({ polyOrder: cur + 1 });
  }

  return (
    <div className={`sidebar${open ? "" : " collapsed"}`}>
      <div className="sidebar-inner">
        <div className="sidebar-header">
          <button className="sidebar-title" onClick={onSparklesToggle}>afminism💫</button>
          <button className="sidebar-toggle" onClick={() => onToggle()} title="Collapse sidebar (⌘B)">
            <SidebarPanelIcon />
          </button>
        </div>

        {/* ── Processing ── */}
        <div className="sidebar-section">
          <div className="sidebar-section-label">Processing</div>

          <div className="sidebar-row">
            <input type="checkbox" id="doPoly" checked={opts.doPoly}
              onChange={(e) => onChange({ doPoly: e.target.checked })} />
            <label htmlFor="doPoly">Polynomial leveling</label>
            <InfoTip text="Fits a polynomial surface to the image and subtracts it. Order 0 = mean, 1 = plane (tilt), 2 = paraboloid (bowl/saddle)." />
          </div>
          {opts.doPoly && (
            <>
              <div className="sidebar-row" style={{ paddingLeft: 20 }}>
                <span style={{ color: "#666", fontSize: 11 }}>Order:</span>
                <div className="col-stepper">
                  <button className="col-step-btn"
                    onClick={() => onChange({ polyOrder: Math.max(0, (opts.polyOrder || 1) - 1) })}
                    disabled={(opts.polyOrder || 0) <= 0}>−</button>
                  <span className="col-step-val">{isNaN(opts.polyOrder) ? 1 : (opts.polyOrder ?? 1)}</span>
                  <button className="col-step-btn" onClick={bumpPolyOrder}
                    disabled={(isNaN(opts.polyOrder) ? 1 : (opts.polyOrder ?? 1)) >= MAX_POLY_ORDER}
                    title={(isNaN(opts.polyOrder) ? 1 : (opts.polyOrder ?? 1)) >= MAX_POLY_ORDER ? "slow down buddy that's too much" : undefined}>+</button>
                </div>
                <InfoTip text="Polynomial order: 0 = mean, 1 = plane (tilt), 2 = paraboloid, 3+ = higher-order surface. Higher orders remove more complex background shapes." />
              </div>
              <div className="sidebar-row" style={{ paddingLeft: 20 }}>
                <label htmlFor="polySigma" style={{ color: "#666", fontSize: 11 }}>σ clip:</label>
                <input type="number" id="polySigma" min={1} max={20} step={0.5}
                  value={opts.polySigma}
                  onChange={(e) => onChange({ polySigma: parseFloat(e.target.value) || 6 })}
                  style={{ width: 54 }} />
                <InfoTip text="Sigma threshold for outlier rejection during polynomial fit. Pixels further than this many standard deviations from the fit are excluded and the surface is refit. Lower = more aggressive rejection." />
              </div>
            </>
          )}

          <div className="sidebar-row">
            <input type="checkbox" id="doLines" checked={opts.doLines}
              onChange={(e) => onChange({ doLines: e.target.checked })} />
            <label htmlFor="doLines">Row leveling</label>
            <InfoTip text="Subtracts the median height from each scan row independently. Removes slow horizontal drift and inter-line offsets." />
          </div>

          {viewMode !== "psd" && (
          <>
          <div className="sidebar-divider" style={{ margin: "10px 0" }} />

          <div className="sidebar-row">
            <input type="checkbox" id="doClip" checked={opts.doClip}
              onChange={(e) => onChange({ doClip: e.target.checked })} />
            <label htmlFor="doClip">Clip color range</label>
            <InfoTip text="Limits the colormap to ±Nσ around the mean. Pixels outside this range are shown in red (high) or blue (low), making features within the surface more visible." />
          </div>
          </>
          )}

          {opts.doClip && viewMode !== "psd" && (
            <div className="clim-block">
              <div className="clim-desc">Color range (σ) — out of range shown in red/blue</div>
              <input type="range" min={opts.climMin} max={opts.climMax} step={0.25}
                value={opts.climSigma}
                onChange={(e) => onChange({ climSigma: parseFloat(e.target.value) })}
                style={{ width: "100%", marginBottom: 6 }} />
              <div className="clim-inputs-row">
                <div className="clim-input-group">
                  <span className="clim-label">Min</span>
                  <input type="number" min={0.05} max={opts.climMax - 0.5} step={0.25}
                    value={opts.climMin}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0.05;
                      onChange({ climMin: v, climSigma: Math.max(opts.climSigma, v) });
                    }} />
                </div>
                <div className="clim-input-group">
                  <span className="clim-label">σ</span>
                  <input type="number" id="climVal" min={opts.climMin} max={opts.climMax} step={0.25}
                    value={opts.climSigma}
                    onChange={(e) => onChange({ climSigma: parseFloat(e.target.value) || opts.climSigma })} />
                </div>
                <div className="clim-input-group">
                  <span className="clim-label">Max</span>
                  <input type="number" min={opts.climMin + 0.5} step={0.25}
                    value={opts.climMax}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 20;
                      onChange({ climMax: v, climSigma: Math.min(opts.climSigma, v) });
                    }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Colormap ── */}
        {viewMode !== "psd" && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="sidebar-section-label">Colormap</div>
              <div className="cmap-grid">
                {COLORMAP_ORDER.map((cm) => (
                  <ColormapSwatch key={cm} name={cm} selected={opts.colormap === cm} onClick={() => onChange({ colormap: cm })} />
                ))}
              </div>
            </div>
          </>
        )}

        {/* Analysis: grid + expanded view */}
        {viewMode !== "psd" && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="sidebar-section-label">Analysis</div>
              <div className="sidebar-row">
                <input type="checkbox" id="showPsd" checked={opts.showPsd}
                  onChange={(e) => onChange({ showPsd: e.target.checked })} />
                <label htmlFor="showPsd">Show PSD</label>
                <InfoTip text="Displays the 1D radially-averaged Power Spectral Density. Log-log plot: x = spatial frequency (1/µm), y = PSD (nm²·µm²)." />
              </div>
            </div>
          </>
        )}

        {/* Grid + Export: grid view only */}
        {!isExpanded && viewMode !== "psd" && (
          <>

            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="sidebar-section-label">Grid</div>
              <div className="sidebar-row">
                <span style={{ color: "#555", fontSize: 12 }}>Columns:</span>
                <InfoTip text="Number of scan cards per row in the grid view." />
                <div className="col-stepper">
                  <button
                    className="col-step-btn"
                    onClick={() => onChange({ columns: Math.max(1, opts.columns - 1) })}
                    disabled={opts.columns <= 1}
                  >−</button>
                  <span className="col-step-val">{opts.columns}</span>
                  <button
                    className="col-step-btn"
                    onClick={() => onChange({ columns: opts.columns + 1 })}
                  >+</button>
                </div>
              </div>
            </div>

          </>
        )}

      </div>
    </div>
  );
}


function SidebarPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5"/>
    </svg>
  );
}
