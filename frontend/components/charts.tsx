'use client';

/**
 * Dependency-free SVG charts — the dashboard renders them directly from the
 * analytics endpoints, so there is no charting library to ship to the browser.
 */

export function BarChart({
  data,
  height = 180,
  valueKey = 'value',
  labelKey = 'label',
  color = '#2563eb',
}: {
  data: Array<Record<string, string | number>>;
  height?: number;
  valueKey?: string;
  labelKey?: string;
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey])));
  const barWidth = 100 / Math.max(data.length, 1);

  return (
    <div className="card p-4">
      <svg viewBox={`0 0 100 ${height / 4}`} className="w-full" role="img">
        {data.map((d, i) => {
          const value = Number(d[valueKey]);
          const h = (value / max) * (height / 4 - 14);
          return (
            <g key={i}>
              <rect
                x={i * barWidth + barWidth * 0.2}
                y={height / 4 - h - 8}
                width={barWidth * 0.6}
                height={Math.max(h, 0.5)}
                rx="0.8"
                fill={color}
              />
              <text
                x={i * barWidth + barWidth * 0.5}
                y={height / 4 - 2}
                fontSize="2.4"
                textAnchor="middle"
                fill="#64748b"
              >
                {String(d[labelKey]).slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function LineChart({
  data,
  valueKey = 'value',
  labelKey = 'label',
}: {
  data: Array<Record<string, string | number>>;
  valueKey?: string;
  labelKey?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">No revenue data yet.</div>
    );
  }
  const values = data.map((d) => Number(d[valueKey]));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = 100 / Math.max(data.length - 1, 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(40 - ((v - min) / span) * 36).toFixed(2)}`)
    .join(' ');

  return (
    <div className="card p-4">
      <svg viewBox="0 0 100 44" className="w-full" role="img">
        <polyline points={points} fill="none" stroke="#1d4ed8" strokeWidth="0.7" />
        <polyline
          points={`0,44 ${points} 100,44`}
          fill="#1d4ed8"
          opacity="0.08"
          stroke="none"
        />
        <text x="0" y="43" fontSize="2.4" fill="#64748b">
          {data[0][labelKey]}
        </text>
        <text x="100" y="43" fontSize="2.4" fill="#64748b" textAnchor="end">
          {data[data.length - 1][labelKey]}
        </text>
      </svg>
    </div>
  );
}
