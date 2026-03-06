import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";

interface EnrichedModel {
  provider: string;
  model: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: string;
  category: string;
  capabilities: string[];
  eloScore?: number;
  efficiencyScore?: number;
  useCaseCost: number;
  monthlyBudget: number;
  isFinOpsFriendly?: boolean;
}

interface CompareOutput {
  models: EnrichedModel[];
  useCaseLabel: string;
  volumeLabel: string;
  source: string;
  totalAvailable: number;
}

function formatCost(cents: number): string {
  if (cents < 0.01) return `$${(cents * 100).toFixed(2)}c`;
  if (cents < 1) return `$${cents.toFixed(4)}`;
  return `$${cents.toFixed(2)}`;
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

  const { models, useCaseLabel, volumeLabel, source, totalAvailable } = output as CompareOutput;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: "800px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
        LLM Model Comparison
      </h2>
      <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
        {totalAvailable} models found · Showing {models.length} · {useCaseLabel} · {volumeLabel}/mo
        <span style={{ marginLeft: "8px", fontSize: "11px", opacity: 0.7 }}>({source})</span>
      </p>

      {/* Model Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {models.map((m, i) => (
          <ModelCard key={`${m.provider}-${m.model}-${i}`} model={m} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}

function ModelCard({ model: m, rank }: { model: EnrichedModel; rank: number }) {
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
            <span style={{
              marginLeft: "8px", fontSize: "11px", background: "#dcfce7",
              color: "#166534", padding: "1px 6px", borderRadius: "4px",
            }}>
              FinOps Friendly
            </span>
          )}
        </div>
        <span style={{
          fontSize: "11px", background: "#f3f4f6", color: "#374151",
          padding: "2px 8px", borderRadius: "4px",
        }}>
          {m.category}
        </span>
      </div>

      {/* Metrics Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", fontSize: "12px" }}>
        <MetricCell label="Input" value={`$${m.inputPricePer1M}/1M`} />
        <MetricCell label="Output" value={`$${m.outputPricePer1M}/1M`} />
        <MetricCell label="Per Request" value={formatCost(m.useCaseCost)} />
        <MetricCell label="Monthly" value={formatBudget(m.monthlyBudget)} color="#2563eb" />
      </div>

      {/* Bottom Row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          {m.eloScore && <span>ELO: {m.eloScore}</span>}
          {m.efficiencyScore !== undefined && <span>Efficiency: {m.efficiencyScore.toFixed(1)}</span>}
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
