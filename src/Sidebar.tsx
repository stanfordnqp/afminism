import type { ProcessingOptions, ScanRecord } from "./types";

interface Props {
  open: boolean;
  onToggle: () => void;
  opts: ProcessingOptions;
  onChange: (patch: Partial<ProcessingOptions>) => void;
  scans: ScanRecord[];
  onGenerateFigure: () => void;
  generatingFigure: boolean;
}

export default function Sidebar({ open, onToggle: _onToggle, opts, onChange, scans, onGenerateFigure, generatingFigure }: Props) {
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
          </div>
          {opts.doPlane && (
            <div className="sidebar-row" style={{ paddingLeft: 20 }}>
              <label htmlFor="planeSigma" style={{ color: "#666", fontSize: 11 }}>Sigma clip:</label>
              <input type="number" id="planeSigma" min={1} max={20} step={0.5}
                value={opts.planeSigma}
                onChange={(e) => onChange({ planeSigma: parseFloat(e.target.value) || 6 })}
                style={{ width: 54 }} />
            </div>
          )}

          <div className="sidebar-row">
            <input type="checkbox" id="doLines" checked={opts.doLines}
              onChange={(e) => onChange({ doLines: e.target.checked })} />
            <label htmlFor="doLines">Row leveling</label>
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* ── Display ── */}
        <div className="sidebar-section">
          <div className="sidebar-section-label">Display</div>

          <div className="sidebar-row">
            <input type="checkbox" id="doClip" checked={opts.doClip}
              onChange={(e) => onChange({ doClip: e.target.checked })} />
            <label htmlFor="doClip">Clip color range</label>
          </div>

          {opts.doClip && (
            <>
              <div style={{ marginBottom: 4, fontSize: 11, color: "#666", paddingLeft: 2 }}>
                Color range (σ) — out of range shown in red/blue
              </div>
              <div className="clim-range-row" style={{ marginBottom: 4 }}>
                <span>Min</span>
                <input type="number" min={0.05} max={opts.climMax - 0.5} step={0.25}
                  value={opts.climMin}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 0.05;
                    onChange({ climMin: v, climSigma: Math.max(opts.climSigma, v) });
                  }} />
                <input type="range" min={opts.climMin} max={opts.climMax} step={0.25}
                  value={opts.climSigma}
                  onChange={(e) => onChange({ climSigma: parseFloat(e.target.value) })} />
                <input type="number" min={opts.climMin + 0.5} step={0.25}
                  value={opts.climMax}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value) || 20;
                    onChange({ climMax: v, climSigma: Math.min(opts.climSigma, v) });
                  }} />
                <span>Max</span>
              </div>
              <div className="clim-range-row">
                <label htmlFor="climVal" style={{ color: "#444" }}>σ =</label>
                <input type="number" id="climVal" min={opts.climMin} max={opts.climMax} step={0.25}
                  value={opts.climSigma}
                  onChange={(e) => onChange({ climSigma: parseFloat(e.target.value) || opts.climSigma })}
                  style={{ width: 60 }} />
              </div>
            </>
          )}

          <div className="sidebar-divider" style={{ margin: "10px 0" }} />

          {/* Columns: +/- increment */}
          <div className="sidebar-row">
            <span style={{ color: "#555", fontSize: 12 }}>Columns:</span>
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

        {/* ── Export ── */}
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
