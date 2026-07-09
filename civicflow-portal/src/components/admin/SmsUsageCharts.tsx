/**
 * Small, purpose-built SVG charts for the SMS usage dashboard — not a
 * general charting library, just enough marks for these four views. Follows
 * the dataviz skill: thin 2px lines/bars, rounded data-ends, recessive
 * gridlines/axes, status colors reserved for delivered/failed, categorical
 * palette in fixed order for the org ranking, native <title> tooltips as the
 * hover layer. Colors are the skill's validated reference palette (light
 * mode only, matching the rest of this app).
 */

const CHART_SURFACE = "#fcfcfb";
const GRIDLINE = "#e1e0d9";
const AXIS = "#c3c2b7";
const MUTED = "#898781";
const BLUE = "#2a78d6"; // categorical slot 1 — single-series magnitude
const STATUS_GOOD = "#0ca30c"; // delivered
const STATUS_CRITICAL = "#d03b3b"; // failed
const CATEGORICAL = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];

function EmptyState({ label }: { label: string }) {
  return <p className="py-10 text-center text-sm text-slate-500">{label}</p>;
}

export function MessagesPerDayChart({ data }: { data: { day: string; count: number }[] }) {
  if (data.length === 0) return <EmptyState label="No messages in this period." />;

  const width = 720;
  const height = 220;
  const padding = { top: 10, right: 16, bottom: 24, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? plotWidth / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padding.left + stepX * i;
    const y = padding.top + plotHeight - (d.count / max) * plotHeight;
    return { x, y, ...d };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Messages sent per day">
      <rect x={0} y={0} width={width} height={height} fill={CHART_SURFACE} />
      {[0, 0.5, 1].map((t) => {
        const y = padding.top + plotHeight * t;
        return <line key={t} x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={GRIDLINE} strokeWidth={1} />;
      })}
      <line x1={padding.left} y1={padding.top + plotHeight} x2={width - padding.right} y2={padding.top + plotHeight} stroke={AXIS} strokeWidth={1} />
      <path d={linePath} fill="none" stroke={BLUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p) => (
        <circle key={p.day} cx={p.x} cy={p.y} r={3} fill={BLUE}>
          <title>
            {p.day}: {p.count} messages
          </title>
        </circle>
      ))}
      <text x={padding.left} y={height - 6} fontSize={10} fill={MUTED}>
        {data[0]?.day}
      </text>
      <text x={width - padding.right} y={height - 6} fontSize={10} fill={MUTED} textAnchor="end">
        {data[data.length - 1]?.day}
      </text>
      <text x={padding.left - 6} y={padding.top + 4} fontSize={10} fill={MUTED} textAnchor="end">
        {max}
      </text>
      <text x={padding.left - 6} y={padding.top + plotHeight} fontSize={10} fill={MUTED} textAnchor="end">
        0
      </text>
    </svg>
  );
}

export function DeliveredVsFailedChart({ data }: { data: { day: string; delivered: number; failed: number }[] }) {
  if (data.length === 0) return <EmptyState label="No delivered/failed messages in this period." />;

  const width = 720;
  const height = 220;
  const padding = { top: 10, right: 16, bottom: 24, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.delivered + d.failed));
  const barWidth = Math.min(24, (plotWidth / data.length) * 0.6);
  const step = plotWidth / data.length;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Delivered vs failed messages per day">
        <rect x={0} y={0} width={width} height={height} fill={CHART_SURFACE} />
        {[0, 0.5, 1].map((t) => {
          const y = padding.top + plotHeight * t;
          return <line key={t} x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke={GRIDLINE} strokeWidth={1} />;
        })}
        <line x1={padding.left} y1={padding.top + plotHeight} x2={width - padding.right} y2={padding.top + plotHeight} stroke={AXIS} strokeWidth={1} />
        {data.map((d, i) => {
          const x = padding.left + step * i + (step - barWidth) / 2;
          const deliveredHeight = (d.delivered / max) * plotHeight;
          const failedHeight = (d.failed / max) * plotHeight;
          const baseY = padding.top + plotHeight;
          return (
            <g key={d.day}>
              <rect x={x} y={baseY - deliveredHeight} width={barWidth} height={deliveredHeight} rx={2} fill={STATUS_GOOD}>
                <title>
                  {d.day}: {d.delivered} delivered
                </title>
              </rect>
              <rect
                x={x}
                y={baseY - deliveredHeight - failedHeight - (failedHeight > 0 ? 2 : 0)}
                width={barWidth}
                height={failedHeight}
                rx={2}
                fill={STATUS_CRITICAL}
              >
                <title>
                  {d.day}: {d.failed} failed
                </title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center gap-4 text-xs text-slate-700">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATUS_GOOD }} /> Delivered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATUS_CRITICAL }} /> Failed
        </span>
      </div>
    </div>
  );
}

export function CostByMonthChart({ data }: { data: { month: string; costCents: number }[] }) {
  if (data.length === 0) return <EmptyState label="No cost data in this period." />;

  const width = 720;
  const height = 200;
  const padding = { top: 10, right: 16, bottom: 24, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map((d) => d.costCents));
  const barWidth = Math.min(48, (plotWidth / data.length) * 0.55);
  const step = plotWidth / data.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Twilio cost by month">
      <rect x={0} y={0} width={width} height={height} fill={CHART_SURFACE} />
      <line x1={padding.left} y1={padding.top + plotHeight} x2={width - padding.right} y2={padding.top + plotHeight} stroke={AXIS} strokeWidth={1} />
      {data.map((d, i) => {
        const x = padding.left + step * i + (step - barWidth) / 2;
        const barHeight = (d.costCents / max) * plotHeight;
        const y = padding.top + plotHeight - barHeight;
        return (
          <g key={d.month}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={3} fill={BLUE}>
              <title>
                {d.month}: ${(d.costCents / 100).toFixed(2)}
              </title>
            </rect>
            <text x={x + barWidth / 2} y={height - 6} fontSize={10} fill={MUTED} textAnchor="middle">
              {d.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TopOrgsByUsageChart({ data }: { data: { name: string; count: number }[] }) {
  if (data.length === 0) return <EmptyState label="No usage yet this month." />;

  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="space-y-2">
      {data.map((org, index) => (
        <div key={org.name} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-sm text-slate-900" title={org.name}>
            {org.name}
          </span>
          <div className="h-4 flex-1 rounded bg-slate-100">
            <div
              className="h-4 rounded"
              style={{ width: `${Math.max(2, (org.count / max) * 100)}%`, backgroundColor: CATEGORICAL[index % CATEGORICAL.length] }}
              title={`${org.name}: ${org.count} messages`}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-sm font-medium text-slate-900" style={{ fontVariantNumeric: "tabular-nums" }}>
            {org.count}
          </span>
        </div>
      ))}
    </div>
  );
}
