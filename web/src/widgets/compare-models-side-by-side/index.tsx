import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost } from "../../format.js";
import {
  Badge, EmptyState, ErrorState, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

type SideBySideOutput = NonNullable<ReturnType<typeof useToolInfo<"compare-models-side-by-side">>["output"]>;
type ComparedModel = SideBySideOutput["models"][number];
type ResolutionEntry = SideBySideOutput["resolution"][number];

function CompareSideBySide() {
  const { output } = useToolInfo<"compare-models-side-by-side">();

  if (!output) {
    return <LoadingState label="Resolving models..." />;
  }

  const { models, resolution, volume, volumeLabel, source, eloAsOf, dataAsOf, error } = output;

  if (error) {
    return (
      <WidgetShell maxWidth={880}>
        <ErrorState title="Could not build the comparison" message={error} />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell maxWidth={880}>
      <WidgetHeader
        title="Models Side by Side"
        subtitle={`${models.length} models · ${volume.toLocaleString()} requests/month (${volumeLabel})`}
      >
        <FreshnessBadges source={source} eloAsOf={eloAsOf} dataAsOf={dataAsOf} />
      </WidgetHeader>

      <ResolutionNotes resolution={resolution} />

      {models.length === 0 ? <EmptyState message="No models resolved." /> : <CostTable models={models} />}

      <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "10px" }}>
        Top figure is the list price per request; below it, the price with prompt caching and the batch
        API where the workload allows. Percentages compare each model to the cheapest in its row.
      </p>
    </WidgetShell>
  );
}

/** Anything other than a clean hit is stated: an ambiguous or dropped name that
 *  quietly changes the columns is worse than no comparison at all. */
function ResolutionNotes({ resolution }: { resolution: ResolutionEntry[] }) {
  const notable = resolution.filter(r => r.status !== "exact" && r.status !== "unique");
  if (notable.length === 0) return null;

  return (
    <div style={{
      border: "1px solid var(--warn-bg)", background: "var(--warn-bg)", color: "var(--warn-text)",
      borderRadius: "6px", padding: "8px 10px", fontSize: "11px", marginBottom: "12px",
    }}>
      {notable.map(r => (
        <div key={`${r.query}-${r.status}`}>
          {r.status === "not-found" && <>“{r.query}” matched no model — it has no column.</>}
          {r.status === "duplicate" && <>“{r.query}” resolved to {r.resolved}, already chosen by an earlier name — no extra column.</>}
          {r.status === "ambiguous" && (
            <>“{r.query}” matched several models; used <strong>{r.resolved}</strong>
              {r.alternatives.length > 0 && <> (also matched: {r.alternatives.join(", ")})</>}.</>
          )}
        </div>
      ))}
    </div>
  );
}

const cellStyle: React.CSSProperties = { padding: "7px 10px", verticalAlign: "top" };

function CostTable({ models }: { models: ComparedModel[] }) {
  const useCases = models[0].useCaseCosts;

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
      <table style={{ width: "100%", minWidth: "560px", borderCollapse: "collapse", fontSize: "12px" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-subtle)" }}>
            <th style={{ ...cellStyle, textAlign: "left", color: "var(--text-muted)", fontWeight: 500 }}>Use case</th>
            {models.map(m => (
              <th key={`${m.provider}-${m.model}`} style={{ ...cellStyle, textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>{m.model}</div>
                <div style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "11px" }}>{m.provider}</div>
                <div style={{ color: "var(--text-faint)", fontWeight: 400, fontSize: "10px", marginTop: "2px" }}>
                  ${m.inputPricePer1M}/1M in · ${m.outputPricePer1M}/1M out
                </div>
                <div style={{ marginTop: "3px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {m.eloScore && <Badge label={`ELO ${m.eloScore}`} inline />}
                  <Badge label={m.contextWindow} inline />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {useCases.map((uc, row) => {
            const values = models.map(m => m.useCaseCosts[row]);
            const cheapest = Math.min(...values.map(v => v.perRequest));
            return (
              <tr key={uc.key} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ ...cellStyle }}>
                  <div style={{ fontWeight: 500 }}>{uc.label}</div>
                  <div style={{ color: "var(--text-faint)", fontSize: "10px" }}>
                    {uc.inputTokens.toLocaleString()} + {uc.outputTokens.toLocaleString()} tok
                  </div>
                </td>
                {values.map((c, i) => (
                  <CostCell key={`${models[i].provider}-${models[i].model}`} cost={c} cheapest={cheapest} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CostCell({ cost: c, cheapest }: { cost: ComparedModel["useCaseCosts"][number]; cheapest: number }) {
  const isCheapest = c.perRequest === cheapest;
  const deltaPct = cheapest > 0 ? Math.round((c.perRequest / cheapest - 1) * 100) : 0;

  return (
    <td style={{
      ...cellStyle,
      background: isCheapest ? "var(--surface-accent)" : "transparent",
      whiteSpace: "nowrap",
    }}>
      <div style={{ fontWeight: 600, color: isCheapest ? "var(--brand-text)" : "var(--text)" }}>
        {formatCost(c.perRequest)}
        {!isCheapest && deltaPct >= 1 && (
          <span style={{ marginLeft: "5px", fontSize: "10px", fontWeight: 400, color: "var(--text-faint)" }}>+{deltaPct}%</span>
        )}
      </div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
        {formatCost(c.perRequestOptimized)} opt
        {c.savingsPct > 0 && <span style={{ color: "var(--positive)", marginLeft: "3px" }}>−{c.savingsPct}%</span>}
      </div>
      <div style={{ fontSize: "10px", color: "var(--text-faint)" }}>{formatBudget(c.monthly)}/mo</div>
    </td>
  );
}

export default CompareSideBySide;
mountWidget(<CompareSideBySide />);
