import "@/index.css";
import type { CSSProperties } from "react";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { EmptyState, ErrorState, LoadingState, Notice, WidgetHeader, WidgetShell } from "../../components/index.js";

// The handler's success and error paths return different shapes, so skybridge
// infers this tool's output as a union it cannot usefully destructure. Until
// those returns are unified server-side, the contract is restated here.
interface ComputeInstance {
  provider: string;
  instanceType: string;
  vCPUs: number;
  memory: number;
  processor: string;
  category: string;
  os: string;
  onDemandHourly: number | null;
  onDemandMonthly: number | null;
  spot: number | null;
  reserved1yr: number | null;
  reserved3yr: number | null;
  useCases: string[];
}

interface ComputeOutput {
  instances: ComputeInstance[];
  matchingCount: number;
  catalogSize: number;
  source?: string;
  provenance?: {
    tier: number;
    label: string;
    region: string;
    upstreamTimestamp?: string;
    /** "Provider.column" entries served from constants rather than a live API. */
    staticPriceColumns: string[];
    unavailablePriceColumns: string[];
    notice?: string;
  };
  error?: string;
}

/** Brand hues live in index.css so each has a light and a dark variant: the
 *  as-published colours (OVH navy, AWS orange) fail contrast on one side. */
const providerVars: Record<string, string> = {
  AWS: "--provider-aws",
  Azure: "--provider-azure",
  GCP: "--provider-gcp",
  DigitalOcean: "--provider-digitalocean",
  OCI: "--provider-oci",
  OVH: "--provider-ovh",
  Alibaba: "--provider-alibaba",
};

function ComputePricing() {
  const { output } = useToolInfo();

  if (!output) {
    return <LoadingState label="Loading pricing..." />;
  }

  const { instances, matchingCount, catalogSize, source, provenance, error } =
    output as unknown as ComputeOutput;

  if (error) {
    return (
      <WidgetShell maxWidth={860}>
        <ErrorState title="Could not load compute pricing" message={error} />
      </WidgetShell>
    );
  }

  if (instances.length === 0) {
    return (
      <WidgetShell maxWidth={860}>
        <EmptyState />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell maxWidth={860}>
      <WidgetHeader
        title="Cloud Compute Pricing"
        subtitle={
          `${matchingCount} of ${catalogSize} instances match · Showing ${instances.length} · Linux on-demand` +
          (provenance ? ` · ${provenance.region}` : "") +
          (provenance?.upstreamTimestamp ? ` · as of ${provenance.upstreamTimestamp.slice(0, 10)}` : "")
        }
      />

      {/* The commitment columns are the ones a FinOps reader acts on, and some
          of them are us-east-1 constants scaled by a region multiplier rather
          than a live rate. Showing them beside live on-demand prices without
          saying which is which is what makes an answer unauditable. */}
      {(source === "static-fallback" || (provenance?.staticPriceColumns.length ?? 0) > 0) && (
        <Notice>
          {source === "static-fallback"
            ? provenance?.notice ?? "Serving a static snapshot — prices may be stale."
            : `Not live, served from constants: ${provenance!.staticPriceColumns.join(", ")}.`}
        </Notice>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={thStyle}>#</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Provider</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Instance</th>
              <th style={thStyle}>vCPUs</th>
              <th style={thStyle}>Memory</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Processor</th>
              <th style={thStyle}>Hourly</th>
              <th style={thStyle}>Monthly</th>
              <th style={thStyle}>Spot</th>
              <th style={{ ...thStyle, textAlign: "left" }}>Category</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((inst, i) => (
              <InstanceRow key={`${inst.provider}-${inst.instanceType}-${i}`} inst={inst} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
    </WidgetShell>
  );
}

const thStyle: CSSProperties = {
  textAlign: "right",
  padding: "6px 8px",
  color: "var(--text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--border-subtle)",
  whiteSpace: "nowrap",
};

function InstanceRow({ inst, rank }: { inst: ComputeInstance; rank: number }) {
  const color = `var(${providerVars[inst.provider] ?? "--chip-text"})`;
  const savings = inst.spot && inst.onDemandHourly
    ? Math.round((1 - inst.spot / inst.onDemandHourly) * 100)
    : null;

  return (
    <tr>
      <td style={{ ...tdStyle, textAlign: "right", color: "var(--text-faint)" }}>{rank}</td>
      <td style={{ ...tdStyle, textAlign: "left" }}>
        <span style={{
          fontWeight: 600, color,
          background: "var(--chip-bg)", padding: "1px 6px", borderRadius: "3px",
        }}>
          {inst.provider}
        </span>
      </td>
      <td style={{ ...tdStyle, textAlign: "left", fontWeight: 500, fontFamily: "monospace", fontSize: "11px" }}>
        {inst.instanceType}
      </td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{inst.vCPUs}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{inst.memory} GiB</td>
      <td style={{ ...tdStyle, textAlign: "left", fontSize: "11px", color: "var(--text-muted)" }}>{inst.processor}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
        ${inst.onDemandHourly?.toFixed(4)}
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: "var(--brand-text)" }}>
        ${inst.onDemandMonthly?.toFixed(2)}
      </td>
      <td style={{ ...tdStyle, textAlign: "right" }}>
        {inst.spot ? (
          <span>
            ${inst.spot.toFixed(4)}
            {savings !== null && (
              <span style={{ color: "var(--positive)", fontSize: "10px", marginLeft: "3px" }}>
                -{savings}%
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>—</span>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: "left" }}>
        <span style={{
          fontSize: "10px", background: "var(--chip-bg)", color: "var(--chip-text)",
          padding: "1px 6px", borderRadius: "3px",
        }}>
          {inst.category}
        </span>
      </td>
    </tr>
  );
}

export default ComputePricing;
mountWidget(<ComputePricing />);
