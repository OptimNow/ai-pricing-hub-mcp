import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost } from "../../format.js";
import {
  Card, EmptyState, ErrorState, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

type EstimateOutput = NonNullable<ReturnType<typeof useToolInfo<"estimate-llm-cost">>["output"]>;
type ModelCostItem = EstimateOutput["modelCosts"][number];
type CostEntry = ModelCostItem["costs"][number];

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

/** Which lever produced the saving — or why there isn't one. Mirrors
 *  leverSummary in server/src/index.ts so the widget and the text the model
 *  reads never disagree about what happened. */
function leverSummary(c: CostEntry): string {
  const applied = [c.cacheApplied ? "caching" : "", c.batchApplied ? "batch API" : ""].filter(Boolean);
  if (applied.length > 0) return applied.join(" + ");
  if (!c.cacheEligible && !c.batchEligible) {
    return "this workload has no cacheable prefix and is not batch-eligible";
  }
  const missing = [c.cacheEligible ? "cache-read" : "", c.batchEligible ? "batch" : ""].filter(Boolean);
  return `this model publishes no ${missing.join(" or ")} rate`;
}

function ModelCostCard({ mc }: { mc: ModelCostItem }) {
  const m = mc.model;
  const monthlies = mc.costs.map(c => c.monthly);
  const minCost = Math.min(...monthlies);
  const maxCost = Math.max(...monthlies);

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

      {/* Paired bars: list vs what caching + batch actually get you */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {mc.costs.map(c => (
          <SavingsRow key={c.useCase} cost={c} scaleMax={maxCost} />
        ))}
      </div>

      {/* Budget Range */}
      {mc.costs.length > 1 && (
        <div style={{
          marginTop: "10px", fontSize: "11px", color: "var(--text-muted)",
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

const trackStyle: React.CSSProperties = {
  flex: 1,
  height: "9px",
  background: "var(--surface-subtle)",
  borderRadius: "5px",
  overflow: "hidden",
};

function Bar({ width, fill }: { width: number; fill: string }) {
  return (
    <div style={trackStyle}>
      {/* 1.5% floor keeps a near-zero cost visible as a sliver rather than nothing */}
      <div style={{ width: `${Math.max(width, 1.5)}%`, height: "100%", background: fill, borderRadius: "5px" }} />
    </div>
  );
}

function SavingsRow({ cost: c, scaleMax }: { cost: CostEntry; scaleMax: number }) {
  const pct = (v: number) => (scaleMax > 0 ? (v / scaleMax) * 100 : 0);
  const saved = c.savingsPct > 0;

  return (
    <div style={{ fontSize: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
        <span style={{ fontWeight: 500 }}>{c.useCase}</span>
        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          {c.inputTokens.toLocaleString()} in + {c.outputTokens.toLocaleString()} out ·{" "}
          {formatCost(c.perRequest)}/req
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
        <span style={{ width: "58px", color: "var(--text-faint)", fontSize: "10px" }}>List</span>
        <Bar width={pct(c.monthly)} fill="var(--text-faint)" />
        <span style={{ width: "62px", textAlign: "right", fontWeight: 600 }}>{formatBudget(c.monthly)}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ width: "58px", color: "var(--text-faint)", fontSize: "10px" }}>Optimized</span>
        <Bar width={pct(c.monthlyOptimized)} fill={saved ? "var(--brand)" : "var(--border-dashed)"} />
        <span style={{ width: "62px", textAlign: "right", fontWeight: 600, color: saved ? "var(--brand-text)" : "var(--text-muted)" }}>
          {formatBudget(c.monthlyOptimized)}
        </span>
      </div>

      <div style={{ marginLeft: "66px", marginTop: "2px", fontSize: "10px", color: "var(--text-muted)" }}>
        {saved ? (
          <>
            <strong style={{ color: "var(--positive)" }}>save {c.savingsPct}%</strong>{" "}
            with {leverSummary(c)}
          </>
        ) : (
          <>Same as list price — {leverSummary(c)}</>
        )}
      </div>
    </div>
  );
}

export default EstimateCost;
mountWidget(<EstimateCost />);
