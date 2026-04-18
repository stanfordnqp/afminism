import { useState } from "react";
import type { ProcessingOptions, ScanRecord } from "./types";

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="infotip-wrap">
      <button
        className="infotip-btn"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-label="More info"
        tabIndex={0}
      >ⓘ</button>
      {show && <span className="infotip-box" role="tooltip">{text}</span>}
    </span>
  );
}

interface Props {
  open: boolean;
  onToggle: (_: void) => void;
  opts: ProcessingOptions;
  onChange: (patch: Partial<ProcessingOptions>) => void;
  scans: ScanRecord[];
  onGenerateFigure: () => void;
  generatingFigure: boolean;
  sparkles: boolean;
  onSparklesToggle: () => void;
  isExpanded: boolean;
}

export default function Sidebar({ open, opts, onChange, scans, onGenerateFigure, generatingFigure, sparkles, onSparklesToggle, isExpanded }: Props) {
  const hasScans = scans.some((s) => !s.minimized);

  return (
    <div className={`sidebar${open ? "" : " collapsed"}`}>
      <div className="sidebar-inner">
        <div className="sidebar-header">
          <span className="sidebar-title">ayeahfeminist</span>
        </div>

        {/* ── Processing ── */}
        <div className="sidebar-section">
          <div className="sidebar-section-label">Processing</div>

          <div className="sidebar-row">
            <input type="checkbox" id="doPlane" checked={opts.doPlane}
              onChange={(e) => onChange({ doPlane: e.target.checked })} />
            <label htmlFor="doPlane">Plane leveling</label>
            <InfoTip text="Fits a tilted plane to the image and subtracts it. Removes large-scale tilt from the sample or scanner." />
          </div>
          {opts.doPlane && (
            <div className="sidebar-row" style={{ paddingLeft: 20 }}>
              <label htmlFor="planeSigma" style={{ color: "#666", fontSize: 11 }}>σ clip:</label>
              <input type="number" id="planeSigma" min={1} max={20} step={0.5}
                value={opts.planeSigma}
                onChange={(e) => onChange({ planeSigma: parseFloat(e.target.value) || 6 })}
                style={{ width: 54 }} />
              <InfoTip text="Sigma threshold for outlier rejection during plane fit. Pixels further than this many standard deviations from the fitted plane are excluded from the fit. Lower = more aggressive rejection." />
            </div>
          )}

          <div className="sidebar-row">
            <input type="checkbox" id="doLines" checked={opts.doLines}
              onChange={(e) => onChange({ doLines: e.target.checked })} />
            <label htmlFor="doLines">Row leveling</label>
            <InfoTip text="Subtracts the median height from each scan row independently. Removes slow horizontal drift and inter-line offsets." />
          </div>

          <div className="sidebar-divider" style={{ margin: "10px 0" }} />

          <div className="sidebar-row">
            <input type="checkbox" id="doClip" checked={opts.doClip}
              onChange={(e) => onChange({ doClip: e.target.checked })} />
            <label htmlFor="doClip">Clip color range</label>
            <InfoTip text="Limits the colormap to ±Nσ around the mean. Pixels outside this range are shown in red (high) or blue (low), making features within the surface more visible." />
          </div>

          {opts.doClip && (
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
                  <span className="clim-label">σ =</span>
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

        {/* ── Grid-only controls ── */}
        {!isExpanded && (
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

            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="sidebar-section-label">Export</div>
              <button
                className="sidebar-btn primary"
                onClick={onGenerateFigure}
                disabled={!hasScans || generatingFigure}
              >
                <FigureIcon />
                {generatingFigure ? "Generating…" : "Generate figure"}
              </button>
            </div>
          </>
        )}

        <div className="sidebar-divider" />

        {/* ── Sparkles ── */}
        <div className="sidebar-section" style={{ paddingBottom: 16 }}>
          <div className="sidebar-row" style={{ justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#444" }}>✨ Sparkles</span>
            <label className="toggle-switch" title={sparkles ? "Disable sparkles" : "Enable sparkles"}>
              <input type="checkbox" checked={sparkles} onChange={onSparklesToggle} />
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function FigureIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="14" height="14" rx="2"/>
      <path d="M1 11l4-4 3 3 3-4 4 5"/>
    </svg>
  );
}
