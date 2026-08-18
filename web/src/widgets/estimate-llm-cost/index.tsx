import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost, savingsPct } from "../../format.js";
import {
  Badge, Card, EmptyState, ErrorState, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

// The handler's success and error paths return different shapes, so skybridge
// infers this tool's output as a union it cannot usefully destructure. Until
// those returns are unified server-side, the contract is restated here.
interface CostEntry {
  useCase: string;
  inputTokens: number;
  outputTokens: number;
  perRequest: number;
  monthly: number;
  perRequestOptimized: number;
  monthlyOptimized: number;
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
  provenance?: {
    tier: number;
    label: string;
    /** False whenever the site's price corrections were not applied. */
    pricesVerified: boolean;
    upstreamTimestamp?: string;
    notice?: string;
  };
  error?: string;
}

function EstimateCost() {
  const { output } = useToolInfo();

  if (!output) {
    return <LoadingState label="Estimating costs..." />;
  }

  const { modelCosts, volume, source, eloAsOf, dataAsOf, provenance, error } =
    output as unknown as EstimateOutput;

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
        {/* Every figure on this card is derived from the prices below, so an
            uncorrected price silently halves the whole monthly estimate. */}
        {provenance && !provenance.pricesVerified && source !== "static-fallback" && (
          <Badge label="unverified prices — not price-corrected" tone="warn" />
        )}
        {provenance?.upstreamTimestamp && (
          <Badge label={`data as of ${provenance.upstreamTimestamp.slice(0, 10)}`} />
        )}
      </WidgetHeader>

      {modelCosts.length === 0 ? (
        <EmptyState />
      ) : (
        modelCosts.map((mc, idx) => (
          <ModelCostCard key={`${mc.model.provider}-${mc.model.model}-${idx}`} mc={mc} />
        ))
      )}
    </WidgetShell>
  );
}

const thStyle: React.CSSProperties = {
  padding: "4px 6px",
  color: "var(--text-muted)",
  fontWeight: 500,
};

function ModelCostCard({ mc }: { mc: ModelCostItem }) {
  const m = mc.model;
  const minCost = Math.min(...mc.costs.map(c => c.monthly));
  const maxCost = Math.max(...mc.costs.map(c => c.monthly));

  return (
    <div style={{ marginBottom: "12px" }}>
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
        <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ ...thStyle, textAlign: "left" }}>Use Case</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Tokens (in+out)</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Per Request</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Monthly</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Monthly optimized</th>
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
    </div>
  );
}

export default EstimateCost;
mountWidget(<EstimateCost />);
