import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost, savingsPct } from "../../format.js";
import {
  Badge, Card, EmptyState, ErrorState, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

type CompareOutput = NonNullable<ReturnType<typeof useToolInfo<"compare-llm-models">>["output"]>;
type EnrichedModel = CompareOutput["models"][number];

function CompareModels() {
  const { output } = useToolInfo<"compare-llm-models">();

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
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {models.map((m, i) => (
            <ModelCard key={`${m.provider}-${m.model}-${i}`} model={m} rank={i + 1} />
          ))}
        </div>
      )}
    </WidgetShell>
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
