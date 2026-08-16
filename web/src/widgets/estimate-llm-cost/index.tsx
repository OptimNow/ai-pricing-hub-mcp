import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";

interface CostEntry {
  useCase: string;
  inputTokens: number;
  outputTokens: number;
  perRequest: number;
  monthly: number;
  perRequestOptimized: number;
  monthlyOptimized: number;
  cacheHitRate: number;
  batchEligible: boolean;
  optimizationBasis: "preset" | "caller-supplied" | "none-supplied";
  optimizationNote: string;
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
  source: string;
  eloAsOf: string;
  dataAsOf?: string;
  error?: string;
}

function formatCost(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.001) return `$${amount.toFixed(6)}`;
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
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

  const { modelCosts, volume, source, eloAsOf, dataAsOf, error } = output as unknown as EstimateOutput;

  if (error) {
    return <ErrorCard message={error} />;
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: "720px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
        LLM Cost Estimates
      </h2>
      <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px" }}>
        {modelCosts.length} model(s) · {volume.toLocaleString()} requests/month
        {eloAsOf && <Badge label={`ELO as of ${eloAsOf}`} />}
        {source === "static-fallback" && <Badge label={`static snapshot${dataAsOf ? ` ${dataAsOf}` : ""}`} warn />}
      </p>

      {modelCosts.length === 0 ? (
        <EmptyState />
      ) : (
        modelCosts.map((mc, idx) => (
          <ModelCostCard key={`${mc.model.provider}-${mc.model.model}-${idx}`} mc={mc} />
        ))
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
        <strong style={{ display: "block", marginBottom: "4px" }}>Could not estimate costs</strong>
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

function ModelCostCard({ mc }: { mc: ModelCostItem }) {
  const m = mc.model;
  const minCost = Math.min(...mc.costs.map(c => c.monthly));
  const maxCost = Math.max(...mc.costs.map(c => c.monthly));
  const unexplained = mc.costs.filter(c => c.monthlyOptimized >= c.monthly);

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
            <th style={{ textAlign: "right", padding: "4px 6px", color: "#6b7280", fontWeight: 500 }}>Monthly optimized</th>
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
                <td style={{ textAlign: "right", padding: "5px 6px", color: "#6b7280" }}>
                  {formatMonthly(c.monthlyOptimized)}
                  {c.monthly > 0 && c.monthlyOptimized < c.monthly ? (
                    <span style={{ color: "#16a34a", fontSize: "10px", marginLeft: "3px" }}>
                      −{Math.round((1 - c.monthlyOptimized / c.monthly) * 100)}%
                    </span>
                  ) : (
                    /* A repeated number reads as "nothing to save here". Say why
                       it repeated instead — the note below the table explains. */
                    <span style={{ color: "#9ca3af", fontSize: "10px", marginLeft: "3px" }}>= list*</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Why an optimized figure repeated the list price. Only the rows that
          show no saving need explaining; annotating all eight presets when
          seven of them do save would bury the one that matters. */}
      {unexplained.length > 0 && (
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {unexplained.map((c) => (
            <div
              key={c.useCase}
              style={{
                fontSize: "11px", lineHeight: 1.45, borderRadius: "4px", padding: "6px 8px",
                border: c.optimizationBasis === "none-supplied" ? "1px solid #fde68a" : "1px solid #e5e7eb",
                background: c.optimizationBasis === "none-supplied" ? "#fffbeb" : "#f9fafb",
                color: c.optimizationBasis === "none-supplied" ? "#92400e" : "#6b7280",
              }}
            >
              <strong>* {c.useCase}:</strong> {c.optimizationNote}
            </div>
          ))}
        </div>
      )}

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
