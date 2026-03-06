import type { ComputeRegion, CloudProvider } from "./pricing-data.js";

export interface RegionApiCodes {
  slug: string; // URL param value
  aws: { location: string; region: string };
  azure: { armRegionName: string };
  gcp: { region: string };
  digitalocean?: { region: string };
  oci?: { region: string };
  ovh?: { region: string };
  alibaba?: { region: string };
}

export const regionApiMap: Record<ComputeRegion, RegionApiCodes> = {
  "US East": {
    slug: "us-east",
    aws: { location: "US East (N. Virginia)", region: "us-east-1" },
    azure: { armRegionName: "eastus" },
    gcp: { region: "us-central1" },
    digitalocean: { region: "nyc1" },
    oci: { region: "us-ashburn-1" },
    ovh: { region: "US-EAST-VA-1" },
    alibaba: { region: "us-east-1" },
  },
  "US West": {
    slug: "us-west",
    aws: { location: "US West (Oregon)", region: "us-west-2" },
    azure: { armRegionName: "westus2" },
    gcp: { region: "us-west1" },
    digitalocean: { region: "sfo3" },
    oci: { region: "us-phoenix-1" },
    ovh: { region: "US-WEST-OR-1" },
    alibaba: { region: "us-west-1" },
  },
  "Europe": {
    slug: "europe",
    aws: { location: "EU (Ireland)", region: "eu-west-1" },
    azure: { armRegionName: "westeurope" },
    gcp: { region: "europe-west1" },
    digitalocean: { region: "ams3" },
    oci: { region: "eu-frankfurt-1" },
    ovh: { region: "GRA" },
    alibaba: { region: "eu-central-1" },
  },
  "Asia Pacific": {
    slug: "asia-pacific",
    aws: { location: "Asia Pacific (Singapore)", region: "ap-southeast-1" },
    azure: { armRegionName: "japaneast" },
    gcp: { region: "asia-east1" },
    digitalocean: { region: "sgp1" },
    oci: { region: "ap-tokyo-1" },
    ovh: { region: "SGP" },
    alibaba: { region: "ap-southeast-1" },
  },
};

export function slugToRegion(slug: string): ComputeRegion | null {
  for (const [region, codes] of Object.entries(regionApiMap)) {
    if (codes.slug === slug) return region as ComputeRegion;
  }
  return null;
}

export function regionToSlug(region: ComputeRegion): string {
  return regionApiMap[region].slug;
}

/** Instance types we track per provider — used to filter API responses */
export const trackedInstances: Record<CloudProvider, string[]> = {
  AWS: [
    "t4g.nano", "t3a.nano", "t3.nano", "t3.micro", "t3.small",
    "t3.medium", "t3.large", "m5.large", "m5.xlarge", "m5.2xlarge",
    "c5.large", "c5.xlarge", "r5.large", "r5.xlarge", "p3.2xlarge",
  ],
  Azure: [
    "B1s", "B2s", "D2s_v5", "D4s_v5", "D8s_v5",
    "F2s_v2", "F4s_v2", "E2s_v5", "E4s_v5", "NC6s_v3",
  ],
  GCP: [
    "e2-micro", "e2-small", "e2-medium",
    "n2-standard-2", "n2-standard-4", "n2-standard-8",
    "c2-standard-4", "c2-standard-8",
    "n2-highmem-2", "n2-highmem-4", "a2-highgpu-1g",
  ],
  DigitalOcean: [
    "s-1vcpu-512mb-10gb", "s-1vcpu-1gb", "s-2vcpu-2gb", "s-2vcpu-4gb",
    "s-4vcpu-8gb", "g-2vcpu-8gb", "gd-2vcpu-8gb", "so1_5-2vcpu-16gb",
  ],
  OCI: [
    "VM.Standard.E4.Flex.1", "VM.Standard.E4.Flex.2", "VM.Standard.E4.Flex.4", "VM.Standard.E4.Flex.8",
    "VM.Standard3.Flex.2", "VM.Standard3.Flex.4", "VM.Optimized3.Flex.2", "VM.GPU.A10.1",
  ],
  OVH: [
    "d2-2", "d2-4", "d2-8", "b2-7", "b2-15", "b2-30", "c2-7", "c2-15",
  ],
  Alibaba: [
    "ecs.t6-c1m1.large", "ecs.g7.large", "ecs.g7.xlarge",
    "ecs.c7.large", "ecs.c7.xlarge", "ecs.r7.large", "ecs.r7.xlarge",
    "ecs.gn7-c12g1.3xlarge",
  ],
};
