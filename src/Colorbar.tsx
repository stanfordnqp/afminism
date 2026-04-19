import { useEffect, useRef } from "react";
import { drawColormapStrip, fmtCbVal } from "./colormap";
import type { ColormapName } from "./colormap";

interface Props {
  vmin: number;
  vmax: number;
  expanded?: boolean;
  colormap?: ColormapName;
}

export default function Colorbar({ vmin, vmax, expanded = false, colormap = "afmhot" }: Props) {
  const stripRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = stripRef.current;
    if (!canvas) return;
    function draw() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const h = canvas.clientHeight;
      const w = canvas.clientWidth;
      if (!h || !w) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      drawColormapStrip(canvas.getContext("2d")!, canvas.width, canvas.height, colormap);
    }
    const obs = new ResizeObserver(draw);
    obs.observe(canvas);
    draw();
    return () => obs.disconnect();
  }, [colormap]);

  const mid = (vmin + vmax) / 2;
  const cls = expanded ? "colorbar-side colorbar-side--expanded" : "colorbar-side";

  return (
    <div className={cls}>
      <span className="colorbar-unit">nm</span>
      <div className="colorbar-body">
        <canvas ref={stripRef} className="colorbar-strip" />
        <div className="colorbar-labels">
          <span className="cb-label">{fmtCbVal(vmax)}</span>
          <span className="cb-label cb-label--mid">{fmtCbVal(mid)}</span>
          <span className="cb-label">{fmtCbVal(vmin)}</span>
        </div>
      </div>
    </div>
  );
}
