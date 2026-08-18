import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost, savingsPct } from "../../format.js";
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
