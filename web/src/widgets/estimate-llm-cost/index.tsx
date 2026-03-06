import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";

interface CostEntry {
  useCase: string;
  inputTokens: number;
  outputTokens: number;
  perRequest: number;
  monthly: number;
}

interface ModelCostItem {
  model: {
    provider: string;
    model: string;
    inputPricePer1M: number;
    outputPricePer1M: number;
    eloScore?: number;
    category?: string;
  };
  costs: CostEntry[];
}

interface EstimateOutput {
  modelCosts: ModelCostItem[];
  volume: number;
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0";
  if (cents < 0.001) return `$${cents.toFixed(6)}`;
  if (cents < 0.01) return `$${cents.toFixed(4)}`;
  if (cents < 1) return `$${cents.toFixed(4)}`;
  return `$${cents.toFixed(2)}`;
}

function formatMonthly(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  if (amount < 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(0)}`;
}

function EstimateCost() {
  const { output } = useToolInfo();

  if (!output) {
    return <div style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>Estimating costs...</div>;
  }

  const { modelCosts, volume } = output as EstimateOutput;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: "720px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
        LLM Cost Estimates
      </h2>
      <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
        {modelCosts.length} model(s) · {volume.toLocaleString()} requests/month
      </p>

      {modelCosts.map((mc, idx) => (
        <ModelCostCard key={`${mc.model.provider}-${mc.model.model}-${idx}`} mc={mc} />
      ))}
    </div>
  );
}

function ModelCostCard({ mc }: { mc: ModelCostItem }) {
  const m = mc.model;
  const minCost = Math.min(...mc.costs.map(c => c.monthly));
  const maxCost = Math.max(...mc.costs.map(c => c.monthly));

  return (
    <div style={{
      border: "1px solid #e5e7eb", borderRadius: "8px",
      padding: "14px", marginBottom: "12px", background: "#fff",
    }}>
      {/* Model Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{m.provider}</span>
          <span style={{ color: "#6b7280", fontSize: "14px", marginLeft: "4px" }}>{m.model}</span>
          {m.eloScore && (
            <span style={{ marginLeft: "8px", fontSize: "11px", color: "#6b7280" }}>ELO: {m.eloScore}</span>
          )}
        </div>
        <div style={{ fontSize: "12px", color: "#6b7280" }}>
          In: ${m.inputPricePer1M}/1M · Out: ${m.outputPricePer1M}/1M
        </div>
      </div>

      {/* Cost Table */}
      <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
            <th style={{ textAlign: "left", padding: "4px 6px", color: "#6b7280", fontWeight: 500 }}>Use Case</th>
            <th style={{ textAlign: "right", padding: "4px 6px", color: "#6b7280", fontWeight: 500 }}>Tokens (in+out)</th>
            <th style={{ textAlign: "right", padding: "4px 6px", color: "#6b7280", fontWeight: 500 }}>Per Request</th>
            <th style={{ textAlign: "right", padding: "4px 6px", color: "#6b7280", fontWeight: 500 }}>Monthly</th>
          </tr>
        </thead>
        <tbody>
          {mc.costs.map((c) => {
            const isMin = mc.costs.length > 1 && c.monthly === minCost;
            const isMax = mc.costs.length > 1 && c.monthly === maxCost;
            return (
              <tr key={c.useCase} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "5px 6px", fontWeight: 500 }}>{c.useCase}</td>
                <td style={{ textAlign: "right", padding: "5px 6px", color: "#6b7280" }}>
                  {c.inputTokens.toLocaleString()} + {c.outputTokens.toLocaleString()}
                </td>
                <td style={{ textAlign: "right", padding: "5px 6px" }}>{formatCost(c.perRequest)}</td>
                <td style={{
                  textAlign: "right", padding: "5px 6px", fontWeight: 600,
                  color: isMin ? "#16a34a" : isMax ? "#dc2626" : "#111827",
                }}>
                  {formatMonthly(c.monthly)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Budget Range */}
      {mc.costs.length > 1 && (
        <div style={{
          marginTop: "8px", fontSize: "11px", color: "#6b7280",
          padding: "6px 8px", background: "#f9fafb", borderRadius: "4px",
        }}>
          Monthly range: <strong style={{ color: "#16a34a" }}>{formatMonthly(minCost)}</strong>
          {" "}to{" "}
          <strong style={{ color: "#dc2626" }}>{formatMonthly(maxCost)}</strong>
        </div>
      )}
    </div>
  );
}

export default EstimateCost;
mountWidget(<EstimateCost />);
