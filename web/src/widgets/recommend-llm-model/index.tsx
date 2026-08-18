import "@/index.css";
import type { MouseEvent } from "react";
import { mountWidget, useOpenExternal } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { formatBudget, formatCost } from "../../format.js";
import {
  Badge, Card, EmptyState, ErrorState, FreshnessBadges, LoadingState, WidgetHeader, WidgetShell,
} from "../../components/index.js";

// The handler's success and error paths return different shapes, so skybridge
// infers this tool's output as a union it cannot usefully destructure. Until
// those returns are unified server-side, the contract is restated here.
interface ConstraintCheck {
  constraint: string;
  required: string;
  actual: string;
  satisfied: boolean;
}

interface Recommendation {
  rank: number;
  provider: string;
  model: string;
  category: string;
  /** Self-hostability, derived from the licence — a separate axis from category */
  openness: string;
  contextWindow: string;
  capabilities: string[];
  license?: string;
  eloScore: number | null;
  efficiencyScore: number | null;
  efficiencyRank: number | null;
  rankedOutOf: number;
  perRequest: number;
  perRequestOptimized: number;
  monthlyBudget: number;
  monthlyOptimizedBudget: number;
  savingsPct: number;
  isFinOpsFriendly: boolean;
  volatilityRisk: string;
  costDeltaVsTopPct: number;
  constraints: ConstraintCheck[];
}

interface RecommendOutput {
  recommendations: Recommendation[];
  nearMisses: Recommendation[];
  overConstrained: boolean;
  useCaseLabel: string;
  volumeLabel: string;
  volume: number;
  candidateCount: number;
  rankedCount: number;
  catalogSize: number;
  roiCalculatorUrl: string;
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

function RecommendModel() {
  const { output } = useToolInfo();

  if (!output) {
    return <LoadingState label="Ranking models..." />;
  }

  const {
    recommendations, nearMisses, overConstrained, useCaseLabel, volumeLabel,
    candidateCount, rankedCount, roiCalculatorUrl, source, eloAsOf, dataAsOf, provenance, error,
  } = output as unknown as RecommendOutput;

  if (error) {
    return (
      <WidgetShell maxWidth={800}>
        <ErrorState title="Could not rank models" message={error} />
      </WidgetShell>
    );
  }

  const shown = overConstrained ? nearMisses : recommendations;

  return (
    <WidgetShell maxWidth={800}>
      <WidgetHeader
        title={overConstrained ? "Closest Matches" : "Recommended Models"}
        subtitle={
          overConstrained
            ? `No model meets every constraint · ${useCaseLabel} · ${volumeLabel}/mo`
            : `${candidateCount} of ${rankedCount} ranked models qualify · ${useCaseLabel} · ${volumeLabel}/mo`
        }
      >
        <FreshnessBadges source={source} eloAsOf={eloAsOf} dataAsOf={dataAsOf} />
        {/* A recommendation is a ranking over prices. Uncorrected ones can
            reorder the podium outright, so this caveat is load-bearing. */}
        {provenance && !provenance.pricesVerified && source !== "static-fallback" && (
          <Badge label="unverified prices — not price-corrected" tone="warn" />
        )}
      </WidgetHeader>

      {overConstrained && (
        <div style={{
          border: "1px solid var(--warn-bg)", background: "var(--warn-bg)", color: "var(--warn-text)",
          borderRadius: "6px", padding: "8px 10px", fontSize: "11px", marginBottom: "12px",
        }}>
          Nothing satisfied all of the constraints. These are the models that came closest — each card
          lists the constraint it failed, so you can see which one to relax.
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState message="No model in the catalogue could be ranked for this workload." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(shown.length, 3)}, 1fr)`, gap: "10px" }}>
          {shown.map(r => <PodiumCard key={`${r.provider}-${r.model}`} rec={r} />)}
        </div>
      )}

      <RoiLink url={roiCalculatorUrl} />
    </WidgetShell>
  );
}

function PodiumCard({ rec: r }: { rec: Recommendation }) {
  return (
    <Card accent={r.rank === 1}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "6px" }}>
        <span style={{ fontSize: "20px", fontWeight: 700, color: r.rank === 1 ? "var(--brand-text)" : "var(--text-faint)" }}>
          #{r.rank}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "13px", overflowWrap: "anywhere" }}>{r.model}</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{r.provider}</div>
        </div>
      </div>

      <div style={{ fontSize: "18px", fontWeight: 700 }}>
        {formatBudget(r.monthlyBudget)}
        <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--text-muted)" }}>/mo</span>
      </div>
      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
        {formatBudget(r.monthlyOptimizedBudget)}/mo optimized
        {r.savingsPct > 0 && <span style={{ color: "var(--positive)", marginLeft: "4px" }}>−{r.savingsPct}%</span>}
      </div>
      <div style={{ fontSize: "11px", color: "var(--text-faint)", marginTop: "2px" }}>
        {formatCost(r.perRequest)}/req ·{" "}
        {/* The ranking is by value score, not by price — #1 is routinely dearer
            than #2. Calling it "cheapest" contradicted the −N% printed on the
            sibling card two columns over. */}
        {r.rank === 1 ? "best value score" : `${r.costDeltaVsTopPct >= 0 ? "+" : ""}${r.costDeltaVsTopPct}% vs #1`}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
        {r.eloScore !== null && <Badge label={`ELO ${r.eloScore}`} inline />}
        {r.efficiencyScore !== null && (
          <Badge label={`Efficiency ${r.efficiencyScore} (#${r.efficiencyRank}/${r.rankedOutOf})`} inline />
        )}
        {/* Price tier and self-hostability are independent axes; show both. */}
        <Badge label={r.category} inline />
        {r.openness !== "Unknown" && <Badge label={r.openness} inline />}
        {r.isFinOpsFriendly && <Badge label="FinOps Friendly" tone="brand" inline />}
        {r.volatilityRisk !== "Stable" && (
          <Badge label={`${r.volatilityRisk} volatility`} tone={r.volatilityRisk === "High" ? "warn" : "neutral"} inline />
        )}
      </div>

      {r.constraints.length > 0 && (
        <ul style={{ listStyle: "none", marginTop: "8px", fontSize: "10px", display: "flex", flexDirection: "column", gap: "2px" }}>
          {r.constraints.map(c => (
            <li key={c.constraint} style={{ color: c.satisfied ? "var(--text-muted)" : "var(--negative)" }}>
              {c.satisfied ? "✓" : "✕"} {c.constraint}: {c.required} — {c.actual}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Widget iframes are sandboxed, so a plain target="_blank" is likely inert:
 *  the host bridge (`ui/open-link` on MCP hosts, window.openai.openExternal on
 *  the Apps SDK) is the supported route. The anchor stays for its href — hosts
 *  that do allow navigation, and right-click-to-copy, both still work — and the
 *  same URL ships in structuredContent so the model can offer it as chat text. */
function RoiLink({ url }: { url: string }) {
  const openExternal = useOpenExternal();

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    try {
      openExternal(url);
      event.preventDefault();
    } catch {
      // No bridge in this host: leave the anchor to try on its own.
    }
  };

  return (
    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "12px" }}>
      <a href={url} target="_blank" rel="noopener" onClick={open} style={{ color: "var(--brand-text)", fontWeight: 600 }}>
        Open this scenario in the AI ROI Calculator →
      </a>{" "}
      <Badge label="experimental" inline />{" "}
      <span>If nothing opens, ask for the link as text.</span>
    </p>
  );
}

export default RecommendModel;
mountWidget(<RecommendModel />);
