export type CloudProvider = "AWS" | "Azure" | "GCP" | "DigitalOcean" | "OCI" | "OVH" | "Alibaba";
export type OperatingSystem = "Linux" | "Windows";

export interface ComputeInstance {
  provider: CloudProvider;
  instanceType: string;
  os: OperatingSystem;
  vCPUs: number;
  memory: number; // GiB
  onDemandHourly: number | null;
  onDemandMonthly: number | null;
  spot: number | null;
  savingsPlan1yr: number | null;
  savingsPlan3yr: number | null;
  reserved1yr: number | null;
  reserved3yr: number | null;
}

export type LLMCapability = "Text" | "Vision" | "Code" | "Reasoning" | "Agents" | "Image Gen" | "Audio";

export interface LLMModel {
  provider: string;
  model: string;
  parameters?: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: string;
  category: "Frontier" | "Mid-tier" | "Budget" | "Open Weights" | "Image";
  capabilities: LLMCapability[];
  releaseDate?: string;
  eloScore?: number;
  license?: string;
}

/* ── Data sourcing metadata ── */
export const dataLastUpdated = "2025-02-01";
export const dataSources: Record<CloudProvider, string> = {
  AWS: "https://aws.amazon.com/ec2/pricing/on-demand/",
  Azure: "https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/",
  GCP: "https://cloud.google.com/compute/vm-instance-pricing",
  DigitalOcean: "https://www.digitalocean.com/pricing/droplets",
  OCI: "https://www.oracle.com/cloud/compute/pricing/",
  OVH: "https://www.ovhcloud.com/en/public-cloud/prices/",
  Alibaba: "https://www.alibabacloud.com/pricing?product=ecs",
};

/* ── Region support ── */
export type ComputeRegion = "US East" | "US West" | "Europe" | "Asia Pacific";
export const computeRegions: ComputeRegion[] = ["US East", "US West", "Europe", "Asia Pacific"];

/** Maps each generic region to the provider-specific region name */
export const regionDetails: Record<ComputeRegion, Record<CloudProvider, string>> = {
  "US East":      { AWS: "us-east-1 (N. Virginia)",    Azure: "East US",        GCP: "us-central1 (Iowa)",      DigitalOcean: "NYC1 (New York)",     OCI: "us-ashburn-1",       OVH: "US-EAST-VA-1",    Alibaba: "us-east-1 (Virginia)" },
  "US West":      { AWS: "us-west-2 (Oregon)",         Azure: "West US 2",      GCP: "us-west1 (Oregon)",       DigitalOcean: "SFO3 (San Francisco)", OCI: "us-phoenix-1",       OVH: "US-WEST-OR-1",    Alibaba: "us-west-1 (Silicon Valley)" },
  "Europe":       { AWS: "eu-west-1 (Ireland)",        Azure: "West Europe",    GCP: "europe-west1 (Belgium)",  DigitalOcean: "AMS3 (Amsterdam)",    OCI: "eu-frankfurt-1",     OVH: "EU-WEST-GRA",     Alibaba: "eu-central-1 (Frankfurt)" },
  "Asia Pacific": { AWS: "ap-southeast-1 (Singapore)", Azure: "Southeast Asia", GCP: "asia-east1 (Taiwan)",     DigitalOcean: "SGP1 (Singapore)",    OCI: "ap-tokyo-1",         OVH: "AP-SOUTH-SG",     Alibaba: "ap-southeast-1 (Singapore)" },
};

/**
 * Regional price multipliers relative to US East (base = 1.0).
 * Based on typical regional pricing differentials from public pricing pages.
 * Actual prices vary per instance type; these are representative averages.
 */
export const regionMultipliers: Record<ComputeRegion, Record<CloudProvider, number>> = {
  "US East":      { AWS: 1.00, Azure: 1.00, GCP: 1.00, DigitalOcean: 1.00, OCI: 1.00, OVH: 1.00, Alibaba: 1.00 },
  "US West":      { AWS: 1.00, Azure: 1.02, GCP: 1.00, DigitalOcean: 1.00, OCI: 1.00, OVH: 1.00, Alibaba: 1.00 },
  "Europe":       { AWS: 1.08, Azure: 1.10, GCP: 1.07, DigitalOcean: 1.00, OCI: 1.05, OVH: 1.00, Alibaba: 1.10 },
  "Asia Pacific": { AWS: 1.15, Azure: 1.18, GCP: 1.12, DigitalOcean: 1.00, OCI: 1.08, OVH: 1.10, Alibaba: 1.05 },
};

export const computeInstances: ComputeInstance[] = [
  // ── AWS — Intel ──
  { provider: "AWS", instanceType: "t3.nano", os: "Linux", vCPUs: 2, memory: 0.5, onDemandHourly: 0.0052, onDemandMonthly: 3.80, spot: 0.0015, savingsPlan1yr: 0.0037, savingsPlan3yr: 0.0026, reserved1yr: 0.0033, reserved3yr: 0.0022 },
  { provider: "AWS", instanceType: "t3.micro", os: "Linux", vCPUs: 2, memory: 1, onDemandHourly: 0.0104, onDemandMonthly: 7.59, spot: 0.0037, savingsPlan1yr: 0.0075, savingsPlan3yr: 0.0052, reserved1yr: 0.0065, reserved3yr: 0.0045 },
  { provider: "AWS", instanceType: "t3.small", os: "Linux", vCPUs: 2, memory: 2, onDemandHourly: 0.0208, onDemandMonthly: 15.18, spot: 0.0073, savingsPlan1yr: 0.015, savingsPlan3yr: 0.0104, reserved1yr: 0.013, reserved3yr: 0.009 },
  { provider: "AWS", instanceType: "t3.medium", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.0416, onDemandMonthly: 30.37, spot: 0.0146, savingsPlan1yr: 0.03, savingsPlan3yr: 0.0208, reserved1yr: 0.026, reserved3yr: 0.018 },
  { provider: "AWS", instanceType: "t3.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0832, onDemandMonthly: 60.74, spot: 0.0292, savingsPlan1yr: 0.06, savingsPlan3yr: 0.0416, reserved1yr: 0.052, reserved3yr: 0.036 },
  { provider: "AWS", instanceType: "m5.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.096, onDemandMonthly: 70.08, spot: 0.0384, savingsPlan1yr: 0.057, savingsPlan3yr: 0.037, reserved1yr: 0.060, reserved3yr: 0.039 },
  { provider: "AWS", instanceType: "m5.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.192, onDemandMonthly: 140.16, spot: 0.0768, savingsPlan1yr: 0.114, savingsPlan3yr: 0.074, reserved1yr: 0.120, reserved3yr: 0.078 },
  { provider: "AWS", instanceType: "m5.2xlarge", os: "Linux", vCPUs: 8, memory: 32, onDemandHourly: 0.384, onDemandMonthly: 280.32, spot: 0.1536, savingsPlan1yr: 0.228, savingsPlan3yr: 0.148, reserved1yr: 0.240, reserved3yr: 0.156 },
  { provider: "AWS", instanceType: "m6i.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.096, onDemandMonthly: 70.08, spot: 0.0350, savingsPlan1yr: 0.057, savingsPlan3yr: 0.037, reserved1yr: 0.060, reserved3yr: 0.039 },
  { provider: "AWS", instanceType: "m6i.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.192, onDemandMonthly: 140.16, spot: 0.0700, savingsPlan1yr: 0.114, savingsPlan3yr: 0.074, reserved1yr: 0.120, reserved3yr: 0.078 },
  { provider: "AWS", instanceType: "m7i.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.1008, onDemandMonthly: 73.58, spot: 0.0380, savingsPlan1yr: 0.062, savingsPlan3yr: 0.040, reserved1yr: 0.064, reserved3yr: 0.042 },
  { provider: "AWS", instanceType: "m7i.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.2016, onDemandMonthly: 147.17, spot: 0.0760, savingsPlan1yr: 0.124, savingsPlan3yr: 0.080, reserved1yr: 0.128, reserved3yr: 0.084 },
  { provider: "AWS", instanceType: "c5.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.085, onDemandMonthly: 62.05, spot: 0.034, savingsPlan1yr: 0.051, savingsPlan3yr: 0.033, reserved1yr: 0.053, reserved3yr: 0.034 },
  { provider: "AWS", instanceType: "c5.xlarge", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.170, onDemandMonthly: 124.10, spot: 0.068, savingsPlan1yr: 0.101, savingsPlan3yr: 0.066, reserved1yr: 0.106, reserved3yr: 0.069 },
  { provider: "AWS", instanceType: "c6i.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.085, onDemandMonthly: 62.05, spot: 0.0310, savingsPlan1yr: 0.051, savingsPlan3yr: 0.033, reserved1yr: 0.053, reserved3yr: 0.034 },
  { provider: "AWS", instanceType: "c6i.xlarge", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.170, onDemandMonthly: 124.10, spot: 0.0620, savingsPlan1yr: 0.101, savingsPlan3yr: 0.066, reserved1yr: 0.106, reserved3yr: 0.069 },
  { provider: "AWS", instanceType: "r5.large", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.126, onDemandMonthly: 91.98, spot: 0.050, savingsPlan1yr: 0.075, savingsPlan3yr: 0.049, reserved1yr: 0.079, reserved3yr: 0.051 },
  { provider: "AWS", instanceType: "r5.xlarge", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.252, onDemandMonthly: 183.96, spot: 0.101, savingsPlan1yr: 0.150, savingsPlan3yr: 0.097, reserved1yr: 0.158, reserved3yr: 0.102 },
  { provider: "AWS", instanceType: "r6i.large", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.126, onDemandMonthly: 91.98, spot: 0.0460, savingsPlan1yr: 0.075, savingsPlan3yr: 0.049, reserved1yr: 0.079, reserved3yr: 0.051 },
  { provider: "AWS", instanceType: "r6i.xlarge", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.252, onDemandMonthly: 183.96, spot: 0.0920, savingsPlan1yr: 0.150, savingsPlan3yr: 0.097, reserved1yr: 0.158, reserved3yr: 0.102 },
  // ── AWS — AMD ──
  { provider: "AWS", instanceType: "t3a.nano", os: "Linux", vCPUs: 2, memory: 0.5, onDemandHourly: 0.0047, onDemandMonthly: 3.43, spot: 0.0015, savingsPlan1yr: 0.0034, savingsPlan3yr: 0.0023, reserved1yr: 0.0029, reserved3yr: 0.002 },
  { provider: "AWS", instanceType: "t3a.micro", os: "Linux", vCPUs: 2, memory: 1, onDemandHourly: 0.0094, onDemandMonthly: 6.86, spot: 0.0033, savingsPlan1yr: 0.0068, savingsPlan3yr: 0.0047, reserved1yr: 0.0059, reserved3yr: 0.0041 },
  { provider: "AWS", instanceType: "t3a.small", os: "Linux", vCPUs: 2, memory: 2, onDemandHourly: 0.0188, onDemandMonthly: 13.72, spot: 0.0066, savingsPlan1yr: 0.0135, savingsPlan3yr: 0.0094, reserved1yr: 0.0117, reserved3yr: 0.0081 },
  { provider: "AWS", instanceType: "m5a.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.086, onDemandMonthly: 62.78, spot: 0.0310, savingsPlan1yr: 0.051, savingsPlan3yr: 0.033, reserved1yr: 0.054, reserved3yr: 0.035 },
  { provider: "AWS", instanceType: "m6a.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0864, onDemandMonthly: 63.07, spot: 0.0310, savingsPlan1yr: 0.052, savingsPlan3yr: 0.033, reserved1yr: 0.054, reserved3yr: 0.035 },
  { provider: "AWS", instanceType: "m6a.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.1728, onDemandMonthly: 126.14, spot: 0.0620, savingsPlan1yr: 0.103, savingsPlan3yr: 0.067, reserved1yr: 0.108, reserved3yr: 0.070 },
  { provider: "AWS", instanceType: "c5a.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.077, onDemandMonthly: 56.21, spot: 0.0280, savingsPlan1yr: 0.046, savingsPlan3yr: 0.030, reserved1yr: 0.048, reserved3yr: 0.031 },
  { provider: "AWS", instanceType: "c6a.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.0765, onDemandMonthly: 55.85, spot: 0.0280, savingsPlan1yr: 0.046, savingsPlan3yr: 0.030, reserved1yr: 0.048, reserved3yr: 0.031 },
  { provider: "AWS", instanceType: "c6a.xlarge", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.153, onDemandMonthly: 111.69, spot: 0.0560, savingsPlan1yr: 0.091, savingsPlan3yr: 0.059, reserved1yr: 0.095, reserved3yr: 0.062 },
  { provider: "AWS", instanceType: "r6a.large", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.1134, onDemandMonthly: 82.78, spot: 0.0410, savingsPlan1yr: 0.068, savingsPlan3yr: 0.044, reserved1yr: 0.071, reserved3yr: 0.046 },
  // ── AWS — Graviton ARM ──
  { provider: "AWS", instanceType: "t4g.nano", os: "Linux", vCPUs: 2, memory: 0.5, onDemandHourly: 0.0042, onDemandMonthly: 3.07, spot: 0.0013, savingsPlan1yr: 0.003, savingsPlan3yr: 0.0021, reserved1yr: 0.0026, reserved3yr: 0.0018 },
  { provider: "AWS", instanceType: "t4g.micro", os: "Linux", vCPUs: 2, memory: 1, onDemandHourly: 0.0084, onDemandMonthly: 6.13, spot: 0.0025, savingsPlan1yr: 0.006, savingsPlan3yr: 0.0042, reserved1yr: 0.0053, reserved3yr: 0.0036 },
  { provider: "AWS", instanceType: "t4g.small", os: "Linux", vCPUs: 2, memory: 2, onDemandHourly: 0.0168, onDemandMonthly: 12.26, spot: 0.0050, savingsPlan1yr: 0.012, savingsPlan3yr: 0.0084, reserved1yr: 0.0105, reserved3yr: 0.0072 },
  { provider: "AWS", instanceType: "t4g.medium", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.0336, onDemandMonthly: 24.53, spot: 0.0101, savingsPlan1yr: 0.024, savingsPlan3yr: 0.0168, reserved1yr: 0.0210, reserved3yr: 0.0145 },
  { provider: "AWS", instanceType: "t4g.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0672, onDemandMonthly: 49.06, spot: 0.0202, savingsPlan1yr: 0.048, savingsPlan3yr: 0.0336, reserved1yr: 0.0420, reserved3yr: 0.0289 },
  { provider: "AWS", instanceType: "m6g.medium", os: "Linux", vCPUs: 1, memory: 4, onDemandHourly: 0.0385, onDemandMonthly: 28.11, spot: 0.0140, savingsPlan1yr: 0.023, savingsPlan3yr: 0.015, reserved1yr: 0.024, reserved3yr: 0.016 },
  { provider: "AWS", instanceType: "m6g.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.077, onDemandMonthly: 56.21, spot: 0.0280, savingsPlan1yr: 0.046, savingsPlan3yr: 0.030, reserved1yr: 0.048, reserved3yr: 0.031 },
  { provider: "AWS", instanceType: "m6g.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.154, onDemandMonthly: 112.42, spot: 0.0560, savingsPlan1yr: 0.092, savingsPlan3yr: 0.060, reserved1yr: 0.096, reserved3yr: 0.063 },
  { provider: "AWS", instanceType: "m7g.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0816, onDemandMonthly: 59.57, spot: 0.0340, savingsPlan1yr: 0.054, savingsPlan3yr: 0.037, reserved1yr: 0.051, reserved3yr: 0.033 },
  { provider: "AWS", instanceType: "m7g.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.1632, onDemandMonthly: 119.14, spot: 0.0680, savingsPlan1yr: 0.108, savingsPlan3yr: 0.074, reserved1yr: 0.102, reserved3yr: 0.066 },
  { provider: "AWS", instanceType: "c6g.medium", os: "Linux", vCPUs: 1, memory: 2, onDemandHourly: 0.034, onDemandMonthly: 24.82, spot: 0.0120, savingsPlan1yr: 0.021, savingsPlan3yr: 0.013, reserved1yr: 0.021, reserved3yr: 0.014 },
  { provider: "AWS", instanceType: "c6g.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.068, onDemandMonthly: 49.64, spot: 0.0245, savingsPlan1yr: 0.041, savingsPlan3yr: 0.026, reserved1yr: 0.042, reserved3yr: 0.028 },
  { provider: "AWS", instanceType: "c6g.xlarge", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.136, onDemandMonthly: 99.28, spot: 0.0490, savingsPlan1yr: 0.081, savingsPlan3yr: 0.053, reserved1yr: 0.085, reserved3yr: 0.055 },
  { provider: "AWS", instanceType: "c7g.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.0725, onDemandMonthly: 52.93, spot: 0.0275, savingsPlan1yr: 0.048, savingsPlan3yr: 0.032, reserved1yr: 0.045, reserved3yr: 0.030 },
  { provider: "AWS", instanceType: "c7g.xlarge", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.145, onDemandMonthly: 105.85, spot: 0.0550, savingsPlan1yr: 0.096, savingsPlan3yr: 0.064, reserved1yr: 0.091, reserved3yr: 0.059 },
  { provider: "AWS", instanceType: "r6g.large", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.1008, onDemandMonthly: 73.58, spot: 0.0365, savingsPlan1yr: 0.060, savingsPlan3yr: 0.039, reserved1yr: 0.063, reserved3yr: 0.041 },
  { provider: "AWS", instanceType: "r6g.xlarge", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.2016, onDemandMonthly: 147.17, spot: 0.0730, savingsPlan1yr: 0.120, savingsPlan3yr: 0.078, reserved1yr: 0.126, reserved3yr: 0.082 },
  { provider: "AWS", instanceType: "r7g.large", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.1067, onDemandMonthly: 77.89, spot: 0.0400, savingsPlan1yr: 0.067, savingsPlan3yr: 0.043, reserved1yr: 0.067, reserved3yr: 0.043 },
  { provider: "AWS", instanceType: "r7g.xlarge", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.2134, onDemandMonthly: 155.78, spot: 0.0800, savingsPlan1yr: 0.134, savingsPlan3yr: 0.087, reserved1yr: 0.134, reserved3yr: 0.087 },
  // ── AWS — GPU ──
  { provider: "AWS", instanceType: "p3.2xlarge", os: "Linux", vCPUs: 8, memory: 61, onDemandHourly: 3.06, onDemandMonthly: 2233.80, spot: 0.918, savingsPlan1yr: 1.836, savingsPlan3yr: 1.193, reserved1yr: 1.928, reserved3yr: 1.252 },
  { provider: "AWS", instanceType: "g5.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 1.006, onDemandMonthly: 734.38, spot: 0.3520, savingsPlan1yr: 0.634, savingsPlan3yr: 0.416, reserved1yr: 0.658, reserved3yr: 0.430 },

  // ── Azure — Intel ──
  { provider: "Azure", instanceType: "B1s", os: "Linux", vCPUs: 1, memory: 1, onDemandHourly: 0.0104, onDemandMonthly: 7.59, spot: 0.0025, savingsPlan1yr: 0.008, savingsPlan3yr: 0.006, reserved1yr: 0.007, reserved3yr: 0.005 },
  { provider: "Azure", instanceType: "B2s", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.0416, onDemandMonthly: 30.37, spot: 0.010, savingsPlan1yr: 0.032, savingsPlan3yr: 0.024, reserved1yr: 0.028, reserved3yr: 0.020 },
  { provider: "Azure", instanceType: "D2s_v5", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.096, onDemandMonthly: 70.08, spot: 0.019, savingsPlan1yr: 0.060, savingsPlan3yr: 0.038, reserved1yr: 0.057, reserved3yr: 0.036 },
  { provider: "Azure", instanceType: "D4s_v5", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.192, onDemandMonthly: 140.16, spot: 0.038, savingsPlan1yr: 0.120, savingsPlan3yr: 0.076, reserved1yr: 0.115, reserved3yr: 0.072 },
  { provider: "Azure", instanceType: "D8s_v5", os: "Linux", vCPUs: 8, memory: 32, onDemandHourly: 0.384, onDemandMonthly: 280.32, spot: 0.077, savingsPlan1yr: 0.240, savingsPlan3yr: 0.152, reserved1yr: 0.230, reserved3yr: 0.144 },
  { provider: "Azure", instanceType: "F2s_v2", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.085, onDemandMonthly: 62.05, spot: 0.017, savingsPlan1yr: 0.053, savingsPlan3yr: 0.034, reserved1yr: 0.050, reserved3yr: 0.032 },
  { provider: "Azure", instanceType: "F4s_v2", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.169, onDemandMonthly: 123.37, spot: 0.034, savingsPlan1yr: 0.106, savingsPlan3yr: 0.067, reserved1yr: 0.101, reserved3yr: 0.064 },
  { provider: "Azure", instanceType: "E2s_v5", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.126, onDemandMonthly: 91.98, spot: 0.025, savingsPlan1yr: 0.079, savingsPlan3yr: 0.050, reserved1yr: 0.075, reserved3yr: 0.047 },
  { provider: "Azure", instanceType: "E4s_v5", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.252, onDemandMonthly: 183.96, spot: 0.050, savingsPlan1yr: 0.158, savingsPlan3yr: 0.100, reserved1yr: 0.150, reserved3yr: 0.094 },
  // ── Azure — AMD ──
  { provider: "Azure", instanceType: "D2as_v5", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0864, onDemandMonthly: 63.07, spot: 0.0170, savingsPlan1yr: 0.054, savingsPlan3yr: 0.034, reserved1yr: 0.051, reserved3yr: 0.032 },
  { provider: "Azure", instanceType: "D4as_v5", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.1728, onDemandMonthly: 126.14, spot: 0.0350, savingsPlan1yr: 0.108, savingsPlan3yr: 0.068, reserved1yr: 0.103, reserved3yr: 0.065 },
  { provider: "Azure", instanceType: "E2as_v5", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.1130, onDemandMonthly: 82.49, spot: 0.0230, savingsPlan1yr: 0.071, savingsPlan3yr: 0.045, reserved1yr: 0.067, reserved3yr: 0.042 },
  // ── Azure — Ampere ARM ──
  { provider: "Azure", instanceType: "D2ps_v5", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.077, onDemandMonthly: 56.21, spot: 0.0142, savingsPlan1yr: 0.048, savingsPlan3yr: 0.030, reserved1yr: 0.046, reserved3yr: 0.029 },
  { provider: "Azure", instanceType: "D4ps_v5", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.154, onDemandMonthly: 112.42, spot: 0.0285, savingsPlan1yr: 0.096, savingsPlan3yr: 0.061, reserved1yr: 0.092, reserved3yr: 0.058 },
  { provider: "Azure", instanceType: "D8ps_v5", os: "Linux", vCPUs: 8, memory: 32, onDemandHourly: 0.308, onDemandMonthly: 224.84, spot: 0.0570, savingsPlan1yr: 0.193, savingsPlan3yr: 0.122, reserved1yr: 0.184, reserved3yr: 0.116 },
  { provider: "Azure", instanceType: "E2ps_v5", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.101, onDemandMonthly: 73.73, spot: 0.0190, savingsPlan1yr: 0.063, savingsPlan3yr: 0.040, reserved1yr: 0.060, reserved3yr: 0.038 },
  { provider: "Azure", instanceType: "E4ps_v5", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.202, onDemandMonthly: 147.46, spot: 0.0375, savingsPlan1yr: 0.126, savingsPlan3yr: 0.080, reserved1yr: 0.120, reserved3yr: 0.076 },
  // ── Azure — GPU ──
  { provider: "Azure", instanceType: "NC6s_v3", os: "Linux", vCPUs: 6, memory: 112, onDemandHourly: 3.06, onDemandMonthly: 2233.80, spot: 0.918, savingsPlan1yr: 1.836, savingsPlan3yr: 1.193, reserved1yr: 1.836, reserved3yr: 1.163 },

  // ── GCP — Intel ──
  { provider: "GCP", instanceType: "e2-micro", os: "Linux", vCPUs: 2, memory: 1, onDemandHourly: 0.0084, onDemandMonthly: 6.11, spot: 0.0025, savingsPlan1yr: 0.0053, savingsPlan3yr: 0.0038, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "e2-small", os: "Linux", vCPUs: 2, memory: 2, onDemandHourly: 0.0168, onDemandMonthly: 12.23, spot: 0.005, savingsPlan1yr: 0.0105, savingsPlan3yr: 0.0076, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "e2-medium", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.0335, onDemandMonthly: 24.46, spot: 0.010, savingsPlan1yr: 0.021, savingsPlan3yr: 0.015, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "n2-standard-2", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0971, onDemandMonthly: 70.88, spot: 0.0233, savingsPlan1yr: 0.061, savingsPlan3yr: 0.044, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "n2-standard-4", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.1942, onDemandMonthly: 141.77, spot: 0.0466, savingsPlan1yr: 0.122, savingsPlan3yr: 0.087, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "n2-standard-8", os: "Linux", vCPUs: 8, memory: 32, onDemandHourly: 0.3884, onDemandMonthly: 283.53, spot: 0.0932, savingsPlan1yr: 0.244, savingsPlan3yr: 0.175, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "c2-standard-4", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.2088, onDemandMonthly: 152.42, spot: 0.063, savingsPlan1yr: 0.131, savingsPlan3yr: 0.094, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "c2-standard-8", os: "Linux", vCPUs: 8, memory: 32, onDemandHourly: 0.4176, onDemandMonthly: 304.85, spot: 0.125, savingsPlan1yr: 0.262, savingsPlan3yr: 0.188, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "n2-highmem-2", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.1309, onDemandMonthly: 95.56, spot: 0.0314, savingsPlan1yr: 0.082, savingsPlan3yr: 0.059, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "n2-highmem-4", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.2618, onDemandMonthly: 191.11, spot: 0.0628, savingsPlan1yr: 0.164, savingsPlan3yr: 0.118, reserved1yr: null, reserved3yr: null },
  // ── GCP — AMD ──
  { provider: "GCP", instanceType: "n2d-standard-2", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0845, onDemandMonthly: 61.69, spot: 0.0203, savingsPlan1yr: 0.053, savingsPlan3yr: 0.038, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "n2d-standard-4", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.1690, onDemandMonthly: 123.37, spot: 0.0406, savingsPlan1yr: 0.106, savingsPlan3yr: 0.076, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "n2d-highmem-2", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.1140, onDemandMonthly: 83.22, spot: 0.0274, savingsPlan1yr: 0.072, savingsPlan3yr: 0.051, reserved1yr: null, reserved3yr: null },
  // ── GCP — ARM (Tau T2A & Axion C4A) ──
  { provider: "GCP", instanceType: "t2a-standard-1", os: "Linux", vCPUs: 1, memory: 4, onDemandHourly: 0.0385, onDemandMonthly: 28.11, spot: 0.0116, savingsPlan1yr: 0.024, savingsPlan3yr: 0.017, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "t2a-standard-2", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0770, onDemandMonthly: 56.21, spot: 0.0231, savingsPlan1yr: 0.048, savingsPlan3yr: 0.035, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "t2a-standard-4", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.1540, onDemandMonthly: 112.42, spot: 0.0462, savingsPlan1yr: 0.097, savingsPlan3yr: 0.069, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "t2a-standard-8", os: "Linux", vCPUs: 8, memory: 32, onDemandHourly: 0.3080, onDemandMonthly: 224.84, spot: 0.0924, savingsPlan1yr: 0.194, savingsPlan3yr: 0.139, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "c4a-standard-1", os: "Linux", vCPUs: 1, memory: 4, onDemandHourly: 0.0449, onDemandMonthly: 32.78, spot: 0.0135, savingsPlan1yr: 0.028, savingsPlan3yr: 0.020, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "c4a-standard-2", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.0898, onDemandMonthly: 65.55, spot: 0.0269, savingsPlan1yr: 0.056, savingsPlan3yr: 0.040, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "c4a-standard-4", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.1796, onDemandMonthly: 131.11, spot: 0.0539, savingsPlan1yr: 0.113, savingsPlan3yr: 0.081, reserved1yr: null, reserved3yr: null },
  { provider: "GCP", instanceType: "c4a-standard-8", os: "Linux", vCPUs: 8, memory: 32, onDemandHourly: 0.3592, onDemandMonthly: 262.22, spot: 0.1078, savingsPlan1yr: 0.226, savingsPlan3yr: 0.161, reserved1yr: null, reserved3yr: null },
  // ── GCP — GPU ──
  { provider: "GCP", instanceType: "a2-highgpu-1g", os: "Linux", vCPUs: 12, memory: 85, onDemandHourly: 3.67, onDemandMonthly: 2679.10, spot: 1.101, savingsPlan1yr: 2.31, savingsPlan3yr: 1.651, reserved1yr: null, reserved3yr: null },

  // ── DigitalOcean — Basic (Burstable) ──
  { provider: "DigitalOcean", instanceType: "s-1vcpu-512mb-10gb", os: "Linux", vCPUs: 1, memory: 0.5, onDemandHourly: 0.006, onDemandMonthly: 4.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "s-1vcpu-1gb", os: "Linux", vCPUs: 1, memory: 1, onDemandHourly: 0.009, onDemandMonthly: 6.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "s-2vcpu-2gb", os: "Linux", vCPUs: 2, memory: 2, onDemandHourly: 0.027, onDemandMonthly: 18.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "s-2vcpu-4gb", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.036, onDemandMonthly: 24.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "s-4vcpu-8gb", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.071, onDemandMonthly: 48.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "s-8vcpu-16gb", os: "Linux", vCPUs: 8, memory: 16, onDemandHourly: 0.143, onDemandMonthly: 96.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  // ── DigitalOcean — General Purpose ──
  { provider: "DigitalOcean", instanceType: "g-2vcpu-8gb", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.094, onDemandMonthly: 63.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "g-4vcpu-16gb", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.188, onDemandMonthly: 126.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "gd-2vcpu-8gb", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.100, onDemandMonthly: 67.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  // ── DigitalOcean — CPU-Optimized ──
  { provider: "DigitalOcean", instanceType: "c-2", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.063, onDemandMonthly: 42.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "c-4", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.125, onDemandMonthly: 84.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  // ── DigitalOcean — Memory-Optimized ──
  { provider: "DigitalOcean", instanceType: "m-2vcpu-16gb", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.125, onDemandMonthly: 84.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "DigitalOcean", instanceType: "so1_5-2vcpu-16gb", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.125, onDemandMonthly: 84.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },

  // ── OCI — AMD (E4 Flex) ──
  { provider: "OCI", instanceType: "VM.Standard.E4.Flex.1", os: "Linux", vCPUs: 1, memory: 16, onDemandHourly: 0.015, onDemandMonthly: 10.95, spot: 0.0025, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Standard.E4.Flex.2", os: "Linux", vCPUs: 2, memory: 32, onDemandHourly: 0.030, onDemandMonthly: 21.90, spot: 0.005, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Standard.E4.Flex.4", os: "Linux", vCPUs: 4, memory: 64, onDemandHourly: 0.060, onDemandMonthly: 43.80, spot: 0.010, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Standard.E4.Flex.8", os: "Linux", vCPUs: 8, memory: 128, onDemandHourly: 0.120, onDemandMonthly: 87.60, spot: 0.020, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  // ── OCI — Intel (Standard3 Flex) ──
  { provider: "OCI", instanceType: "VM.Standard3.Flex.2", os: "Linux", vCPUs: 2, memory: 32, onDemandHourly: 0.054, onDemandMonthly: 39.42, spot: 0.009, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Standard3.Flex.4", os: "Linux", vCPUs: 4, memory: 64, onDemandHourly: 0.108, onDemandMonthly: 78.84, spot: 0.018, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Optimized3.Flex.2", os: "Linux", vCPUs: 2, memory: 32, onDemandHourly: 0.072, onDemandMonthly: 52.56, spot: 0.012, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  // ── OCI — Ampere ARM (A1 Flex) — $0.01/OCPU-hr + $0.0015/GB-hr ──
  { provider: "OCI", instanceType: "VM.Standard.A1.Flex.1", os: "Linux", vCPUs: 1, memory: 6, onDemandHourly: 0.019, onDemandMonthly: 13.87, spot: 0.0032, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Standard.A1.Flex.2", os: "Linux", vCPUs: 2, memory: 12, onDemandHourly: 0.038, onDemandMonthly: 27.74, spot: 0.0063, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Standard.A1.Flex.4", os: "Linux", vCPUs: 4, memory: 24, onDemandHourly: 0.076, onDemandMonthly: 55.48, spot: 0.0127, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OCI", instanceType: "VM.Standard.A1.Flex.8", os: "Linux", vCPUs: 8, memory: 48, onDemandHourly: 0.152, onDemandMonthly: 110.96, spot: 0.0253, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  // ── OCI — GPU ──
  { provider: "OCI", instanceType: "VM.GPU.A10.1", os: "Linux", vCPUs: 15, memory: 240, onDemandHourly: 2.95, onDemandMonthly: 2153.50, spot: 0.885, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },

  // OVH
  { provider: "OVH", instanceType: "d2-2", os: "Linux", vCPUs: 1, memory: 2, onDemandHourly: 0.0070, onDemandMonthly: 5.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OVH", instanceType: "d2-4", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.0140, onDemandMonthly: 10.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OVH", instanceType: "d2-8", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.0276, onDemandMonthly: 20.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OVH", instanceType: "b2-7", os: "Linux", vCPUs: 2, memory: 7, onDemandHourly: 0.0300, onDemandMonthly: 21.50, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OVH", instanceType: "b2-15", os: "Linux", vCPUs: 4, memory: 15, onDemandHourly: 0.0590, onDemandMonthly: 43.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OVH", instanceType: "b2-30", os: "Linux", vCPUs: 8, memory: 30, onDemandHourly: 0.1180, onDemandMonthly: 86.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OVH", instanceType: "c2-7", os: "Linux", vCPUs: 2, memory: 7, onDemandHourly: 0.0400, onDemandMonthly: 29.00, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },
  { provider: "OVH", instanceType: "c2-15", os: "Linux", vCPUs: 4, memory: 15, onDemandHourly: 0.0790, onDemandMonthly: 57.50, spot: null, savingsPlan1yr: null, savingsPlan3yr: null, reserved1yr: null, reserved3yr: null },

  // ── Alibaba Cloud — Intel (ECS) ──
  { provider: "Alibaba", instanceType: "ecs.t6-c1m1.large", os: "Linux", vCPUs: 2, memory: 2, onDemandHourly: 0.0208, onDemandMonthly: 15.18, spot: 0.0062, savingsPlan1yr: 0.015, savingsPlan3yr: 0.010, reserved1yr: 0.013, reserved3yr: 0.009 },
  { provider: "Alibaba", instanceType: "ecs.g7.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.098, onDemandMonthly: 71.54, spot: 0.029, savingsPlan1yr: 0.059, savingsPlan3yr: 0.038, reserved1yr: 0.061, reserved3yr: 0.040 },
  { provider: "Alibaba", instanceType: "ecs.g7.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.196, onDemandMonthly: 143.08, spot: 0.059, savingsPlan1yr: 0.118, savingsPlan3yr: 0.076, reserved1yr: 0.122, reserved3yr: 0.079 },
  { provider: "Alibaba", instanceType: "ecs.c7.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.076, onDemandMonthly: 55.48, spot: 0.023, savingsPlan1yr: 0.046, savingsPlan3yr: 0.030, reserved1yr: 0.047, reserved3yr: 0.031 },
  { provider: "Alibaba", instanceType: "ecs.c7.xlarge", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.152, onDemandMonthly: 110.96, spot: 0.046, savingsPlan1yr: 0.091, savingsPlan3yr: 0.059, reserved1yr: 0.095, reserved3yr: 0.062 },
  { provider: "Alibaba", instanceType: "ecs.r7.large", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.120, onDemandMonthly: 87.60, spot: 0.036, savingsPlan1yr: 0.072, savingsPlan3yr: 0.047, reserved1yr: 0.075, reserved3yr: 0.049 },
  { provider: "Alibaba", instanceType: "ecs.r7.xlarge", os: "Linux", vCPUs: 4, memory: 32, onDemandHourly: 0.240, onDemandMonthly: 175.20, spot: 0.072, savingsPlan1yr: 0.144, savingsPlan3yr: 0.094, reserved1yr: 0.150, reserved3yr: 0.098 },
  // ── Alibaba Cloud — ARM (Yitian g8y/c8y/r8y) ──
  { provider: "Alibaba", instanceType: "ecs.g8y.large", os: "Linux", vCPUs: 2, memory: 8, onDemandHourly: 0.078, onDemandMonthly: 56.94, spot: 0.023, savingsPlan1yr: 0.047, savingsPlan3yr: 0.030, reserved1yr: 0.049, reserved3yr: 0.032 },
  { provider: "Alibaba", instanceType: "ecs.g8y.xlarge", os: "Linux", vCPUs: 4, memory: 16, onDemandHourly: 0.156, onDemandMonthly: 113.88, spot: 0.047, savingsPlan1yr: 0.094, savingsPlan3yr: 0.061, reserved1yr: 0.097, reserved3yr: 0.063 },
  { provider: "Alibaba", instanceType: "ecs.c8y.large", os: "Linux", vCPUs: 2, memory: 4, onDemandHourly: 0.061, onDemandMonthly: 44.53, spot: 0.018, savingsPlan1yr: 0.037, savingsPlan3yr: 0.024, reserved1yr: 0.038, reserved3yr: 0.025 },
  { provider: "Alibaba", instanceType: "ecs.c8y.xlarge", os: "Linux", vCPUs: 4, memory: 8, onDemandHourly: 0.122, onDemandMonthly: 89.06, spot: 0.037, savingsPlan1yr: 0.073, savingsPlan3yr: 0.047, reserved1yr: 0.076, reserved3yr: 0.050 },
  { provider: "Alibaba", instanceType: "ecs.r8y.large", os: "Linux", vCPUs: 2, memory: 16, onDemandHourly: 0.096, onDemandMonthly: 70.08, spot: 0.029, savingsPlan1yr: 0.058, savingsPlan3yr: 0.037, reserved1yr: 0.060, reserved3yr: 0.039 },
  // ── Alibaba Cloud — GPU ──
  { provider: "Alibaba", instanceType: "ecs.gn7-c12g1.3xlarge", os: "Linux", vCPUs: 12, memory: 94, onDemandHourly: 3.20, onDemandMonthly: 2336.00, spot: 0.960, savingsPlan1yr: 1.920, savingsPlan3yr: 1.248, reserved1yr: 2.016, reserved3yr: 1.310 },
];

export const llmModels: LLMModel[] = [
  // ── OpenAI ──  (ELO: Chatbot Arena, Feb 2025)
  { provider: "OpenAI", model: "GPT-4o", parameters: "~200B", inputPricePer1M: 2.50, outputPricePer1M: 10.00, contextWindow: "128K", category: "Frontier", capabilities: ["Text", "Vision", "Code", "Agents", "Audio"], releaseDate: "2024-05", eloScore: 1285, license: "Proprietary" },
  { provider: "OpenAI", model: "GPT-4o mini", parameters: "~8B", inputPricePer1M: 0.15, outputPricePer1M: 0.60, contextWindow: "128K", category: "Budget", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2024-07", eloScore: 1219, license: "Proprietary" },
  { provider: "OpenAI", model: "GPT-4 Turbo", parameters: "~1.8T", inputPricePer1M: 10.00, outputPricePer1M: 30.00, contextWindow: "128K", category: "Frontier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2024-04", eloScore: 1257, license: "Proprietary" },
  { provider: "OpenAI", model: "o1", parameters: "~200B", inputPricePer1M: 15.00, outputPricePer1M: 60.00, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2024-12", eloScore: 1350, license: "Proprietary" },
  { provider: "OpenAI", model: "o1-mini", parameters: "~100B", inputPricePer1M: 3.00, outputPricePer1M: 12.00, contextWindow: "128K", category: "Mid-tier", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2024-09", eloScore: 1304, license: "Proprietary" },
  { provider: "OpenAI", model: "o3-mini", parameters: "~100B", inputPricePer1M: 1.10, outputPricePer1M: 4.40, contextWindow: "200K", category: "Mid-tier", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2025-01", eloScore: 1337, license: "Proprietary" },
  { provider: "OpenAI", model: "GPT-5", parameters: "Undisclosed", inputPricePer1M: 10.00, outputPricePer1M: 30.00, contextWindow: "256K", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code", "Agents", "Audio"], releaseDate: "2025-04", eloScore: 1370, license: "Proprietary" },
  { provider: "OpenAI", model: "o3", parameters: "Undisclosed", inputPricePer1M: 2.00, outputPricePer1M: 8.00, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code"], releaseDate: "2025-04", eloScore: 1350, license: "Proprietary" },
  { provider: "OpenAI", model: "o4-mini", parameters: "Undisclosed", inputPricePer1M: 1.10, outputPricePer1M: 4.40, contextWindow: "200K", category: "Mid-tier", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2025-04", eloScore: 1340, license: "Proprietary" },
  { provider: "OpenAI", model: "GPT-4.1", parameters: "Undisclosed", inputPricePer1M: 2.00, outputPricePer1M: 8.00, contextWindow: "1M", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2025-04", eloScore: 1305, license: "Proprietary" },
  { provider: "OpenAI", model: "GPT-4.1 mini", parameters: "Undisclosed", inputPricePer1M: 0.40, outputPricePer1M: 1.60, contextWindow: "1M", category: "Budget", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2025-04", eloScore: 1260, license: "Proprietary" },
  { provider: "OpenAI", model: "DALL·E 3", parameters: "~12B", inputPricePer1M: 40.00, outputPricePer1M: 0, contextWindow: "-", category: "Image", capabilities: ["Image Gen"], releaseDate: "2023-10", license: "Proprietary" },

  // ── Anthropic ──
  { provider: "Anthropic", model: "Claude 4.6 Opus", parameters: "Undisclosed", inputPricePer1M: 5.00, outputPricePer1M: 25.00, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code", "Agents"], releaseDate: "2026-02", eloScore: 1395, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 4.6 Sonnet", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "200K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2026-02", eloScore: 1380, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 4.5 Opus", parameters: "Undisclosed", inputPricePer1M: 5.00, outputPricePer1M: 25.00, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code", "Agents"], releaseDate: "2025-09", eloScore: 1375, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 4.5 Sonnet", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "200K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2025-09", eloScore: 1370, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 4.5 Haiku", parameters: "Undisclosed", inputPricePer1M: 1.00, outputPricePer1M: 5.00, contextWindow: "200K", category: "Budget", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2025-10", eloScore: 1245, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 4 Opus", parameters: "Undisclosed", inputPricePer1M: 15.00, outputPricePer1M: 75.00, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code", "Agents"], releaseDate: "2025-05", eloScore: 1381, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 4 Sonnet", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "200K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2025-05", eloScore: 1363, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 3.7 Sonnet", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "200K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2025-02", eloScore: 1363, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 3.5 Sonnet", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "200K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2024-10", eloScore: 1290, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 3.5 Haiku", parameters: "Undisclosed", inputPricePer1M: 0.80, outputPricePer1M: 4.00, contextWindow: "200K", category: "Budget", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2024-10", eloScore: 1231, license: "Proprietary" },
  { provider: "Anthropic", model: "Claude 3 Haiku", parameters: "Undisclosed", inputPricePer1M: 0.25, outputPricePer1M: 1.25, contextWindow: "200K", category: "Budget", capabilities: ["Text", "Vision", "Code"], releaseDate: "2024-03", eloScore: 1178, license: "Proprietary" },

  // ── Google ──
  { provider: "Google", model: "Gemini 3 Pro", parameters: "Undisclosed", inputPricePer1M: 2.00, outputPricePer1M: 12.00, contextWindow: "1M", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code", "Agents", "Audio"], releaseDate: "2025-11", eloScore: 1430, license: "Proprietary" },
  { provider: "Google", model: "Gemini 3 Flash", parameters: "Undisclosed", inputPricePer1M: 0.50, outputPricePer1M: 3.00, contextWindow: "1M", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents", "Audio"], releaseDate: "2025-12", eloScore: 1385, license: "Proprietary" },
  { provider: "Google", model: "Gemini 2.5 Pro", parameters: "Undisclosed", inputPricePer1M: 1.25, outputPricePer1M: 10.00, contextWindow: "1M", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code", "Agents", "Audio"], releaseDate: "2025-03", eloScore: 1392, license: "Proprietary" },
  { provider: "Google", model: "Gemini 2.5 Flash", parameters: "Undisclosed", inputPricePer1M: 0.15, outputPricePer1M: 0.60, contextWindow: "1M", category: "Budget", capabilities: ["Text", "Vision", "Code", "Agents", "Audio"], releaseDate: "2025-04", eloScore: 1340, license: "Proprietary" },
  { provider: "Google", model: "Gemini 2.0 Flash", parameters: "Undisclosed", inputPricePer1M: 0.10, outputPricePer1M: 0.40, contextWindow: "1M", category: "Budget", capabilities: ["Text", "Vision", "Code", "Agents", "Audio"], releaseDate: "2025-02", eloScore: 1298, license: "Proprietary" },
  { provider: "Google", model: "Gemini 1.5 Pro", parameters: "Undisclosed", inputPricePer1M: 1.25, outputPricePer1M: 5.00, contextWindow: "2M", category: "Frontier", capabilities: ["Text", "Vision", "Code", "Audio"], releaseDate: "2024-05", eloScore: 1260, license: "Proprietary" },
  { provider: "Google", model: "Gemma 2 27B", parameters: "27B", inputPricePer1M: 0.27, outputPricePer1M: 0.27, contextWindow: "8K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-06", eloScore: 1187, license: "Gemma" },
  { provider: "Google", model: "Gemma 2 9B", parameters: "9B", inputPricePer1M: 0.08, outputPricePer1M: 0.08, contextWindow: "8K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-06", eloScore: 1146, license: "Gemma" },

  // ── Meta ──
  { provider: "Meta", model: "Llama 4 Maverick", parameters: "400B", inputPricePer1M: 0.50, outputPricePer1M: 0.77, contextWindow: "1M", category: "Open Weights", capabilities: ["Text", "Vision", "Code"], releaseDate: "2025-04", eloScore: 1325, license: "Llama 3.x" },
  { provider: "Meta", model: "Llama 4 Scout", parameters: "109B", inputPricePer1M: 0.18, outputPricePer1M: 0.35, contextWindow: "10M", category: "Open Weights", capabilities: ["Text", "Vision", "Code"], releaseDate: "2025-04", eloScore: 1287, license: "Llama 3.x" },
  { provider: "Meta", model: "Llama 3.3 70B", parameters: "70B", inputPricePer1M: 0.59, outputPricePer1M: 0.79, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-12", eloScore: 1247, license: "Llama 3.x" },
  { provider: "Meta", model: "Llama 3.1 405B", parameters: "405B", inputPricePer1M: 3.00, outputPricePer1M: 3.00, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-07", eloScore: 1266, license: "Llama 3.x" },
  { provider: "Meta", model: "Llama 3.1 70B", parameters: "70B", inputPricePer1M: 0.59, outputPricePer1M: 0.79, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-07", eloScore: 1227, license: "Llama 3.x" },
  { provider: "Meta", model: "Llama 3.1 8B", parameters: "8B", inputPricePer1M: 0.05, outputPricePer1M: 0.08, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-07", eloScore: 1152, license: "Llama 3.x" },

  // ── Mistral ──
  { provider: "Mistral", model: "Mistral Large", parameters: "123B", inputPricePer1M: 2.00, outputPricePer1M: 6.00, contextWindow: "128K", category: "Frontier", capabilities: ["Text", "Code", "Agents"], releaseDate: "2024-11", eloScore: 1250, license: "Mistral" },
  { provider: "Mistral", model: "Mistral Medium", parameters: "~70B", inputPricePer1M: 0.40, outputPricePer1M: 1.20, contextWindow: "128K", category: "Mid-tier", capabilities: ["Text", "Code"], releaseDate: "2024-04", license: "Mistral" },
  { provider: "Mistral", model: "Mistral Small", parameters: "22B", inputPricePer1M: 0.10, outputPricePer1M: 0.30, contextWindow: "128K", category: "Budget", capabilities: ["Text", "Code"], releaseDate: "2024-09", eloScore: 1204, license: "Mistral" },
  { provider: "Mistral", model: "Mistral Nemo", parameters: "12B", inputPricePer1M: 0.13, outputPricePer1M: 0.13, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-07", eloScore: 1177, license: "Apache 2.0" },
  { provider: "Mistral", model: "Codestral", parameters: "22B", inputPricePer1M: 0.30, outputPricePer1M: 0.90, contextWindow: "256K", category: "Mid-tier", capabilities: ["Code"], releaseDate: "2024-05", license: "Apache 2.0" },
  { provider: "Mistral", model: "Mixtral 8x22B", parameters: "141B", inputPricePer1M: 0.90, outputPricePer1M: 0.90, contextWindow: "64K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-04", eloScore: 1199, license: "Apache 2.0" },
  { provider: "Mistral", model: "Mixtral 8x7B", parameters: "47B", inputPricePer1M: 0.24, outputPricePer1M: 0.24, contextWindow: "32K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2023-12", eloScore: 1148, license: "Apache 2.0" },

  // ── DeepSeek ──
  { provider: "DeepSeek", model: "DeepSeek V3.2", parameters: "685B", inputPricePer1M: 0.37, outputPricePer1M: 0.56, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2025-10", eloScore: 1370, license: "Apache 2.0" },
  { provider: "DeepSeek", model: "DeepSeek V3", parameters: "671B", inputPricePer1M: 0.27, outputPricePer1M: 1.10, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-12", eloScore: 1318, license: "Apache 2.0" },
  { provider: "DeepSeek", model: "DeepSeek R1", parameters: "671B", inputPricePer1M: 0.55, outputPricePer1M: 2.19, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2025-01", eloScore: 1358, license: "Apache 2.0" },
  { provider: "DeepSeek", model: "DeepSeek R1 Distill 70B", parameters: "70B", inputPricePer1M: 0.55, outputPricePer1M: 0.77, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2025-01", eloScore: 1269, license: "Apache 2.0" },
  { provider: "DeepSeek", model: "DeepSeek R1 Distill 8B", parameters: "8B", inputPricePer1M: 0.05, outputPricePer1M: 0.08, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2025-01", license: "Apache 2.0" },
  { provider: "DeepSeek", model: "DeepSeek Coder V2", parameters: "236B", inputPricePer1M: 0.14, outputPricePer1M: 0.28, contextWindow: "128K", category: "Open Weights", capabilities: ["Code"], releaseDate: "2024-06", license: "Apache 2.0" },

  // ── xAI ──
  { provider: "xAI", model: "Grok 4", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "256K", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code", "Agents"], releaseDate: "2025-08", eloScore: 1410, license: "Proprietary" },
  { provider: "xAI", model: "Grok 3", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "131K", category: "Frontier", capabilities: ["Text", "Vision", "Reasoning", "Code"], releaseDate: "2025-02", eloScore: 1346, license: "Proprietary" },
  { provider: "xAI", model: "Grok 3 mini", parameters: "Undisclosed", inputPricePer1M: 0.30, outputPricePer1M: 0.50, contextWindow: "131K", category: "Budget", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2025-02", eloScore: 1316, license: "Proprietary" },
  { provider: "xAI", model: "Grok 2", parameters: "Undisclosed", inputPricePer1M: 2.00, outputPricePer1M: 10.00, contextWindow: "131K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code"], releaseDate: "2024-08", eloScore: 1260, license: "Proprietary" },

  // ── Cohere ──
  { provider: "Cohere", model: "Command R+", parameters: "104B", inputPricePer1M: 2.50, outputPricePer1M: 10.00, contextWindow: "128K", category: "Frontier", capabilities: ["Text", "Code", "Agents"], releaseDate: "2024-04", eloScore: 1187, license: "Proprietary" },
  { provider: "Cohere", model: "Command R", parameters: "35B", inputPricePer1M: 0.15, outputPricePer1M: 0.60, contextWindow: "128K", category: "Mid-tier", capabilities: ["Text", "Code", "Agents"], releaseDate: "2024-03", eloScore: 1147, license: "Proprietary" },
  { provider: "Cohere", model: "Command R7B", parameters: "7B", inputPricePer1M: 0.04, outputPricePer1M: 0.04, contextWindow: "128K", category: "Budget", capabilities: ["Text", "Code"], releaseDate: "2024-10", license: "Proprietary" },

  // ── Amazon ──
  { provider: "Amazon", model: "Nova Pro", parameters: "Undisclosed", inputPricePer1M: 0.80, outputPricePer1M: 3.20, contextWindow: "300K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code"], releaseDate: "2024-12", eloScore: 1214, license: "Proprietary" },
  { provider: "Amazon", model: "Nova Lite", parameters: "Undisclosed", inputPricePer1M: 0.06, outputPricePer1M: 0.24, contextWindow: "300K", category: "Budget", capabilities: ["Text", "Vision"], releaseDate: "2024-12", license: "Proprietary" },
  { provider: "Amazon", model: "Nova Micro", parameters: "Undisclosed", inputPricePer1M: 0.035, outputPricePer1M: 0.14, contextWindow: "128K", category: "Budget", capabilities: ["Text"], releaseDate: "2024-12", license: "Proprietary" },

  // ── Microsoft ──
  { provider: "Microsoft", model: "Phi-4", parameters: "14B", inputPricePer1M: 0.07, outputPricePer1M: 0.14, contextWindow: "16K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2024-12", eloScore: 1220, license: "MIT" },
  { provider: "Microsoft", model: "Phi-3.5 Mini", parameters: "3.8B", inputPricePer1M: 0.013, outputPricePer1M: 0.05, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-08", license: "MIT" },
  { provider: "Microsoft", model: "Phi-3 Medium", parameters: "14B", inputPricePer1M: 0.07, outputPricePer1M: 0.14, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-05", license: "MIT" },

  // ── Alibaba (Qwen) ──
  // Qwen 3.5 series
  { provider: "Alibaba", model: "Qwen 3.5 397B-A17B", parameters: "397B", inputPricePer1M: 0.55, outputPricePer1M: 3.50, contextWindow: "262K", category: "Open Weights", capabilities: ["Text", "Vision", "Code", "Reasoning", "Agents"], releaseDate: "2026-03", eloScore: 1380, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 122B-A10B", parameters: "122B", inputPricePer1M: 0.40, outputPricePer1M: 3.20, contextWindow: "262K", category: "Open Weights", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2026-03", eloScore: 1340, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 35B-A3B", parameters: "35B", inputPricePer1M: 0.25, outputPricePer1M: 1.00, contextWindow: "262K", category: "Open Weights", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2026-03", eloScore: 1300, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 27B", parameters: "27B", inputPricePer1M: 0.30, outputPricePer1M: 2.40, contextWindow: "262K", category: "Open Weights", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2026-03", eloScore: 1310, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 Plus", parameters: "MoE", inputPricePer1M: 0.40, outputPricePer1M: 2.40, contextWindow: "1M", category: "Open Weights", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2026-02", eloScore: 1295, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 Flash", parameters: "MoE", inputPricePer1M: 0.10, outputPricePer1M: 0.40, contextWindow: "1M", category: "Open Weights", capabilities: ["Text", "Vision", "Code"], releaseDate: "2026-02", eloScore: 1285, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen3 Max Thinking", parameters: "685B", inputPricePer1M: 1.20, outputPricePer1M: 6.00, contextWindow: "262K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2026-02", eloScore: 1370, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen3 Coder Next", parameters: "80B", inputPricePer1M: 0.12, outputPricePer1M: 0.75, contextWindow: "262K", category: "Open Weights", capabilities: ["Code", "Agents"], releaseDate: "2026-03", eloScore: 1290, license: "Qwen" },
  // Qwen 3.5 Small series (not yet on OpenRouter)
  { provider: "Alibaba", model: "Qwen 3.5 9B", parameters: "9B", inputPricePer1M: 0.05, outputPricePer1M: 0.15, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Vision", "Code"], releaseDate: "2026-03", license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 4B", parameters: "4B", inputPricePer1M: 0.03, outputPricePer1M: 0.08, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Vision"], releaseDate: "2026-03", license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 2B", parameters: "2B", inputPricePer1M: 0.02, outputPricePer1M: 0.05, contextWindow: "128K", category: "Open Weights", capabilities: ["Text"], releaseDate: "2026-03", license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 3.5 0.8B", parameters: "0.8B", inputPricePer1M: 0.01, outputPricePer1M: 0.03, contextWindow: "128K", category: "Open Weights", capabilities: ["Text"], releaseDate: "2026-03", license: "Qwen" },
  // Qwen 2.5 series
  { provider: "Alibaba", model: "Qwen 2.5 72B", parameters: "72B", inputPricePer1M: 0.59, outputPricePer1M: 0.79, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-09", eloScore: 1261, license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 2.5 32B", parameters: "32B", inputPricePer1M: 0.30, outputPricePer1M: 0.50, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-09", license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 2.5 7B", parameters: "7B", inputPricePer1M: 0.05, outputPricePer1M: 0.08, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-09", license: "Qwen" },
  { provider: "Alibaba", model: "Qwen 2.5 Coder 32B", parameters: "32B", inputPricePer1M: 0.30, outputPricePer1M: 0.50, contextWindow: "128K", category: "Open Weights", capabilities: ["Code"], releaseDate: "2024-11", license: "Qwen" },
  { provider: "Alibaba", model: "QwQ 32B", parameters: "32B", inputPricePer1M: 0.30, outputPricePer1M: 0.50, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code"], releaseDate: "2024-11", eloScore: 1316, license: "Qwen" },

  // ── Nvidia ──
  { provider: "Nvidia", model: "Nemotron 70B", parameters: "70B", inputPricePer1M: 0.59, outputPricePer1M: 0.79, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-10", license: "CC-BY-NC-4.0" },
  { provider: "Nvidia", model: "Llama 3.1 Nemotron Ultra 253B", parameters: "253B", inputPricePer1M: 1.50, outputPricePer1M: 3.00, contextWindow: "128K", category: "Open Weights", capabilities: ["Text", "Reasoning", "Code", "Agents"], releaseDate: "2025-03", license: "CC-BY-NC-4.0" },

  // ── AI21 Labs ──
  { provider: "AI21", model: "Jamba 1.5 Large", parameters: "398B", inputPricePer1M: 2.00, outputPricePer1M: 8.00, contextWindow: "256K", category: "Mid-tier", capabilities: ["Text", "Code"], releaseDate: "2024-08", license: "Proprietary" },
  { provider: "AI21", model: "Jamba 1.5 Mini", parameters: "52B", inputPricePer1M: 0.20, outputPricePer1M: 0.40, contextWindow: "256K", category: "Budget", capabilities: ["Text", "Code"], releaseDate: "2024-08", license: "Proprietary" },

  // ── Perplexity ──
  { provider: "Perplexity", model: "Sonar Pro", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 15.00, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Reasoning", "Agents"], releaseDate: "2025-02", license: "Proprietary" },
  { provider: "Perplexity", model: "Sonar", parameters: "Undisclosed", inputPricePer1M: 1.00, outputPricePer1M: 1.00, contextWindow: "128K", category: "Mid-tier", capabilities: ["Text", "Agents"], releaseDate: "2025-02", license: "Proprietary" },

  // ── Moonshot ──
  { provider: "Moonshot", model: "Kimi K2.5", parameters: "1T", inputPricePer1M: 0.20, outputPricePer1M: 3.00, contextWindow: "128K", category: "Mid-tier", capabilities: ["Text", "Vision", "Code", "Agents"], releaseDate: "2025-10", eloScore: 1345, license: "Proprietary" },
  { provider: "Moonshot", model: "Kimi K2", parameters: "1T", inputPricePer1M: 0.15, outputPricePer1M: 2.50, contextWindow: "128K", category: "Mid-tier", capabilities: ["Text", "Code", "Agents"], releaseDate: "2025-06", eloScore: 1330, license: "Proprietary" },

  // ── Databricks ──
  { provider: "Databricks", model: "DBRX 132B", parameters: "132B", inputPricePer1M: 0.75, outputPricePer1M: 0.75, contextWindow: "32K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-03", license: "Apache 2.0" },

  // ── 01.AI ──
  { provider: "01.AI", model: "Yi-Large", parameters: "Undisclosed", inputPricePer1M: 3.00, outputPricePer1M: 3.00, contextWindow: "32K", category: "Mid-tier", capabilities: ["Text", "Code"], releaseDate: "2024-05", license: "Apache 2.0" },
  { provider: "01.AI", model: "Yi-1.5 34B", parameters: "34B", inputPricePer1M: 0.35, outputPricePer1M: 0.35, contextWindow: "16K", category: "Open Weights", capabilities: ["Text", "Code"], releaseDate: "2024-05", license: "Apache 2.0" },

  // ── Writer ──
  { provider: "Writer", model: "Palmyra X 004", parameters: "Undisclosed", inputPricePer1M: 5.00, outputPricePer1M: 15.00, contextWindow: "128K", category: "Frontier", capabilities: ["Text", "Code", "Agents"], releaseDate: "2024-09", license: "Proprietary" },

  // ── Zhipu (GLM) ──
  { provider: "Zhipu", model: "GLM-5", parameters: "744B", inputPricePer1M: 0.95, outputPricePer1M: 2.55, contextWindow: "200K", category: "Open Weights", capabilities: ["Text", "Vision", "Code", "Reasoning", "Agents"], releaseDate: "2026-02", eloScore: 1412, license: "Apache 2.0" },

  // ── MiniMax ──
  { provider: "MiniMax", model: "M2.5", parameters: "230B", inputPricePer1M: 0.30, outputPricePer1M: 1.20, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Code", "Reasoning", "Agents"], releaseDate: "2026-02", eloScore: 1215, license: "Proprietary" },
  { provider: "MiniMax", model: "M2.5 Lightning", parameters: "230B", inputPricePer1M: 0.30, outputPricePer1M: 2.40, contextWindow: "200K", category: "Frontier", capabilities: ["Text", "Code", "Reasoning", "Agents"], releaseDate: "2026-02", eloScore: 1215, license: "Proprietary" },

  // ── Stability AI ──
  { provider: "Stability AI", model: "Stable Diffusion 3.5 Large", parameters: "8B", inputPricePer1M: 65.00, outputPricePer1M: 0, contextWindow: "-", category: "Image", capabilities: ["Image Gen"], releaseDate: "2024-10", license: "Proprietary" },
  { provider: "Stability AI", model: "SDXL 1.0", parameters: "3.5B", inputPricePer1M: 15.00, outputPricePer1M: 0, contextWindow: "-", category: "Image", capabilities: ["Image Gen"], releaseDate: "2023-07", license: "Proprietary" },
];
