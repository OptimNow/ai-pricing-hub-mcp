import "@/index.css";
import { useState } from "react";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost, savingsPct } from "../../format.js";
import { linearDomain, linearScale, linearTicks, logDomain, logScale, logTicks } from "../../scale.js";
import {
  Badge, Card, EmptyState, ErrorState, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

type CompareOutput = NonNullable<ReturnType<typeof useToolInfo<"compare-llm-models">>["output"]>;
type EnrichedModel = CompareOutput["models"][number];

function CompareModels() {
  const { output } = useToolInfo<"compare-llm-models">();
  // All the scatter needs is already in structuredContent, so the toggle is
  // local state — no round-trip to the server to change view.
  const [view, setView] = useState<"list" | "scatter">("list");

  if (!output) {
    return <LoadingState label="Loading models..." />;
  }

  const { models, useCaseLabel, volumeLabel, source, matchingCount, catalogSize, eloAsOf, dataAsOf, error } = output;

  if (error) {
    return (
      <WidgetShell maxWidth={800}>
        <ErrorState title="Could not load model comparison" message={error} />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell maxWidth={800}>
      <WidgetHeader
        title="LLM Model Comparison"
        subtitle={`${matchingCount} of ${catalogSize} models match · Showing ${models.length} · ${useCaseLabel} · ${volumeLabel}/mo`}
      >
        <FreshnessBadges source={source} eloAsOf={eloAsOf} dataAsOf={dataAsOf} />
      </WidgetHeader>

      {models.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ViewToggle view={view} onChange={setView} />
          {view === "list" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {models.map((m, i) => (
                <ModelCard key={`${m.provider}-${m.model}-${i}`} model={m} rank={i + 1} />
              ))}
            </div>
          ) : (
            <CostEloScatter models={models} useCaseLabel={useCaseLabel} />
          )}
        </>
      )}
    </WidgetShell>
  );
}

function ViewToggle({ view, onChange }: { view: "list" | "scatter"; onChange: (v: "list" | "scatter") => void }) {
  const options: { key: "list" | "scatter"; label: string }[] = [
    { key: "list", label: "List" },
    { key: "scatter", label: "Cost vs ELO" },
  ];
  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
      {options.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={view === o.key}
          style={{
            fontFamily: "inherit", fontSize: "12px", cursor: "pointer",
            padding: "4px 10px", borderRadius: "6px",
            border: `1px solid ${view === o.key ? "var(--brand-border)" : "var(--border)"}`,
            background: view === o.key ? "var(--brand-soft)" : "var(--surface)",
            color: view === o.key ? "var(--brand-text)" : "var(--text-muted)",
            fontWeight: view === o.key ? 600 : 400,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const CHART = { width: 736, height: 300, left: 48, right: 14, top: 14, bottom: 42 };

/** Efficiency frontier: cheap and good is bottom-right... except cost runs left
 *  to right on a log axis, so the sweet spot is top-left. Models without an ELO
 *  score cannot be placed at all — their count is reported, not swallowed. */
function CostEloScatter({ models, useCaseLabel }: { models: EnrichedModel[]; useCaseLabel: string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const points = models
    .map((m, i) => ({ m, i }))
    .filter(p => p.m.eloScore !== undefined && p.m.useCaseCost > 0);
  const omitted = models.length - points.length;

  if (points.length === 0) {
    return <EmptyState message={`None of these ${models.length} models has both an ELO score and a priced ${useCaseLabel} request, so there is nothing to plot.`} />;
  }

  const [xMin, xMax] = logDomain(points.map(p => p.m.useCaseCost));
  const [yMin, yMax] = linearDomain(points.map(p => p.m.eloScore!), 0.12);

  const x = logScale(xMin, xMax, CHART.left, CHART.width - CHART.right);
  const y = linearScale(yMin, yMax, CHART.height - CHART.bottom, CHART.top);

  const xTicks = logTicks(xMin, xMax);
  // ELO is a whole number, so round the ticks before drawing and drop the
  // duplicates a very narrow domain would otherwise produce (1495, 1495, 1496).
  const yTicks = [...new Set(linearTicks(yMin, yMax, 5).map(Math.round))];
  const plotted = points.map(p => ({ ...p, cx: x(p.m.useCaseCost), cy: y(p.m.eloScore!) }));
  const active = hovered !== null ? plotted.find(p => p.i === hovered) : undefined;

  return (
    <div>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`Cost per request versus Arena ELO for ${plotted.length} models`}
      >
        {yTicks.map(t => (
          <g key={`y${t}`}>
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" strokeWidth={1} />
            <text x={CHART.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--text-faint)">{t}</text>
          </g>
        ))}
        {xTicks.map(t => (
          <g key={`x${t}`}>
            <line x1={x(t)} x2={x(t)} y1={CHART.top} y2={CHART.height - CHART.bottom} stroke="var(--border-subtle)" strokeWidth={1} />
            <text x={x(t)} y={CHART.height - CHART.bottom + 13} textAnchor="middle" fontSize={9} fill="var(--text-faint)">{formatCost(t)}</text>
          </g>
        ))}

        <line x1={CHART.left} x2={CHART.width - CHART.right} y1={CHART.height - CHART.bottom} y2={CHART.height - CHART.bottom} stroke="var(--border)" strokeWidth={1} />
        <line x1={CHART.left} x2={CHART.left} y1={CHART.top} y2={CHART.height - CHART.bottom} stroke="var(--border)" strokeWidth={1} />

        <text x={(CHART.left + CHART.width - CHART.right) / 2} y={CHART.height - 6} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
          {useCaseLabel} cost per request, USD (log scale)
        </text>
        <text x={12} y={(CHART.top + CHART.height - CHART.bottom) / 2} textAnchor="middle" fontSize={10} fill="var(--text-muted)"
          transform={`rotate(-90 12 ${(CHART.top + CHART.height - CHART.bottom) / 2})`}>
          Arena ELO
        </text>

        {plotted.map(p => (
          <circle
            key={`${p.m.provider}-${p.m.model}-${p.i}`}
            cx={p.cx}
            cy={p.cy}
            r={hovered === p.i ? 6.5 : 4.5}
            fill={p.m.isFinOpsFriendly ? "var(--brand)" : "var(--text-faint)"}
            stroke={p.m.isFinOpsFriendly ? "var(--brand-border)" : "var(--border)"}
            strokeWidth={1}
            opacity={p.m.isFinOpsFriendly ? 1 : 0.75}
            onMouseEnter={() => setHovered(p.i)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>
              {`${p.m.provider} ${p.m.model} — ELO ${p.m.eloScore}, ${formatCost(p.m.useCaseCost)}/req, ${formatBudget(p.m.monthlyBudget)}/mo`}
            </title>
          </circle>
        ))}
      </svg>

      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px", minHeight: "16px" }}>
        {active ? (
          <>
            <strong style={{ color: "var(--text)" }}>{active.m.provider} {active.m.model}</strong>
            {" — "}ELO {active.m.eloScore} · {formatCost(active.m.useCaseCost)}/req ·{" "}
            {formatBudget(active.m.monthlyBudget)}/mo
            {active.m.isFinOpsFriendly && " · FinOps Friendly"}
          </>
        ) : (
          "Hover a point for the model behind it."
        )}
      </div>

      <div style={{ display: "flex", gap: "12px", alignItems: "center", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "var(--brand)", display: "inline-block" }} />
          FinOps Friendly
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "9px", height: "9px", borderRadius: "50%", background: "var(--text-faint)", display: "inline-block" }} />
          Other
        </span>
        {omitted > 0 && <span>{omitted} model{omitted > 1 ? "s" : ""} not plotted (no ELO score or no priced request)</span>}
      </div>
    </div>
  );
}

function ModelCard({ model: m, rank }: { model: EnrichedModel; rank: number }) {
  const savings = savingsPct(m.monthlyBudget, m.optimizedMonthlyBudget);

  return (
    <Card accent={m.isFinOpsFriendly}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div>
          <span style={{ fontSize: "12px", color: "var(--text-faint)", marginRight: "6px" }}>#{rank}</span>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{m.provider}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "14px", marginLeft: "4px" }}>{m.model}</span>
          {m.isFinOpsFriendly && <Badge label="FinOps Friendly" tone="brand" />}
        </div>
        <Badge label={m.category} />
      </div>

      {/* Metrics Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", fontSize: "12px" }}>
        <MetricCell label="Input" value={`$${m.inputPricePer1M}/1M`} />
        <MetricCell label="Output" value={`$${m.outputPricePer1M}/1M`} />
        <MetricCell label="Per Request" value={formatCost(m.useCaseCost)} />
        <MetricCell label="Monthly" value={formatBudget(m.monthlyBudget)} color="var(--brand-text)" />
      </div>

      {/* Optimized Row */}
      <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
        Optimized (caching{savings > 0 ? " + batch where eligible" : ""}):{" "}
        <strong style={{ color: "var(--text)" }}>{formatCost(m.optimizedUseCaseCost)}</strong>/req ·{" "}
        <strong style={{ color: "var(--text)" }}>{formatBudget(m.optimizedMonthlyBudget)}</strong>/mo
        {savings > 0 && <span style={{ color: "var(--positive)", marginLeft: "4px" }}>−{savings}%</span>}
      </div>

      {/* Bottom Row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {m.eloScore && <span>ELO: {m.eloScore}</span>}
          {m.efficiencyScore !== null && <span>Efficiency: {m.efficiencyScore.toFixed(1)}</span>}
          <span>Context: {m.contextWindow}</span>
          <VolatilityChip risk={m.volatilityRisk} />
        </div>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {m.capabilities.slice(0, 4).map(c => (
            <span key={c} style={{
              background: "var(--capability-bg)", color: "var(--capability-text)",
              padding: "0 4px", borderRadius: "3px", fontSize: "10px",
            }}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Preview/beta models get repriced or retired without notice — that is a real
 *  budgeting risk, so surface it rather than only shipping it in the payload. */
function VolatilityChip({ risk }: { risk: string }) {
  if (risk === "Stable") return null;
  return <Badge label={`${risk} volatility`} tone={risk === "High" ? "warn" : "neutral"} inline />;
}

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: "var(--text-faint)", fontSize: "10px" }}>{label}</div>
      <div style={{ fontWeight: 600, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

export default CompareModels;
mountWidget(<CompareModels />);
