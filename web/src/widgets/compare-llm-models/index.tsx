import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";

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
  finopsBadge?: {
    qualifying: number;
    ranked: number;
    minElo: number | null;
    maxBlendedPrice: number | null;
  };
  error?: string;
}

function formatCost(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.001) return `$${amount.toFixed(6)}`;
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(3)}`;
}

function formatBudget(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(2)}`;
}

function CompareModels() {
  const { output } = useToolInfo();

  if (!output) {
    return <div style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>Loading models...</div>;
  }

  const { models, useCaseLabel, volumeLabel, source, matchingCount, catalogSize, eloAsOf, dataAsOf, finopsBadge, error } =
    output as unknown as CompareOutput;

  if (error) {
    return <ErrorCard message={error} />;
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: "800px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
        LLM Model Comparison
      </h2>
      <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
        {matchingCount} of {catalogSize} models match · Showing {models.length} · {useCaseLabel} · {volumeLabel}/mo
        <Badge label={`ELO as of ${eloAsOf}`} />
        {source === "static-fallback" && <Badge label={`static snapshot${dataAsOf ? ` ${dataAsOf}` : ""}`} warn />}
      </p>

      {finopsBadge && finopsBadge.ranked > 0 && (
        // The badge gates on percentiles, which move with the market. Stating
        // where they land today is what makes the badge auditable rather than
        // something the reader has to take on trust.
        <p style={{ fontSize: "11px", color: "#6b7280", marginTop: "-8px", marginBottom: "16px" }}>
          FinOps Friendly today: ELO ≥ {finopsBadge.minElo ?? "n/a"}, blended list price ≤ $
          {finopsBadge.maxBlendedPrice?.toFixed(2) ?? "n/a"}/1M, top-30% efficiency, stable release —{" "}
          {finopsBadge.qualifying} of {finopsBadge.ranked} ranked models qualify.
        </p>
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
    </div>
  );
}

function Badge({ label, warn }: { label: string; warn?: boolean }) {
  return (
    <span style={{
      marginLeft: "8px", fontSize: "11px", borderRadius: "4px", padding: "1px 6px",
      background: warn ? "#fef3c7" : "#f3f4f6", color: warn ? "#92400e" : "#4b5563",
    }}>
      {label}
    </span>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px" }}>
      <div style={{
        border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b",
        borderRadius: "8px", padding: "12px 14px", fontSize: "13px",
      }}>
        <strong style={{ display: "block", marginBottom: "4px" }}>Could not load model comparison</strong>
        {message}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      border: "1px dashed #d1d5db", borderRadius: "8px", padding: "24px",
      textAlign: "center", color: "#6b7280", fontSize: "13px",
    }}>
      No results match these filters.
    </div>
  );
}

function ModelCard({ model: m, rank }: { model: EnrichedModel; rank: number }) {
  const savingsPct = m.monthlyBudget > 0
    ? Math.round((1 - m.optimizedMonthlyBudget / m.monthlyBudget) * 100)
    : 0;

  return (
    <div style={{
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      padding: "12px",
      background: m.isFinOpsFriendly ? "#f0fdf4" : "#ffffff",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <div>
          <span style={{ fontSize: "12px", color: "#9ca3af", marginRight: "6px" }}>#{rank}</span>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{m.provider}</span>
          <span style={{ color: "#6b7280", fontSize: "14px", marginLeft: "4px" }}>{m.model}</span>
          {m.isFinOpsFriendly && (
            <span
              title="Top 40% on Arena ELO, top 30% on efficiency, cheapest 70% on list price, and a stable release"
              style={{
                marginLeft: "8px", fontSize: "11px", background: "#dcfce7",
                color: "#166534", padding: "1px 6px", borderRadius: "4px",
              }}
            >
              FinOps Friendly
            </span>
          )}
        </div>
        {/* Two independent axes: what it costs, and whose hardware can run it */}
        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
          <span style={{
            fontSize: "11px", background: "#f3f4f6", color: "#374151",
            padding: "2px 8px", borderRadius: "4px",
          }}>
            {m.category}
          </span>
          {m.openness && m.openness !== "Unknown" && (
            <span
              title="Self-hostability, derived from the model's licence"
              style={{
                fontSize: "11px",
                background: m.openness === "Proprietary" ? "#f3f4f6" : "#ecfdf5",
                color: m.openness === "Proprietary" ? "#6b7280" : "#047857",
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
        <MetricCell label="Monthly" value={formatBudget(m.monthlyBudget)} color="#2563eb" />
      </div>

      {/* Optimized Row */}
      <div style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280" }}>
        Optimized (caching{savingsPct > 0 ? " + batch where eligible" : ""}):{" "}
        <strong style={{ color: "#111827" }}>{formatCost(m.optimizedUseCaseCost)}</strong>/req ·{" "}
        <strong style={{ color: "#111827" }}>{formatBudget(m.optimizedMonthlyBudget)}</strong>/mo
        {savingsPct > 0 && <span style={{ color: "#16a34a", marginLeft: "4px" }}>−{savingsPct}%</span>}
      </div>

      {/* Bottom Row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>
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
              background: "#eff6ff", color: "#1d4ed8",
              padding: "0 4px", borderRadius: "3px", fontSize: "10px",
            }}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: "#9ca3af", fontSize: "10px" }}>{label}</div>
      <div style={{ fontWeight: 600, color: color || "#111827" }}>{value}</div>
    </div>
  );
}

export default CompareModels;
mountWidget(<CompareModels />);
