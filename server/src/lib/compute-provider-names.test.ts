import test from "node:test";
import assert from "node:assert/strict";
import { computeProviderNamed } from "./compute-pricing.js";

/**
 * The provider filter compares names exactly, and the catalogue calls its
 * providers AWS, Azure, GCP, DigitalOcean, OCI, OVH and Alibaba. On 0.14.3
 * "Amazon" answered "0 of 3,561 instances match" with no error, which reads as
 * "Amazon sells no instance", and the break-even refused `provider: "Google"`
 * for an instance it then said exists at GCP.
 */

test("a provider is named by the catalogue's name for it, whatever the caller calls it", () => {
  for (const [given, known] of [
    ["AWS", "AWS"], ["aws", "AWS"], ["Amazon", "AWS"], ["Amazon Web Services", "AWS"], ["EC2", "AWS"],
    ["azure", "Azure"], ["Microsoft", "Azure"], ["Microsoft Azure", "Azure"],
    ["gcp", "GCP"], ["Google", "GCP"], ["Google Cloud", "GCP"], ["Google Cloud Platform", "GCP"], ["GCE", "GCP"],
    ["oci", "OCI"], ["Oracle", "OCI"], ["Oracle Cloud Infrastructure", "OCI"],
    ["digitalocean", "DigitalOcean"], ["Digital Ocean", "DigitalOcean"], ["DO", "DigitalOcean"],
    ["ovh", "OVH"], ["OVHcloud", "OVH"],
    ["alibaba", "Alibaba"], ["Alibaba Cloud", "Alibaba"], ["Aliyun", "Alibaba"],
  ]) {
    assert.equal(computeProviderNamed(given), known, given);
  }
});

test("a provider the catalogue does not carry stays what it was, and matches nothing", () => {
  // Not mapped to the nearest of the seven: CoreWeave's prices are not anyone else's.
  for (const given of ["CoreWeave", "Lambda", "Hetzner", "IBM Cloud", "Amazonia"]) {
    assert.equal(computeProviderNamed(given), given);
  }
  assert.equal(computeProviderNamed("  Scaleway "), "Scaleway");
});
