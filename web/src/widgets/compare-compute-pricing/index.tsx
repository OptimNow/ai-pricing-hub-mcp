import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";
import { Badge, EmptyState, ErrorState, LoadingState, WidgetHeader, WidgetShell } from "../../components/index.js";

type ComputeOutput = NonNullable<ReturnType<typeof useToolInfo<"compare-compute-pricing">>["output"]>;
type ComputeInstance = ComputeOutput["instances"][number];

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
  const { output } = useToolInfo<"compare-compute-pricing">();

  if (!output) {
    return <LoadingState label="Loading pricing..." />;
  }

  const { instances, matchingCount, catalogSize, error } = output;

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
        subtitle={`${matchingCount} of ${catalogSize} instances match · Showing ${instances.length} · Linux on-demand`}
      />

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

const thStyle: React.CSSProperties = {
  textAlign: "right",
  padding: "6px 8px",
  color: "var(--text-muted)",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid var(--border-subtle)",
  whiteSpace: "nowrap",
};

function InstanceRow({ inst, rank }: { inst: ComputeInstance; rank: number }) {
  const color = `var(${providerVars[inst.provider] ?? "--text"})`;
  const savings = inst.spot && inst.onDemandHourly
    ? Math.round((1 - inst.spot / inst.onDemandHourly) * 100)
    : null;

  return (
    <tr>
      <td style={{ ...tdStyle, textAlign: "right", color: "var(--text-faint)" }}>{rank}</td>
      <td style={{ ...tdStyle, textAlign: "left" }}>
        <span style={{
          fontWeight: 600, color,
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          padding: "1px 6px", borderRadius: "3px",
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
        <Badge label={inst.category} inline />
      </td>
    </tr>
  );
}

export default ComputePricing;
mountWidget(<ComputePricing />);
