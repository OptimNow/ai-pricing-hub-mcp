import "@/index.css";
import type { CSSProperties } from "react";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost, leverSummary } from "../../format.js";
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
  savingsPct: number;
  /** Workload is async enough for the batch API */
  batchEligible: boolean;
  /** Workload has a reusable prefix */
  cacheEligible: boolean;
  /** Batch eligible AND the model publishes batch rates */
  batchApplied: boolean;
  /** Cache eligible AND the model publishes a cache-read rate */
  cacheApplied: boolean;
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

function ModelCostCard({ mc }: { mc: ModelCostItem }) {
  const m = mc.model;
  const monthlies = mc.costs.map(c => c.monthly);
  const minCost = Math.min(...monthlies);
  const maxCost = Math.max(...monthlies);

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
    </div>
  );
}

const trackStyle: CSSProperties = {
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

/** The optimization is conditional, so a 0% bar would read as a bug. When no
 *  lever applies the row says which one was missing instead. */
function SavingsRow({ cost: c, scaleMax }: { cost: CostEntry; scaleMax: number }) {
  const pct = (v: number) => (scaleMax > 0 ? (v / scaleMax) * 100 : 0);
  const saved = c.savingsPct > 0;

  // formatBudget drops cents between $1 and $1000, which is right for a budget
  // and wrong for a pair: at 50 requests/month a real 20% saving rendered as
  // "List $2 / Optimized $2 / −20%" beside two visibly different bars. When the
  // rounding would collapse the pair, fall back to the finer formatter.
  const collapsed = saved && formatBudget(c.monthly) === formatBudget(c.monthlyOptimized);
  const money = collapsed ? formatCost : formatBudget;

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
        <span style={{ width: "62px", textAlign: "right", fontWeight: 600 }}>{money(c.monthly)}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ width: "58px", color: "var(--text-faint)", fontSize: "10px" }}>Optimized</span>
        <Bar width={pct(c.monthlyOptimized)} fill={saved ? "var(--brand)" : "var(--border-dashed)"} />
        <span style={{ width: "62px", textAlign: "right", fontWeight: 600, color: saved ? "var(--brand-text)" : "var(--text-muted)" }}>
          {money(c.monthlyOptimized)}
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
