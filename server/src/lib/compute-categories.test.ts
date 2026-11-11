import test from "node:test";
import assert from "node:assert/strict";

import { enrichInstances, inferCategory, inferProcessor } from "./compute-categories.js";
import { parseAzureSizeName } from "./azure-size-name.js";
import type { CloudProvider } from "../data/pricing-data.js";

/**
 * compute-categories.ts is the site's file, copied whole, and `check-parity`
 * holds the two together over the live catalogue. That check needs the site's
 * private checkout, so it does not run in CI. These tests pin the rows that
 * were wrong here before the file was copied again on 2026-11-11: 826 of the
 * 3,555 Linux rows in us-east carried another processor than on the site, 121
 * of them among the 211 GPU rows a self-hosting question is asked about.
 */

const processor = (provider: CloudProvider, type: string) => inferProcessor(provider, type);
const category = (provider: CloudProvider, type: string) => inferCategory(provider, type, 8, 32);

test("an AWS GPU family names the accelerator it carries, not its neighbour's", () => {
  assert.equal(processor("AWS", "g6.xlarge"), "NVIDIA L4");
  assert.equal(processor("AWS", "g6e.4xlarge"), "NVIDIA Other", "g6e is an L40S: it read L4, as g6 does");
  assert.equal(processor("AWS", "g7e.48xlarge"), "NVIDIA Other");
  assert.equal(processor("AWS", "g5.4xlarge"), "NVIDIA A10G");
  assert.equal(processor("AWS", "g5g.xlarge"), "NVIDIA T4", "g5g is a T4G on Graviton, not an A10G");
  assert.equal(processor("AWS", "g4ad.16xlarge"), "AMD", "a Radeon on an EPYC host: no NVIDIA part");
  assert.equal(processor("AWS", "p5.48xlarge"), "NVIDIA H100");
  assert.equal(processor("AWS", "p5en.48xlarge"), "NVIDIA Other", "H200, which read H100");
  assert.equal(processor("AWS", "dl1.24xlarge"), "Intel", "Gaudi is Intel's");
});

test("an AWS CPU is read from the attribute letters, wherever they sit", () => {
  assert.equal(processor("AWS", "m6gd.metal"), "Graviton", "read Intel: the rule wanted the g last");
  assert.equal(processor("AWS", "c7gn.xlarge"), "Graviton");
  assert.equal(processor("AWS", "m5ad.12xlarge"), "AMD", "read Intel: the rule wanted the a last");
  assert.equal(processor("AWS", "m7i.large"), "Intel");
  assert.equal(processor("AWS", "t4g.micro"), "Graviton");
});

test("an AWS family is filed by its whole prefix, not its first letter", () => {
  assert.equal(category("AWS", "hpc7g.4xlarge"), "Compute Optimized", "read Storage Optimized, like h1");
  assert.equal(category("AWS", "trn1.2xlarge"), "GPU / Accelerated", "read Burstable, like t3");
  assert.equal(category("AWS", "inf2.xlarge"), "GPU / Accelerated", "read Storage Optimized, like i4i");
  assert.equal(category("AWS", "u7in-32tb.224xlarge"), "Memory Optimized");
  assert.equal(category("AWS", "z1d.large"), "Memory Optimized");
  assert.equal(category("AWS", "g6e.4xlarge"), "GPU / Accelerated");
  assert.equal(category("AWS", "m7i.large"), "General Purpose");
});

test("an Azure size is read through its name", () => {
  assert.equal(processor("Azure", "NC6s_v3"), "NVIDIA V100");
  assert.equal(processor("Azure", "NC4as_T4_v3"), "NVIDIA T4");
  assert.equal(processor("Azure", "NC24ads_A10_v4"), "NVIDIA A10G");
  assert.equal(processor("Azure", "ND96asr_v4"), "NVIDIA A100");
  assert.equal(processor("Azure", "D4ads_v5"), "AMD");
  assert.equal(processor("Azure", "D4ps_v5"), "Ampere");
  assert.equal(processor("Azure", "D4ps_v6"), "ARM", "Cobalt: ARM without a named chip here");
  assert.equal(processor("Azure", "HB120rs_v3"), "AMD");
  assert.equal(category("Azure", "NC6s_v3"), "GPU / Accelerated");
  assert.equal(category("Azure", "HB120rs_v3"), "Compute Optimized");
  assert.equal(category("Azure", "E8s_v5"), "Memory Optimized");
});

test("the Azure name parser reads the parts the rules use", () => {
  assert.deepEqual(parseAzureSizeName("D4ads_v5"), {
    family: "D", size: 4, active: null, letters: "ads", tags: "", version: 5, base: "D4ads_v5",
  });
  assert.deepEqual(parseAzureSizeName("E32-8s_v5"), {
    family: "E", size: 32, active: 8, letters: "s", tags: "", version: 5, base: "E32s_v5",
  });
  assert.equal(parseAzureSizeName("NC24ads_A10_v4")?.tags, "_A10");
  assert.equal(parseAzureSizeName("NC6")?.version, 1, "no version in the name is version 1");
  assert.equal(parseAzureSizeName("Esv4_Type1"), null, "a Dedicated Host, not a VM size");
});

test("the other providers' GPU ranges are recognised", () => {
  assert.equal(processor("GCP", "a2-highgpu-1g"), "NVIDIA A100");
  assert.equal(processor("GCP", "g2-standard-4"), "NVIDIA L4");
  assert.equal(category("GCP", "g2-standard-4"), "GPU / Accelerated", "read General Purpose on -standard");
  assert.equal(processor("OVH", "h100-380"), "NVIDIA H100");
  assert.equal(category("OVH", "l40s-90"), "GPU / Accelerated");
  assert.equal(processor("DigitalOcean", "gpu-h100x8-640gb"), "NVIDIA H100");
  assert.equal(processor("OCI", "VM.GPU.A10.1"), "NVIDIA A10G");
});

test("enrichment adds the three labels and leaves the row as it was", () => {
  const row = {
    provider: "AWS" as const, instanceType: "g6e.4xlarge", os: "Linux" as const, vCPUs: 16, memory: 128,
    onDemandHourly: 3.0042, onDemandMonthly: 2193.1, spot: 1.6625,
    savingsPlan1yr: 2.2712, savingsPlan3yr: 1.5574, reserved1yr: 1.8927, reserved3yr: 1.2978,
  };
  const [enriched] = enrichInstances([row]);
  assert.deepEqual(enriched, { ...row, category: "GPU / Accelerated", useCases: ["ML & AI", "HPC"], processor: "NVIDIA Other" });
});
