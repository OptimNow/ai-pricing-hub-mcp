import "@/index.css";
import { useState } from "react";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost, savingsPct } from "../../format.js";
import { linearDomain, linearScale, linearTicks, logDomain, logScale, logTicks } from "../../scale.js";
import {
  Badge, Card, EmptyState, ErrorState, FootNote, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

// The handler's success and error paths return different shapes, so skybridge
// infers this tool's output as a union it cannot usefully destructure. Until
// those returns are unified server-side, the contract is restated here.
interface EnrichedModel {
  provider: string;
  model: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: string;
  /** Price tier only */
  category: string;
  /** Self-hostability, derived from the licence — independent of the tier */
  openness?: string;
  capabilities: string[];
  eloScore?: number;
  efficiencyScore?: number | null;
  useCaseCost: number;
  optimizedUseCaseCost: number;
  monthlyBudget: number;
  optimizedMonthlyBudget: number;
  isFinOpsFriendly?: boolean;
}

interface CompareOutput {
  models: EnrichedModel[];
  useCaseLabel: string;
  volumeLabel: string;
  source: string;
  matchingCount: number;
  catalogSize: number;
  eloAsOf: string;
  dataAsOf?: string;
  provenance?: {
    tier: number;
    label: string;
    /** False whenever the site's price corrections were not applied. */
    pricesVerified: boolean;
    upstreamTimestamp?: string;
    notice?: string;
  };
  finopsBadge?: {
    qualifying: number;
    ranked: number;
    minElo: number | null;
    maxBlendedPrice: number | null;
  };
  error?: string;
}

function CompareModels() {
  const { output } = useToolInfo();
  // Everything the scatter needs is already in structuredContent, so the toggle
  // is local state — changing view costs no round-trip to the server.
  const [view, setView] = useState<"list" | "scatter">("list");

  if (!output) {
    return <LoadingState label="Loading models..." />;
  }

  const { models, useCaseLabel, volumeLabel, source, matchingCount, catalogSize, eloAsOf, dataAsOf, provenance, finopsBadge, error } =
    output as unknown as CompareOutput;

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
        {/* Tier 2 is the one that looks healthy and isn't: live data, straight
            from OpenRouter, without the site's price corrections. Without this
            badge a half-priced model is indistinguishable from a real one. */}
        {provenance && !provenance.pricesVerified && source !== "static-fallback" && (
          <Badge label="unverified prices — not price-corrected" tone="warn" />
        )}
        {provenance?.upstreamTimestamp && (
          <Badge label={`data as of ${provenance.upstreamTimestamp.slice(0, 10)}`} />
        )}
      </WidgetHeader>

      {finopsBadge && finopsBadge.ranked > 0 && (
        // The badge gates on percentiles, which move with the market. Stating
        // where they land today is what makes the badge auditable rather than
        // something the reader has to take on trust.
        <FootNote>
          FinOps Friendly today: ELO ≥ {finopsBadge.minElo ?? "n/a"}, blended list price ≤ $
          {finopsBadge.maxBlendedPrice?.toFixed(2) ?? "n/a"}/1M, top-30% efficiency, stable release —{" "}
          {finopsBadge.qualifying} of {finopsBadge.ranked} ranked models qualify.
        </FootNote>
      )}

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
  const saved = savingsPct(m.monthlyBudget, m.optimizedMonthlyBudget);

  return (
    <Card accent={m.isFinOpsFriendly}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div>
          <span style={{ fontSize: "12px", color: "var(--text-faint)", marginRight: "6px" }}>#{rank}</span>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{m.provider}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "14px", marginLeft: "4px" }}>{m.model}</span>
          {m.isFinOpsFriendly && (
            <span title="Top 40% on Arena ELO, top 30% on efficiency, cheapest 70% on list price, and a stable release">
              <Badge label="FinOps Friendly" tone="brand" />
            </span>
          )}
        </div>
        {/* Two independent axes: what it costs, and whose hardware can run it */}
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
          <span style={{
            fontSize: "11px", background: "var(--chip-bg)", color: "var(--chip-text)",
            padding: "2px 8px", borderRadius: "4px",
          }}>
            {m.category}
          </span>
          {m.openness && m.openness !== "Unknown" && (
            <span
              title="Self-hostability, derived from the model's licence"
              style={{
                fontSize: "11px",
                background: m.openness === "Proprietary" ? "var(--chip-bg)" : "var(--brand-soft)",
                color: m.openness === "Proprietary" ? "var(--text-muted)" : "var(--brand-text)",
                padding: "2px 8px", borderRadius: "4px",
              }}
            >
              {m.openness}
            </span>
          )}
        </div>
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
        Optimized (caching{saved > 0 ? " + batch where eligible" : ""}):{" "}
        <strong style={{ color: "var(--text)" }}>{formatCost(m.optimizedUseCaseCost)}</strong>/req ·{" "}
        <strong style={{ color: "var(--text)" }}>{formatBudget(m.optimizedMonthlyBudget)}</strong>/mo
        {saved > 0 && <span style={{ color: "var(--positive)", marginLeft: "4px" }}>−{saved}%</span>}
      </div>

      {/* Bottom Row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          {m.eloScore && <span>ELO: {m.eloScore}</span>}
          {m.efficiencyScore !== undefined && m.efficiencyScore !== null && (
            <span>Efficiency: {m.efficiencyScore.toFixed(1)}</span>
          )}
          <span>Context: {m.contextWindow}</span>
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
