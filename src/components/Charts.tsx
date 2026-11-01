import type { HRSample } from '../types';
import { ZONE_COLORS, ZONE_NAMES } from '../lib/hr';
import { clock, duration } from '../lib/format';

export function HRChart({ samples, bounds, height = 140 }: { samples: HRSample[]; bounds: number[]; height?: number }) {
  if (samples.length < 2) return null;
  const W = 600;
  const H = height;
  const tMax = samples[samples.length - 1].t || 1;
  const lo = Math.min(bounds[0] - 10, ...samples.map((s) => s.bpm)) - 5;
  const hi = Math.max(bounds[5], ...samples.map((s) => s.bpm)) + 5;
  const x = (t: number) => (t / tMax) * W;
  const y = (b: number) => H - ((b - lo) / (hi - lo)) * H;
  const step = Math.max(1, Math.floor(samples.length / 400));
  const pts = samples.filter((_, i) => i % step === 0).map((s) => `${x(s.t).toFixed(1)},${y(s.bpm).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H + 18}`} preserveAspectRatio="none" role="img" aria-label="График пульса">
      {bounds.slice(0, 5).map((b, i) => (
        <rect key={i} x={0} width={W} y={y(bounds[i + 1])} height={Math.max(0, y(b) - y(bounds[i + 1]))} fill={ZONE_COLORS[i]} opacity={0.1} />
      ))}
      <polyline points={pts} fill="none" stroke="var(--red)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <text x={2} y={H + 14} fontSize={12} fill="var(--text3)">0:00</text>
      <text x={W - 2} y={H + 14} fontSize={12} fill="var(--text3)" textAnchor="end">{clock(tMax)}</text>
    </svg>
  );
}

export function ZoneBars({ zoneSec, bounds }: { zoneSec: number[]; bounds?: number[] }) {
  const total = zoneSec.reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <div className="zonebar">
        {zoneSec.map((s, i) => (
          <div key={i} style={{ width: `${(s / total) * 100}%`, background: ZONE_COLORS[i] }} />
        ))}
      </div>
      <div className="zone-legend">
        {zoneSec.map((s, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <span className="dot" style={{ background: ZONE_COLORS[i] }} />
            <span>
              Z{i + 1} {ZONE_NAMES[i]}
              {bounds && <span className="faint"> · {bounds[i]}–{bounds[i + 1] - (i < 4 ? 1 : 0)}</span>}
            </span>
            <span className="faint">{duration(s)} · {Math.round((s / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Simple line chart for a numeric series (pace, speed…). */
export function LineChart({ values, color = 'var(--blue)', height = 100, invert = false }: { values: (number | null)[]; color?: string; height?: number; invert?: boolean }) {
  const v = values.filter((x): x is number => x != null && isFinite(x));
  if (v.length < 2) return null;
  const W = 600;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = values
    .map((val, i) => (val == null ? null : `${((i / (values.length - 1)) * W).toFixed(1)},${(invert ? ((val - lo) / span) * height : height - ((val - lo) / span) * height).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
