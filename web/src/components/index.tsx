import type { CSSProperties, ReactNode } from "react";

/** Outer frame every widget renders into. */
export function WidgetShell({ maxWidth, children }: { maxWidth: number; children: ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: `${maxWidth}px`, color: "var(--text)" }}>
      {children}
    </div>
  );
}

/** Title plus a subtitle line that also carries the data-freshness badges. */
export function WidgetHeader({ title, subtitle, children }: { title: string; subtitle: ReactNode; children?: ReactNode }) {
  return (
    <>
      <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "4px" }}>{title}</h2>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
        {subtitle}
        {children}
      </p>
    </>
  );
}

export type BadgeTone = "neutral" | "warn" | "brand";

const badgeTones: Record<BadgeTone, CSSProperties> = {
  neutral: { background: "var(--chip-bg)", color: "var(--chip-text)" },
  warn: { background: "var(--warn-bg)", color: "var(--warn-text)" },
  brand: { background: "var(--brand-soft)", color: "var(--brand-text)", border: "1px solid var(--brand-border)" },
};

export function Badge({ label, tone = "neutral", inline }: { label: string; tone?: BadgeTone; inline?: boolean }) {
  return (
    <span style={{
      marginLeft: inline ? 0 : "8px", fontSize: "11px", borderRadius: "4px", padding: "1px 6px",
      whiteSpace: "nowrap", ...badgeTones[tone],
    }}>
      {label}
    </span>
  );
}

export function Card({ accent, children }: { accent?: boolean; children: ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${accent ? "var(--brand-border)" : "var(--border)"}`,
      borderRadius: "8px",
      padding: "12px",
      background: accent ? "var(--surface-accent)" : "var(--surface)",
    }}>
      {children}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>{label}</div>;
}

export function EmptyState({ message = "No results match these filters." }: { message?: string }) {
  return (
    <div style={{
      border: "1px dashed var(--border-dashed)", borderRadius: "8px", padding: "24px",
      textAlign: "center", color: "var(--text-muted)", fontSize: "13px",
    }}>
      {message}
    </div>
  );
}

export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div style={{
      border: "1px solid var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)",
      borderRadius: "8px", padding: "12px 14px", fontSize: "13px",
    }}>
      <strong style={{ display: "block", marginBottom: "4px" }}>{title}</strong>
      {message}
    </div>
  );
}

/** ELO + static-snapshot badges, identical across the two LLM widgets. */
export function FreshnessBadges({ source, eloAsOf, dataAsOf }: { source: string; eloAsOf: string; dataAsOf?: string }) {
  return (
    <>
      {eloAsOf && <Badge label={`ELO as of ${eloAsOf}`} />}
      {source === "static-fallback" && (
        <Badge label={`static snapshot${dataAsOf ? ` ${dataAsOf}` : ""}`} tone="warn" />
      )}
    </>
  );
}

/** Banner for something the reader must not miss: a static snapshot, or price
 *  columns served from constants rather than a live rate.
 *
 *  Not a Badge. `provenance` is the difference between an auditable FinOps
 *  answer and a plausible one, so it gets block-level weight rather than a chip
 *  the eye slides past. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p style={{
      fontSize: "12px", marginBottom: "16px", padding: "8px 10px",
      background: "var(--warn-bg)", color: "var(--warn-text)", borderRadius: "6px",
    }}>
      {children}
    </p>
  );
}

/** Quiet line under the header — used to state what a percentile-gated badge
 *  lands on today, so the badge is auditable rather than taken on trust. */
export function FootNote({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "-8px", marginBottom: "16px" }}>
      {children}
    </p>
  );
}
