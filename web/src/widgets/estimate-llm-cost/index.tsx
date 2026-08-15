import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost, savingsPct } from "../../format.js";
import {
  Card, EmptyState, ErrorState, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

type EstimateOutput = NonNullable<ReturnType<typeof useToolInfo<"estimate-llm-cost">>["output"]>;
type ModelCostItem = EstimateOutput["modelCosts"][number];

function EstimateCost() {
  const { output } = useToolInfo<"estimate-llm-cost">();

  if (!output) {
    return <LoadingState label="Estimating costs..." />;
  }

  const { modelCosts, volume, source, eloAsOf, dataAsOf, error } = output;

  if (error) {
    return (
      <WidgetShell maxWidth={720}>
        <ErrorState title="Could not estimate costs" message={error} />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell maxWidth={720}>
      <WidgetHeader
        title="LLM Cost Estimates"
        subtitle={`${modelCosts.length} model(s) · ${volume.toLocaleString()} requests/month`}
      >
        <FreshnessBadges source={source} eloAsOf={eloAsOf} dataAsOf={dataAsOf} />
      </WidgetHeader>

      {modelCosts.length === 0 ? (
        <EmptyState />
      ) : (
        modelCosts.map((mc, idx) => (
          <div key={`${mc.model.provider}-${mc.model.model}-${idx}`} style={{ marginBottom: "12px" }}>
            <ModelCostCard mc={mc} />
          </div>
        ))
      )}
    </WidgetShell>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "right",
  padding: "4px 6px",
  color: "var(--text-muted)",
  fontWeight: 500,
};

function ModelCostCard({ mc }: { mc: ModelCostItem }) {
  const m = mc.model;
  const minCost = Math.min(...mc.costs.map(c => c.monthly));
  const maxCost = Math.max(...mc.costs.map(c => c.monthly));

  return (
    <Card>
      {/* Model Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{m.provider}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "14px", marginLeft: "4px" }}>{m.model}</span>
          {m.eloScore && (
            <span style={{ marginLeft: "8px", fontSize: "11px", color: "var(--text-muted)" }}>ELO: {m.eloScore}</span>
          )}
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          In: ${m.inputPricePer1M}/1M · Out: ${m.outputPricePer1M}/1M
        </div>
      </div>

      {/* Cost Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ ...thStyle, textAlign: "left" }}>Use Case</th>
              <th style={thStyle}>Tokens (in+out)</th>
              <th style={thStyle}>Per Request</th>
              <th style={thStyle}>Monthly</th>
              <th style={thStyle}>Monthly optimized</th>
            </tr>
          </thead>
          <tbody>
            {mc.costs.map((c) => {
              const isMin = mc.costs.length > 1 && c.monthly === minCost;
              const isMax = mc.costs.length > 1 && c.monthly === maxCost;
              const saved = savingsPct(c.monthly, c.monthlyOptimized);
              return (
                <tr key={c.useCase} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "5px 6px", fontWeight: 500 }}>{c.useCase}</td>
                  <td style={{ textAlign: "right", padding: "5px 6px", color: "var(--text-muted)" }}>
                    {c.inputTokens.toLocaleString()} + {c.outputTokens.toLocaleString()}
                  </td>
                  <td style={{ textAlign: "right", padding: "5px 6px" }}>{formatCost(c.perRequest)}</td>
                  <td style={{
                    textAlign: "right", padding: "5px 6px", fontWeight: 600,
                    color: isMin ? "var(--positive)" : isMax ? "var(--negative)" : "var(--text)",
                  }}>
                    {formatBudget(c.monthly)}
                  </td>
                  <td style={{ textAlign: "right", padding: "5px 6px", color: "var(--text-muted)" }}>
                    {formatBudget(c.monthlyOptimized)}
                    {saved > 0 && (
                      <span style={{ color: "var(--positive)", fontSize: "10px", marginLeft: "3px" }}>
                        −{saved}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Budget Range */}
      {mc.costs.length > 1 && (
        <div style={{
          marginTop: "8px", fontSize: "11px", color: "var(--text-muted)",
          padding: "6px 8px", background: "var(--surface-subtle)", borderRadius: "4px",
        }}>
          Monthly range: <strong style={{ color: "var(--positive)" }}>{formatBudget(minCost)}</strong>
          {" "}to{" "}
          <strong style={{ color: "var(--negative)" }}>{formatBudget(maxCost)}</strong>
        </div>
      )}
    </Card>
  );
}

export default EstimateCost;
mountWidget(<EstimateCost />);
