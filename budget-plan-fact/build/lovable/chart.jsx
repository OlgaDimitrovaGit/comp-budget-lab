// Monthly chart, transplanted from the Lovable project (src/routes/index.tsx,
// "Plan vs actual, monthly"): the Recharts LineChart, its axes, grid,
// reference line, line styles and tooltip card are Lovable's code.
// What is ours: the numbers. The page's own script computes plan and
// expected (actual, then forecast) per month and passes them in; this file
// only draws them. Three things are added on top of the Lovable chart, each
// carrying meaning the page had before:
// - the axis domain and ticks come from the page (evenly spaced, the axis
//   truncation is marked with a break), not from a fixed ±50K pad that
//   breaks for a small department;
// - the last closed month keeps its value chip;
// - the tooltip carries the variance against plan.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CartesianGrid,
  Customized,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function PayrollTooltip({ active, label, rows, factMonths, monthFull, fmt, pct }) {
  if (!active || label == null) return null;
  const i = rows.findIndex((r) => r.month === label);
  if (i < 0) return null;
  const r = rows[i];
  const isFc = i >= factMonths;
  const dev = r.plan ? (r.exp / r.plan - 1) * 100 : 0;
  const devCls = dev > 0 ? "text-negative" : dev < 0 ? "text-positive" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 shadow-panel">
      <p className="mb-1 text-xs font-semibold text-foreground">{monthFull[label] || label}</p>
      <p className="text-xs tabular-nums" style={{ color: "var(--plan)" }}>Plan: {fmt(r.plan)}</p>
      <p className="text-xs tabular-nums" style={{ color: "var(--primary)" }}>
        {isFc ? "Forecast" : "Actual"}: {fmt(r.exp)}
      </p>
      <p className="mt-1 border-t border-border pt-1 text-xs tabular-nums text-muted-foreground">
        vs plan: <span className={`font-semibold ${devCls}`}>{pct(dev)}</span>
      </p>
    </div>
  );
}

// Axis break: the standard mark for "the axis does not start at zero",
// drawn just inside the plot at its bottom-left corner.
function AxisBreak({ offset, show }) {
  if (!show || !offset) return null;
  const x = offset.left + 3, y = offset.top + offset.height;
  return (
    <path d={`M${x},${y - 6} l4,3 l-4,3 l4,3`} fill="none"
      stroke="var(--muted-foreground)" strokeWidth={1.3} />
  );
}

// Value chip for the last closed month, in the tooltip card's idiom.
function Chip({ cx, cy, text, hidden, viewBox }) {
  if (cx == null || cy == null) return null;
  const w = 15 + text.length * 6.2;
  const minX = viewBox ? viewBox.x : 0;
  const maxX = viewBox ? viewBox.x + viewBox.width : cx + w;
  const x = Math.min(Math.max(cx - w / 2, minX), maxX - w);
  const y = Math.max(cy - 30, (viewBox ? viewBox.y : 0) - 2);
  return (
    <g style={{ opacity: hidden ? 0 : 1, transition: "opacity 120ms ease" }}>
      <rect x={x} y={y} width={w} height={20} rx={5} fill="var(--card)"
        stroke="var(--primary)" strokeWidth={1.3} />
      <text x={x + w / 2} y={y + 14} textAnchor="middle" fontSize={11.5}
        fontWeight={700} fill="var(--primary)">{text}</text>
    </g>
  );
}

function PayrollChart(p) {
  const box = useRef(null);
  const [narrow, setNarrow] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !window.ResizeObserver) return undefined;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const last = p.factMonths - 1;
  const data = p.months.map((month, i) => ({
    month,
    plan: p.plan[i],
    exp: p.exp[i],
    actual: i <= last ? p.exp[i] : null,
    forecast: i >= last ? p.exp[i] : null,
  }));

  const ticks = narrow ? p.ticksNarrow : p.ticks;
  const fs = narrow ? 11 : 10;

  return (
    <div ref={box} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}
          onMouseMove={(s) => setHover(!!(s && s.isTooltipActive))}
          onMouseLeave={() => setHover(false)}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} interval={narrow ? 1 : 0}
            tick={{ fill: "var(--muted-foreground)", fontSize: fs }} dy={10} />
          <YAxis axisLine={false} tickLine={false} width={narrow ? 58 : 64}
            domain={[p.lo, p.hi]} ticks={ticks} allowDataOverflow
            tickFormatter={narrow ? p.fmtBare : p.fmt}
            tick={{ fill: "var(--muted-foreground)", fontSize: fs }} />
          <Tooltip cursor={{ stroke: "var(--border-strong)" }}
            content={<PayrollTooltip rows={data} factMonths={p.factMonths}
              monthFull={p.monthFull} fmt={p.fmt} pct={p.pct} />} />
          <ReferenceLine x={p.months[last]} stroke="var(--border-strong)" strokeDasharray="3 4"
            label={{ value: "forecast", fill: "var(--muted-foreground)", fontSize: 10, position: "top" }} />
          <Line name="Plan" type="monotone" dataKey="plan" stroke="var(--plan)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line name="Actual" type="monotone" dataKey="actual" stroke="var(--primary)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line name="Forecast" type="monotone" dataKey="forecast" stroke="var(--primary)" strokeWidth={2.5} strokeDasharray="5 5" dot={false} connectNulls={false} isAnimationActive={false} />
          <ReferenceDot x={p.months[last]} y={p.exp[last]} r={0} ifOverflow="visible"
            shape={(s) => <Chip {...s} text={p.fmt(p.exp[last])} hidden={hover} />} />
          <Customized component={(s) => <AxisBreak offset={s.offset} show={p.lo > 0} />} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// The page calls this after every recalculation. One React root per
// element; a re-render just updates it.
function render(el, props) {
  if (!el._bpRoot) {
    el.innerHTML = ""; // a downloaded copy carries the previous SVG
    el._bpRoot = createRoot(el);
  }
  el._bpRoot.render(<PayrollChart {...props} />);
}

window.BPChart = { render };
