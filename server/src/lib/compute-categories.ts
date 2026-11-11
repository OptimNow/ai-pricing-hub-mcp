// Instance categorisation, processor and use-case inference: a port of the
// site's src/lib/compute-categories.ts, taken whole at its commit c4a6916.
// Only the two imports below differ. Do not edit the rules here: change them
// on the site and copy the file again (`npm run check-parity` compares the two
// over the live catalogue). The colour maps are the site's and unused here.
import type { ComputeInstance, CloudProvider } from "../data/pricing-data.js";
import { parseAzureSizeName } from "./azure-size-name.js";

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

export const ALL_CATEGORIES: ComputeCategory[] = [
  "General Purpose",
  "Compute Optimized",
  "Memory Optimized",
  "Storage Optimized",
  "GPU / Accelerated",
  "Burstable",
];

export const ALL_USE_CASES: ComputeUseCase[] = [
  "Web App",
  "Database",
  "HPC",
  "ML & AI",
  "Dev/Test",
  "Big Data",
];

export const ALL_PROCESSORS: ProcessorFamily[] = [
  "Intel", "AMD",
  "Graviton", "Trainium", "Inferentia", "Ampere", "Axion", "ARM",
  "NVIDIA T4", "NVIDIA V100", "NVIDIA A100", "NVIDIA H100", "NVIDIA L4", "NVIDIA A10G", "NVIDIA Other",
];

export const categoryColors: Record<ComputeCategory, string> = {
  "General Purpose": "bg-[hsl(210,70%,55%,0.15)] text-[hsl(210,70%,71%)]",
  "Compute Optimized": "bg-[hsl(35,80%,55%,0.15)] text-[hsl(35,80%,65%)]",
  "Memory Optimized": "bg-[hsl(280,60%,55%,0.15)] text-[hsl(280,60%,75%)]",
  "Storage Optimized": "bg-[hsl(170,60%,45%,0.15)] text-[hsl(170,60%,55%)]",
  "GPU / Accelerated": "bg-[hsl(0,65%,55%,0.15)] text-[hsl(0,65%,75%)]",
  Burstable: "bg-[hsl(145,60%,45%,0.15)] text-[hsl(145,60%,55%)]",
};

export const useCaseColors: Record<ComputeUseCase, string> = {
  "Web App": "bg-[hsl(210,70%,55%,0.15)] text-[hsl(210,70%,71%)]",
  Database: "bg-[hsl(280,60%,55%,0.15)] text-[hsl(280,60%,75%)]",
  HPC: "bg-[hsl(0,65%,55%,0.15)] text-[hsl(0,65%,75%)]",
  "ML & AI": "bg-[hsl(35,80%,55%,0.15)] text-[hsl(35,80%,65%)]",
  "Dev/Test": "bg-[hsl(145,60%,45%,0.15)] text-[hsl(145,60%,55%)]",
  "Big Data": "bg-[hsl(170,60%,45%,0.15)] text-[hsl(170,60%,55%)]",
};

export const processorColors: Record<ProcessorFamily, string> = {
  // x86
  Intel: "bg-[hsl(210,80%,55%,0.15)] text-[hsl(210,80%,71%)]",
  AMD: "bg-[hsl(0,70%,50%,0.15)] text-[hsl(0,70%,74%)]",
  // ARM
  Graviton: "bg-[hsl(35,85%,50%,0.15)] text-[hsl(35,85%,62%)]",
  Ampere: "bg-[hsl(145,60%,45%,0.15)] text-[hsl(145,60%,55%)]",
  Axion: "bg-[hsl(175,65%,42%,0.15)] text-[hsl(175,65%,55%)]",
  ARM: "bg-[hsl(120,50%,45%,0.15)] text-[hsl(120,50%,57%)]",
  // AWS AI Accelerators (Orange)
  Trainium: "bg-[hsl(30,85%,50%,0.15)] text-[hsl(30,85%,64%)]",
  Inferentia: "bg-[hsl(25,80%,50%,0.15)] text-[hsl(25,80%,67%)]",
  // NVIDIA GPUs: a chartreuse tint behind light grey text. The text itself was
  // chartreuse until 2026-10-04; the accent is never a text colour (brand rule).
  "NVIDIA T4": "bg-[hsl(84,76%,60%,0.15)] text-foreground",
  "NVIDIA V100": "bg-[hsl(84,76%,60%,0.15)] text-foreground",
  "NVIDIA A100": "bg-[hsl(84,76%,60%,0.15)] text-foreground",
  "NVIDIA H100": "bg-[hsl(84,76%,60%,0.15)] text-foreground",
  "NVIDIA L4": "bg-[hsl(84,76%,60%,0.15)] text-foreground",
  "NVIDIA A10G": "bg-[hsl(84,76%,60%,0.15)] text-foreground",
  "NVIDIA Other": "bg-[hsl(84,76%,60%,0.15)] text-foreground",
};

/* ── Ratio-based category (industry standard vCPU:memory ratios) ── */

function categoryByRatio(vCPUs: number, memory: number): ComputeCategory {
  const ratio = memory / vCPUs; // GiB per vCPU
  if (ratio <= 3) return "Compute Optimized";  // ~1:2 (C-series)
  if (ratio <= 6) return "General Purpose";     // ~1:4 (M-series)
  return "Memory Optimized";                    // ~1:8+ (R/X-series)
}

/* ── Category inference by provider & instance-type prefix ── */

/**
 * An AWS family read into its prefix, generation and attribute letters:
 * "m6gd" is m, 6, "gd"; "hpc7g" is hpc, 7, "g"; "u7i-8tb" is u, 7, "i".
 * Null for the families written without a generation ("u-3tb1", "mac").
 */
function awsFamilyParts(type: string): { prefix: string; attributes: string } | null {
  const m = /^([a-z]+?)(\d+)([a-z]*)/.exec(type.split(".")[0].toLowerCase());
  return m ? { prefix: m[1], attributes: m[3] } : null;
}

// By the family's whole prefix, which is how AWS groups its families in the
// price list (instanceFamily). Read by first letter, "trn1" began like "t3"
// and "inf2" like "i4i", which is how Trainium read Burstable and Inferentia
// and Gaudi (dl1) Storage Optimized; "cr1" and "hpc7g" read like "c5" and
// "h1"; and the u7i High Memory types General Purpose (review finding C6).
const AWS_CATEGORY_BY_PREFIX: Readonly<Record<string, ComputeCategory>> = {
  t: "Burstable",
  m: "General Purpose",
  a: "General Purpose",
  mac: "General Purpose",
  c: "Compute Optimized",
  hpc: "Compute Optimized",
  r: "Memory Optimized",
  x: "Memory Optimized",
  z: "Memory Optimized",
  u: "Memory Optimized",
  cr: "Memory Optimized",
  i: "Storage Optimized",
  im: "Storage Optimized",
  is: "Storage Optimized",
  d: "Storage Optimized",
  h: "Storage Optimized",
  // AWS's "Accelerated computing": GPUs, its ML chips, Gaudi, FPGAs, video.
  p: "GPU / Accelerated",
  g: "GPU / Accelerated",
  gr: "GPU / Accelerated",
  inf: "GPU / Accelerated",
  trn: "GPU / Accelerated",
  dl: "GPU / Accelerated",
  f: "GPU / Accelerated",
  vt: "GPU / Accelerated",
};

function inferAWSCategory(type: string): ComputeCategory {
  const family = type.split(".")[0].toLowerCase();
  if (/^u-/.test(family)) return "Memory Optimized"; // u-3tb1: High Memory
  if (family === "m2") return "Memory Optimized"; // the previous-generation m2
  const parts = awsFamilyParts(type);
  return (parts && AWS_CATEGORY_BY_PREFIX[parts.prefix]) || "General Purpose";
}

function inferAzureCategory(type: string): ComputeCategory {
  // The `Standard_` prefix is optional in the dataset — every row is written
  // bare ("NC6s_v3", not "Standard_NC6s_v3"). `Standard_?B` requires the word
  // "Standard" and only makes the underscore optional, so no rule ever matched
  // and all 18 Azure rows fell through to the "General Purpose" default: the
  // GPU shape, the memory-optimized E-series and the burstable B-series
  // included. `inferAzureProcessor` below already treats the prefix as
  // optional; this brings the two into line.
  if (/^(Standard_)?B/i.test(type)) return "Burstable";
  if (/^(Standard_)?D/i.test(type)) return "General Purpose";
  if (/^(Standard_)?F/i.test(type)) return "Compute Optimized";
  if (/^(Standard_)?E/i.test(type)) return "Memory Optimized";
  if (/^(Standard_)?M/i.test(type)) return "Memory Optimized";
  if (/^(Standard_)?L/i.test(type)) return "Storage Optimized";
  // H, HB, HC and HX are Azure's HPC sizes; G and GS its old memory sizes. They
  // fell through to the default and read General Purpose (review finding C6).
  if (/^(Standard_)?H/i.test(type)) return "Compute Optimized";
  if (/^(Standard_)?G/i.test(type)) return "Memory Optimized";
  if (/^(Standard_)?N/i.test(type)) return "GPU / Accelerated";
  if (/^(Standard_)?A/i.test(type)) return "General Purpose";
  return "General Purpose";
}

function inferGCPCategory(type: string): ComputeCategory {
  const lower = type.toLowerCase();
  if (/^e2-(micro|small|medium)$/.test(lower)) return "Burstable";
  if (/^(f1-|g1-)/.test(lower)) return "Burstable";
  // The GPU shapes first: g2's names read "g2-standard-4", which the -standard
  // rule below filed as General Purpose (review finding C6).
  if (/^(a2|a3|a4|g2|g4)-/.test(lower)) return "GPU / Accelerated";
  if (/^(c2|c3|c4|h3|h4)/.test(lower)) return "Compute Optimized"; // includes c4a, c4d
  if (/^(m1|m2|m3|m4|x4)-/.test(lower)) return "Memory Optimized";
  if (/-standard/.test(lower)) return "General Purpose";
  if (/-highmem/.test(lower)) return "Memory Optimized";
  if (/-highcpu/.test(lower)) return "Compute Optimized";
  return "General Purpose";
}

function inferDigitalOceanCategory(type: string): ComputeCategory {
  if (/^gpu-/.test(type)) return "GPU / Accelerated";
  if (/^s-/.test(type)) return "Burstable";
  if (/^(g-|gd-)/.test(type)) return "General Purpose";
  if (/^c-/.test(type)) return "Compute Optimized";
  if (/^(m-|so)/.test(type)) return "Memory Optimized";
  return "General Purpose";
}

function inferOCICategory(type: string, vCPUs: number, memory: number): ComputeCategory {
  if (/\.GPU\./i.test(type)) return "GPU / Accelerated";
  return categoryByRatio(vCPUs, memory);
}

/**
 * OVH's GPU ranges, by the prefix of the plan name, and the GPU each carries
 * as OVH's catalogue states it (`blobs.technical.gpu.model`, the US dollar
 * catalogue the fetch reads). Only t1 and t2 were recognised, so 22 of its 25
 * GPU instances read General Purpose / Intel and no GPU filter or advisor
 * question reached them (review finding C6).
 */
const OVH_GPU_RANGES: ReadonlyArray<[RegExp, ProcessorFamily]> = [
  [/^t1-/, "NVIDIA V100"], // Tesla V100
  [/^t2-/, "NVIDIA V100"], // Tesla V100S
  [/^a10-/, "NVIDIA A10G"], // A10: the A10G label, as Azure's and OCI's A10 rows read
  [/^a100-/, "NVIDIA A100"],
  [/^h100-/, "NVIDIA H100"],
  [/^l4-/, "NVIDIA L4"],
  [/^(l40s|h200|rtx\d+)-/, "NVIDIA Other"], // L40S, H200, Quadro RTX 5000
  [/^g\d-/, "NVIDIA Other"], // GeForce GTX 1060, 1070 and 1080 Ti
];

function inferOVHCategory(type: string): ComputeCategory {
  if (OVH_GPU_RANGES.some(([range]) => range.test(type))) return "GPU / Accelerated";
  if (/^d2-/.test(type)) return "Burstable";
  if (/^b\d-/.test(type)) return "General Purpose";
  if (/^c\d-/.test(type)) return "Compute Optimized";
  if (/^r\d-/.test(type)) return "Memory Optimized";
  if (/^i\d-/.test(type)) return "Storage Optimized";
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

// The accelerator in each AWS GPU, ML and FPGA family, from AWS's
// accelerated-computing instance pages. A family not listed reads by its host
// CPU, so a new GPU family needs an entry here.
const AWS_ACCELERATORS: Readonly<Record<string, ProcessorFamily>> = {
  p2: "NVIDIA Other", // K80
  p3: "NVIDIA V100",
  p3dn: "NVIDIA V100",
  p4d: "NVIDIA A100",
  p4de: "NVIDIA A100",
  p5: "NVIDIA H100",
  p5e: "NVIDIA Other", // H200
  p5en: "NVIDIA Other", // H200
  "p6-b200": "NVIDIA Other", // B200
  "p6-b300": "NVIDIA Other", // B300
  "p6e-gb200": "NVIDIA Other", // GB200
  g2: "NVIDIA Other", // GRID K520
  g3: "NVIDIA Other", // M60
  g3s: "NVIDIA Other", // M60
  g4dn: "NVIDIA T4",
  g4ad: "AMD", // Radeon Pro V520 on an AMD EPYC host: no NVIDIA part at all
  g5: "NVIDIA A10G",
  g5g: "NVIDIA T4", // T4G, on Graviton2
  g6: "NVIDIA L4",
  g6f: "NVIDIA L4", // a fraction of an L4
  gr6: "NVIDIA L4",
  gr6f: "NVIDIA L4",
  g6e: "NVIDIA Other", // L40S
  g7e: "NVIDIA Other", // RTX PRO 6000 Blackwell Server Edition
  inf1: "Inferentia",
  inf2: "Inferentia",
  trn1: "Trainium",
  trn1n: "Trainium",
  trn2: "Trainium",
  dl1: "Intel", // Habana Gaudi, Intel's; it read "NVIDIA Other"
  f2: "AMD", // an FPGA on an AMD EPYC host (f1 and vt1 are on Intel)
};

function inferAWSProcessor(type: string): ProcessorFamily {
  const family = type.split(".")[0].toLowerCase();
  const accelerator = AWS_ACCELERATORS[family];
  if (accelerator) return accelerator;
  if (family === "a1") return "Graviton"; // the first Graviton
  const parts = awsFamilyParts(type);
  if (!parts) return "Intel";
  // The attribute letters after the generation name the CPU, g for Graviton
  // and a for AMD, wherever they sit. The old rules read the LAST letter, so
  // m6gd, c7gn, x2gd, im4gn and is4gen read Intel (244 rows), and m5ad, c5ad,
  // r5ad and m8azn read Intel too (review finding C6).
  if (parts.attributes.includes("g")) return "Graviton";
  if (parts.attributes.includes("a")) return "AMD";
  return "Intel";
}

function inferAzureProcessor(type: string): ProcessorFamily {
  // GPU families: the model is in the name, where it is named.
  if (/T4/i.test(type)) return "NVIDIA T4";
  if (/A100/i.test(type)) return "NVIDIA A100";
  if (/H100/i.test(type)) return "NVIDIA H100";
  if (/A10(?!0)/i.test(type)) return "NVIDIA A10G";
  // AMD's GPUs and media accelerator: Instinct MI300X, Radeon PRO V620 and V710.
  if (/MI300X|V620|V710|MA35D/i.test(type)) return "AMD";
  const name = parseAzureSizeName(type.replace(/^(Standard|Basic)_/, ""));
  if (!name) return /^(Standard_)?N/.test(type) ? "NVIDIA Other" : "Intel";
  const { family, letters, version } = name;
  if (family.startsWith("N")) {
    // NCv3 (NC6s_v3 to NC24rs_v3) and NDv2 (ND40rs_v2) ship V100s. The family
    // name never says so, so without this rule the catch-all below reports the
    // series as "NVIDIA Other" and it disappears from a V100 filter.
    if (family === "NC" && version === 3 && !name.tags) return "NVIDIA V100";
    if (family === "ND" && version === 2 && !name.tags) return "NVIDIA V100";
    if (family === "ND" && version === 4) return "NVIDIA A100"; // ND96asr_v4 names none
    if (family === "NV" && version === 4) return "AMD"; // NVv4: AMD Instinct MI25
    if (family === "NP") return "Intel"; // NP: a Xilinx FPGA on an Intel host
    return "NVIDIA Other"; // NC/ND/NV without a named GPU
  }
  // HB and HX are AMD EPYC throughout; HC and H are Intel.
  if (family === "HB" || family === "HX") return "AMD";
  // ARM: a `p` in the letters. Microsoft documents Ampere Altra for Dpsv5,
  // Epsv5 and Bpsv2 (which read Intel: the rule tested D and E only), and its
  // own Cobalt from v6; any other `p` size is ARM without a named chip.
  if (letters.includes("p")) {
    const altra = ((family === "D" || family === "E") && version === 5) || (family === "B" && version === 2);
    return altra ? "Ampere" : "ARM";
  }
  // AMD: an `a` in the letters, wherever it sits. The rule wanted it right
  // after the digits of D, E, L and F, so Basv2, DCasv5, ECasv5, E104ias_v5
  // and the L `aos` sizes read Intel (review finding C6).
  if (letters.includes("a")) return "AMD";
  // Lsv2 is AMD EPYC (Naples), with no `a` in its name.
  if (family === "L" && version === 2) return "AMD";
  return "Intel";
}

function inferGCPProcessor(type: string): ProcessorFamily {
  const lower = type.toLowerCase();
  // Specific GPU families
  if (/^a2/.test(lower)) return "NVIDIA A100";
  if (/^a3-ultra/.test(lower)) return "NVIDIA Other"; // H200
  if (/^a3/.test(lower)) return "NVIDIA H100";
  if (/^a4/.test(lower)) return "NVIDIA Other"; // B200, GB200
  if (/^g2/.test(lower)) return "NVIDIA L4";
  if (/^g4/.test(lower)) return "NVIDIA Other"; // RTX PRO 6000
  // ARM — t2a uses Ampere Altra, c4a uses Google Axion
  if (/^(t2a|tau)/.test(lower)) return "Ampere";
  if (/^c4a/.test(lower)) return "Axion";
  // AMD — 'd' suffix families (n2d, c2d, c3d, t2d)
  if (/^[a-z]\d+d-/.test(lower)) return "AMD";
  return "Intel";
}

// DigitalOcean's GPU Droplets name the GPU after "gpu-" ("gpu-h100x8-640gb").
// Every one read Intel until 2026-10-20 (review finding C6).
const DO_GPUS: ReadonlyArray<[RegExp, ProcessorFamily]> = [
  [/^gpu-h100/, "NVIDIA H100"],
  [/^gpu-mi\d+/, "AMD"], // AMD Instinct MI300X, MI325X
];

function inferDigitalOceanProcessor(type: string): ProcessorFamily {
  for (const [gpu, family] of DO_GPUS) if (gpu.test(type)) return family;
  if (/^gpu-/.test(type)) return "NVIDIA Other"; // L40S, RTX 4000 and 6000 Ada, H200…
  if (/-amd/.test(type)) return "AMD";
  return "Intel";
}

function inferOCIProcessor(type: string): ProcessorFamily {
  // Specific GPU models
  if (/\.GPU\.A10\./i.test(type)) return "NVIDIA A10G";
  if (/\.GPU3\./i.test(type)) return "NVIDIA V100";
  if (/\.GPU2\./i.test(type)) return "NVIDIA Other"; // P100
  if (/\.GPU\./i.test(type)) return "NVIDIA Other";
  // ARM: A1 is Ampere Altra, A2 AmpereOne (which read Intel)
  if (/\.A[12]\./i.test(type)) return "Ampere";
  // AMD — E-series
  if (/\.E\d/i.test(type)) return "AMD";
  return "Intel";
}

function inferOVHProcessor(type: string): ProcessorFamily {
  for (const [range, gpu] of OVH_GPU_RANGES) if (range.test(type)) return gpu;
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

export function enrichInstances(instances: ComputeInstance[]): EnrichedComputeInstance[] {
  return instances.map((inst) => {
    const category = inferCategory(inst.provider, inst.instanceType, inst.vCPUs, inst.memory);
    const useCases = inferUseCases(category, inst.vCPUs, inst.memory);
    const processor = inferProcessor(inst.provider, inst.instanceType);
    return { ...inst, category, useCases, processor };
  });
}
