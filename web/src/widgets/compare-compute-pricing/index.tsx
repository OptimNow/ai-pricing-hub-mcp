import "@/index.css";
import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../../helpers.js";

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

const providerColors: Record<string, string> = {
  AWS: "#FF9900",
  Azure: "#0078D4",
  GCP: "#4285F4",
  DigitalOcean: "#0080FF",
  OCI: "#C74634",
  OVH: "#000E9C",
  Alibaba: "#FF6A00",
};

function ComputePricing() {
  const { output } = useToolInfo();

  if (!output) {
    return <div style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>Loading pricing...</div>;
  }

  const { instances, matchingCount, catalogSize, source, provenance, error } = output as unknown as ComputeOutput;

  if (error) {
    return <ErrorCard message={error} />;
  }

  if (instances.length === 0) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px" }}>
        <div style={{
          border: "1px dashed #d1d5db", borderRadius: "8px", padding: "24px",
          textAlign: "center", color: "#6b7280", fontSize: "13px",
        }}>
          No results match these filters.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: "860px" }}>
      <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>
        Cloud Compute Pricing
      </h2>
      <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
        {matchingCount} of {catalogSize} instances match · Showing {instances.length} · Linux on-demand
        {provenance ? ` · ${provenance.region}` : ""}
        {provenance?.upstreamTimestamp ? ` · as of ${provenance.upstreamTimestamp.slice(0, 10)}` : ""}
      </p>

      {/* The commitment columns are the ones a FinOps reader acts on, and some
          of them are us-east-1 constants scaled by a region multiplier rather
          than a live rate. Showing them beside live on-demand prices without
          saying which is which is what makes an answer unauditable. */}
      {(source === "static-fallback" || (provenance?.staticPriceColumns.length ?? 0) > 0) && (
        <p style={{
          fontSize: "12px", marginBottom: "16px", padding: "8px 10px",
          background: "#fef3c7", color: "#92400e", borderRadius: "6px",
        }}>
          {source === "static-fallback"
            ? provenance?.notice ?? "Serving a static snapshot — prices may be stale."
            : `Not live, served from constants: ${provenance!.staticPriceColumns.join(", ")}.`}
        </p>
      )}

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
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
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px" }}>
      <div style={{
        border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b",
        borderRadius: "8px", padding: "12px 14px", fontSize: "13px",
      }}>
        <strong style={{ display: "block", marginBottom: "4px" }}>Could not load compute pricing</strong>
        {message}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "right",
  padding: "6px 8px",
  color: "#6b7280",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderBottom: "1px solid #f3f4f6",
  whiteSpace: "nowrap",
};

function InstanceRow({ inst, rank }: { inst: ComputeInstance; rank: number }) {
  const color = providerColors[inst.provider] || "#374151";
  const savings = inst.spot && inst.onDemandHourly
    ? Math.round((1 - inst.spot / inst.onDemandHourly) * 100)
    : null;

  return (
    <tr>
      <td style={{ ...tdStyle, textAlign: "right", color: "#9ca3af" }}>{rank}</td>
      <td style={{ ...tdStyle, textAlign: "left" }}>
        <span style={{
          fontWeight: 600, color,
          background: `${color}15`, padding: "1px 6px", borderRadius: "3px",
        }}>
          {inst.provider}
        </span>
      </td>
      <td style={{ ...tdStyle, textAlign: "left", fontWeight: 500, fontFamily: "monospace", fontSize: "11px" }}>
        {inst.instanceType}
      </td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{inst.vCPUs}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{inst.memory} GiB</td>
      <td style={{ ...tdStyle, textAlign: "left", fontSize: "11px", color: "#6b7280" }}>{inst.processor}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
        ${inst.onDemandHourly?.toFixed(4)}
      </td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: "#2563eb" }}>
        ${inst.onDemandMonthly?.toFixed(2)}
      </td>
      <td style={{ ...tdStyle, textAlign: "right" }}>
        {inst.spot ? (
          <span>
            ${inst.spot.toFixed(4)}
            {savings !== null && (
              <span style={{ color: "#16a34a", fontSize: "10px", marginLeft: "3px" }}>
                -{savings}%
              </span>
            )}
          </span>
        ) : (
          <span style={{ color: "#d1d5db" }}>—</span>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: "left" }}>
        <span style={{
          fontSize: "10px", background: "#f3f4f6", color: "#374151",
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
