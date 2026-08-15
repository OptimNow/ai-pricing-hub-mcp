import { computeInstances, type ComputeInstance, type CloudProvider } from "../data/pricing-data.js";

export type ComputeCategory =
  | "General Purpose"
  | "Compute Optimized"
  | "Memory Optimized"
  | "Storage Optimized"
  | "GPU / Accelerated"
  | "Burstable";

export type ComputeUseCase =
  | "Web App"
  | "Database"
  | "HPC"
  | "ML & AI"
  | "Dev/Test"
  | "Big Data";

export type ProcessorFamily =
  | "Intel"
  | "AMD"
  | "Graviton"      // AWS ARM (Graviton 2/3/4)
  | "Ampere"        // Ampere Altra (Azure, OCI, GCP t2a)
  | "Axion"         // Google Axion (GCP c4a)
  | "ARM"           // Other ARM (Alibaba Yitian, etc.)
  | "NVIDIA T4"
  | "NVIDIA V100"
  | "NVIDIA A100"
  | "NVIDIA H100"
  | "NVIDIA L4"
  | "NVIDIA A10G"
  | "NVIDIA Other"
  | "Trainium"      // AWS Trainium
  | "Inferentia";   // AWS Inferentia

export interface EnrichedComputeInstance extends ComputeInstance {
  category: ComputeCategory;
  useCases: ComputeUseCase[];
  processor: ProcessorFamily;
}

/* ── Ratio-based category (industry standard vCPU:memory ratios) ── */

function categoryByRatio(vCPUs: number, memory: number): ComputeCategory {
  const ratio = memory / vCPUs; // GiB per vCPU
  if (ratio <= 3) return "Compute Optimized";  // ~1:2 (C-series)
  if (ratio <= 6) return "General Purpose";     // ~1:4 (M-series)
  return "Memory Optimized";                    // ~1:8+ (R/X-series)
}

/* ── Category inference by provider & instance-type prefix ── */

function inferAWSCategory(type: string): ComputeCategory {
  const family = type.split(".")[0].toLowerCase();
  if (/^t/.test(family)) return "Burstable";
  if (/^m/.test(family)) return "General Purpose";
  if (/^c/.test(family)) return "Compute Optimized";
  if (/^(r|x|u-)/.test(family)) return "Memory Optimized";
  if (/^(i|d|h)/.test(family)) return "Storage Optimized";
  if (/^(p|g|inf|trn|dl)/.test(family)) return "GPU / Accelerated";
  if (/^a/.test(family)) return "General Purpose"; // a1, a7g = Arm general purpose
  return "General Purpose";
}

function inferAzureCategory(type: string): ComputeCategory {
  // The `Standard_` prefix is optional in the dataset (rows are "NC6s_v3",
  // not "Standard_NC6s_v3"), so requiring it sent every Azure row to the
  // "General Purpose" default — including the GPU and memory-optimized ones.
  if (/^(Standard_)?B/i.test(type)) return "Burstable";
  if (/^(Standard_)?D/i.test(type)) return "General Purpose";
  if (/^(Standard_)?F/i.test(type)) return "Compute Optimized";
  if (/^(Standard_)?E/i.test(type)) return "Memory Optimized";
  if (/^(Standard_)?M/i.test(type)) return "Memory Optimized";
  if (/^(Standard_)?L/i.test(type)) return "Storage Optimized";
  if (/^(Standard_)?N/i.test(type)) return "GPU / Accelerated";
  if (/^(Standard_)?A/i.test(type)) return "General Purpose";
  return "General Purpose";
}

function inferGCPCategory(type: string): ComputeCategory {
  const lower = type.toLowerCase();
  if (/^e2-(micro|small|medium)$/.test(lower)) return "Burstable";
  if (/^(f1-|g1-)/.test(lower)) return "Burstable";
  if (/^(c2|c3|c4|h3)/.test(lower)) return "Compute Optimized"; // includes c4a
  if (/-standard/.test(lower)) return "General Purpose";
  if (/-highmem/.test(lower)) return "Memory Optimized";
  if (/^(m1|m2|m3)/.test(lower)) return "Memory Optimized";
  if (/^(a2|a3|g2)/.test(lower)) return "GPU / Accelerated";
  if (/-highcpu/.test(lower)) return "Compute Optimized";
  return "General Purpose";
}

function inferDigitalOceanCategory(type: string): ComputeCategory {
  if (/^s-/.test(type)) return "Burstable";
  if (/^(g-|gd-)/.test(type)) return "General Purpose";
  if (/^c-/.test(type)) return "Compute Optimized";
  if (/^(m-|so)/.test(type)) return "Memory Optimized";
  if (/^gpu-/.test(type)) return "GPU / Accelerated";
  return "General Purpose";
}

function inferOCICategory(type: string, vCPUs: number, memory: number): ComputeCategory {
  if (/\.GPU\./i.test(type)) return "GPU / Accelerated";
  return categoryByRatio(vCPUs, memory);
}

function inferOVHCategory(type: string): ComputeCategory {
  if (/^d2-/.test(type)) return "Burstable";
  if (/^b2-/.test(type)) return "General Purpose";
  if (/^c2-/.test(type)) return "Compute Optimized";
  if (/^r2-/.test(type)) return "Memory Optimized";
  if (/^t2-/.test(type)) return "GPU / Accelerated";
  return "General Purpose";
}

function inferAlibabaCategory(type: string): ComputeCategory {
  if (/^ecs\.t/.test(type)) return "Burstable";
  if (/^ecs\.g/.test(type) && !/^ecs\.gn/.test(type)) return "General Purpose";
  if (/^ecs\.c/.test(type)) return "Compute Optimized";
  if (/^ecs\.r/.test(type)) return "Memory Optimized";
  if (/^ecs\.gn/.test(type)) return "GPU / Accelerated";
  return "General Purpose";
}

export function inferCategory(provider: CloudProvider, instanceType: string, vCPUs: number, memory: number): ComputeCategory {
  switch (provider) {
    case "AWS": return inferAWSCategory(instanceType);
    case "Azure": return inferAzureCategory(instanceType);
    case "GCP": return inferGCPCategory(instanceType);
    case "DigitalOcean": return inferDigitalOceanCategory(instanceType);
    case "OCI": return inferOCICategory(instanceType, vCPUs, memory);
    case "OVH": return inferOVHCategory(instanceType);
    case "Alibaba": return inferAlibabaCategory(instanceType);
    default: return "General Purpose";
  }
}

/* ── Processor inference by provider & instance-type naming ── */

function inferAWSProcessor(type: string): ProcessorFamily {
  const family = type.split(".")[0].toLowerCase();
  // Specific GPU families
  if (/^p3/.test(family)) return "NVIDIA V100";
  if (/^p4/.test(family)) return "NVIDIA A100";
  if (/^p5/.test(family)) return "NVIDIA H100";
  if (/^g4/.test(family)) return "NVIDIA T4";
  if (/^g5/.test(family)) return "NVIDIA A10G";
  if (/^g6/.test(family)) return "NVIDIA L4";
  // AI accelerators
  if (/^inf/.test(family)) return "Inferentia";
  if (/^trn/.test(family)) return "Trainium";
  // dl1 uses Habana Gaudi (Intel-owned)
  if (/^dl/.test(family)) return "NVIDIA Other";
  // Graviton (ARM) — family ends with 'g' (t4g, m6g, m7g, c7g, r7g)
  if (/g$/.test(family)) return "Graviton";
  // 'a' prefix = ARM general purpose (a1, a7g already caught by 'g' suffix)
  if (/^a/.test(family)) return "Graviton";
  // AMD — family ends with 'a' (t3a, m5a, c5a, r5a)
  if (/a$/.test(family)) return "AMD";
  return "Intel";
}

function inferAzureProcessor(type: string): ProcessorFamily {
  // GPU families — detect specific GPU models from type name
  if (/T4/i.test(type)) return "NVIDIA T4";
  if (/A100/i.test(type)) return "NVIDIA A100";
  if (/H100/i.test(type)) return "NVIDIA H100";
  if (/A10/i.test(type) && !/A100/i.test(type)) return "NVIDIA A10G";
  // NCv3 (NC6s_v3, NC12s_v3, NC24s_v3, NC24rs_v3) ships V100s — the family name
  // never says so, so without this the ^N catch-all below labels them "Other".
  if (/^(Standard_)?NC\d+r?s_v3/i.test(type)) return "NVIDIA V100";
  if (/^(Standard_)?N/i.test(type)) return "NVIDIA Other"; // NC/ND/NV without specific GPU
  // ARM (Ampere Altra) — types with 'p' like Dps, D2ps, Dpds, Eps, E2ps
  if (/^(Standard_)?[DE]\d*p/i.test(type)) return "Ampere";
  // AMD — types with 'a' suffix before version (Da, Eas)
  if (/^(Standard_)?[DELF]\d*a/i.test(type)) return "AMD";
  return "Intel";
}

function inferGCPProcessor(type: string): ProcessorFamily {
  const lower = type.toLowerCase();
  // Specific GPU families
  if (/^a2/.test(lower)) return "NVIDIA A100";
  if (/^a3/.test(lower)) return "NVIDIA H100";
  if (/^g2/.test(lower)) return "NVIDIA L4";
  // ARM — t2a uses Ampere Altra, c4a uses Google Axion
  if (/^(t2a|tau)/.test(lower)) return "Ampere";
  if (/^c4a/.test(lower)) return "Axion";
  // AMD — 'd' suffix families (n2d, c2d, c3d, t2d)
  if (/^[a-z]\d+d-/.test(lower)) return "AMD";
  return "Intel";
}

function inferDigitalOceanProcessor(type: string): ProcessorFamily {
  if (/-amd/.test(type)) return "AMD";
  return "Intel";
}

function inferOCIProcessor(type: string): ProcessorFamily {
  // Specific GPU models
  if (/\.GPU\.A10\./i.test(type)) return "NVIDIA A10G";
  if (/\.GPU3\./i.test(type)) return "NVIDIA V100";
  if (/\.GPU2\./i.test(type)) return "NVIDIA Other"; // P100
  if (/\.GPU\./i.test(type)) return "NVIDIA Other";
  // ARM — A1 shape uses Ampere Altra
  if (/\.A1\./i.test(type)) return "Ampere";
  // AMD — E-series
  if (/\.E\d/i.test(type)) return "AMD";
  return "Intel";
}

function inferOVHProcessor(_type: string): ProcessorFamily {
  return "Intel";
}

function inferAlibabaProcessor(type: string): ProcessorFamily {
  if (/^ecs\.gn/.test(type)) return "NVIDIA Other";
  if (/\d+y\./.test(type)) return "ARM"; // Yitian 710 ARM (g8y, c8y, r8y)
  return "Intel";
}

export function inferProcessor(provider: CloudProvider, instanceType: string): ProcessorFamily {
  switch (provider) {
    case "AWS": return inferAWSProcessor(instanceType);
    case "Azure": return inferAzureProcessor(instanceType);
    case "GCP": return inferGCPProcessor(instanceType);
    case "DigitalOcean": return inferDigitalOceanProcessor(instanceType);
    case "OCI": return inferOCIProcessor(instanceType);
    case "OVH": return inferOVHProcessor(instanceType);
    case "Alibaba": return inferAlibabaProcessor(instanceType);
    default: return "Intel";
  }
}

/* ── Use case inference from category + specs ── */

export function inferUseCases(
  category: ComputeCategory,
  vCPUs: number,
  memory: number,
): ComputeUseCase[] {
  const cases: ComputeUseCase[] = [];
  const ratio = memory / vCPUs;

  switch (category) {
    case "Burstable":
      cases.push("Dev/Test", "Web App");
      break;
    case "General Purpose":
      cases.push("Web App");
      if (vCPUs >= 4) cases.push("Database");
      if (vCPUs >= 8) cases.push("Big Data");
      break;
    case "Compute Optimized":
      cases.push("HPC");
      if (vCPUs >= 16) cases.push("Big Data");
      cases.push("Web App");
      break;
    case "Memory Optimized":
      cases.push("Database", "Big Data");
      if (ratio >= 16) cases.push("HPC");
      break;
    case "Storage Optimized":
      cases.push("Database", "Big Data");
      break;
    case "GPU / Accelerated":
      cases.push("ML & AI", "HPC");
      break;
  }

  return cases;
}

/* ── Bulk enrichment ── */

function enrichInstances(instances: ComputeInstance[]): EnrichedComputeInstance[] {
  return instances.map((inst) => {
    const category = inferCategory(inst.provider, inst.instanceType, inst.vCPUs, inst.memory);
    const useCases = inferUseCases(category, inst.vCPUs, inst.memory);
    const processor = inferProcessor(inst.provider, inst.instanceType);
    return { ...inst, category, useCases, processor };
  });
}

/** The catalogue is static, so derive it once at module load rather than
 *  re-inferring every row on each tool call. */
export const enrichedInstances = enrichInstances(computeInstances);
