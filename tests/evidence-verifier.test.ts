import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  EvidencePackage,
  IntervalAllocation,
  IntervalProof,
  VerificationResult,
} from "../lib/contracts";
import {
  buildEvidencePackage,
  canonicalJson,
  generateMerkleProof,
  merkleTree,
  verifyEvidencePackage,
  verifyMerkleProof,
} from "../lib/evidence";

interface GoldenFixture {
  fixtureVersion: string;
  input: {
    scenario: EvidencePackage["scenario"];
    rule: EvidencePackage["manifest"]["allocationRule"];
  };
  package: EvidencePackage;
  expected: {
    manifestHash: string;
    merkleRoot: string;
    nonces: string[];
    firstProof: IntervalProof;
    checks: VerificationResult["checks"];
  };
}

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/evidence-package.golden.json", import.meta.url), "utf8"),
) as GoldenFixture;

function clonePackage(): EvidencePackage {
  return structuredClone(fixture.package);
}

function expectInvalid(result: VerificationResult, code?: string) {
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  if (code) assert.ok(result.errors.some((error) => error.code === code), `missing error ${code}`);
}

function sampleIntervals(count: number): IntervalAllocation[] {
  return Array.from({ length: count }, (_, index) => ({
    startUtc: new Date(Date.UTC(2025, 0, 1, 0, index * 30)).toISOString(),
    endUtc: new Date(Date.UTC(2025, 0, 1, 0, (index + 1) * 30)).toISOString(),
    generationWh: index * 101,
    totalDemandWh: 1000,
    onsiteMatchedWh: index * 101,
    exportWh: 0,
    gridImportWh: 1000 - index * 101,
    tenantAllocationsWh: { "tenant-a": index * 51, "tenant-b": index * 50 },
    tenantGridImportWh: { "tenant-a": 500 - index * 51, "tenant-b": 500 - index * 50 },
    status: "verified-input",
    qualityFlags: [],
    ruleId: "pro_rata_demand_v1",
    ruleVersion: "1.0.0",
  }));
}

async function rootFor(intervals: IntervalAllocation[], nonces: string[]) {
  const leaves = intervals.map((interval, index) => canonicalJson({ interval, nonce: nonces[index] }));
  return (await merkleTree(leaves)).root;
}

test("fixed Golden Dataset verifies every check and committed expectation", async () => {
  const result = await verifyEvidencePackage(fixture.package);
  assert.equal(fixture.fixtureVersion, "1.0.0");
  assert.equal(result.valid, true);
  assert.deepEqual(result.checks, fixture.expected.checks);
  assert.equal(fixture.package.manifestHash, fixture.expected.manifestHash);
  assert.equal(fixture.package.manifest.merkleRoot, fixture.expected.merkleRoot);
  assert.deepEqual(fixture.package.proofs.map((proof) => proof.nonce), fixture.expected.nonces);
  assert.deepEqual(fixture.package.proofs[0], fixture.expected.firstProof);
  assert.ok(result.warnings.some((warning) => warning.code === "NO_TRUSTED_ISSUER"));
  assert.ok(result.warnings.some((warning) => warning.code === "NO_TRUSTED_TIMESTAMP"));
});

test("single-leaf, two-leaf, odd-leaf and multi-level proofs verify for every leaf", async () => {
  for (const count of [1, 2, 3, 5, 8]) {
    const intervals = sampleIntervals(count);
    const nonces = intervals.map((_, index) => `nonce:${count}:${index}`);
    const root = await rootFor(intervals, nonces);
    for (let index = 0; index < intervals.length; index += 1) {
      const proof = await generateMerkleProof(intervals, nonces, index);
      assert.equal(await verifyMerkleProof(intervals[index], proof, root, count), true);
    }
  }
});

test("Merkle proof rejects wrong sibling, direction and nonce", async () => {
  const intervals = sampleIntervals(5);
  const nonces = intervals.map((_, index) => `nonce:5:${index}`);
  const root = await rootFor(intervals, nonces);
  const proof = await generateMerkleProof(intervals, nonces, 2);

  const wrongSibling = structuredClone(proof);
  wrongSibling.path[0].siblingHash = "0".repeat(64);
  assert.equal(await verifyMerkleProof(intervals[2], wrongSibling, root, 5), false);

  const wrongPosition = structuredClone(proof);
  wrongPosition.path[0].position = wrongPosition.path[0].position === "left" ? "right" : "left";
  assert.equal(await verifyMerkleProof(intervals[2], wrongPosition, root, 5), false);

  const wrongNonce = structuredClone(proof);
  wrongNonce.nonce = "wrong-nonce";
  assert.equal(await verifyMerkleProof(intervals[2], wrongNonce, root, 5), false);
});

test("Merkle proof fails explicitly for empty trees, bounds, hashes, path length and position", async () => {
  await assert.rejects(generateMerkleProof([], [], 0), /empty interval set/i);
  await assert.rejects(generateMerkleProof(sampleIntervals(1), ["nonce"], 1), /outside/i);
  const intervals = sampleIntervals(3);
  const nonces = ["n0", "n1", "n2"];
  const root = await rootFor(intervals, nonces);
  const proof = await generateMerkleProof(intervals, nonces, 0);

  await assert.rejects(verifyMerkleProof(intervals[0], proof, "broken", 3), /SHA-256/i);
  const shortPath = structuredClone(proof);
  shortPath.path.pop();
  await assert.rejects(verifyMerkleProof(intervals[0], shortPath, root, 3), /path length/i);
  const illegalPosition = structuredClone(proof) as unknown as {
    path: Array<Record<string, unknown>>;
  };
  illegalPosition.path[0].position = "above";
  await assert.rejects(
    verifyMerkleProof(intervals[0], illegalPosition as unknown as IntervalProof, root, 3),
    /invalid Merkle proof position/i,
  );
});

test("one Wh, generation and tenant-allocation changes invalidate the package", async () => {
  const oneWh = clonePackage();
  oneWh.intervals[1].gridImportWh += 1;
  expectInvalid(await verifyEvidencePackage(oneWh), "INTERVAL_RESULT_MISMATCH");

  const generation = clonePackage();
  generation.intervals[2].generationWh += 1;
  expectInvalid(await verifyEvidencePackage(generation), "INTERVAL_RESULT_MISMATCH");

  const allocation = clonePackage();
  allocation.intervals[2].tenantAllocationsWh["tenant-a"] += 1;
  expectInvalid(await verifyEvidencePackage(allocation), "INTERVAL_RESULT_MISMATCH");
});

test("rule ID and version changes invalidate the package", async () => {
  const ruleId = clonePackage() as unknown as Record<string, unknown>;
  ((ruleId.manifest as Record<string, unknown>).allocationRule as Record<string, unknown>).id = "unknown_rule";
  expectInvalid(await verifyEvidencePackage(ruleId), "RULE_BINDING_MISMATCH");

  const ruleVersion = clonePackage() as unknown as Record<string, unknown>;
  ((ruleVersion.manifest as Record<string, unknown>).allocationRule as Record<string, unknown>).version = "1.0.1";
  expectInvalid(await verifyEvidencePackage(ruleVersion), "RULE_BINDING_MISMATCH");
});

test("manifest, manifestHash and attestation-total changes invalidate the package", async () => {
  const manifest = clonePackage();
  manifest.manifest.engineVersion = "changed";
  expectInvalid(await verifyEvidencePackage(manifest), "MANIFEST_HASH_MISMATCH");

  const manifestHash = clonePackage();
  manifestHash.manifestHash = "0".repeat(64);
  expectInvalid(await verifyEvidencePackage(manifestHash), "MANIFEST_HASH_MISMATCH");

  const totals = clonePackage();
  totals.attestation.totalsWh.generation += 1;
  expectInvalid(await verifyEvidencePackage(totals), "TOTALS_MISMATCH");

  const attestation = clonePackage();
  attestation.attestation.scenarioLabel = "Changed label";
  expectInvalid(await verifyEvidencePackage(attestation), "ATTESTATION_BINDING_MISMATCH");
});

test("scenario ID and period changes invalidate the package", async () => {
  const scenarioId = clonePackage();
  scenarioId.scenarioId = "changed";
  expectInvalid(await verifyEvidencePackage(scenarioId), "SCENARIO_ID_MISMATCH");

  const period = clonePackage();
  period.manifest.period.endUtc = period.intervals[1].endUtc;
  expectInvalid(await verifyEvidencePackage(period), "PERIOD_MISMATCH");
});

test("deleted, duplicated and reordered intervals invalidate the package", async () => {
  const deleted = clonePackage();
  deleted.intervals.splice(1, 1);
  expectInvalid(await verifyEvidencePackage(deleted), "PROOF_COVERAGE_MISMATCH");

  const duplicated = clonePackage();
  duplicated.intervals[1] = structuredClone(duplicated.intervals[0]);
  expectInvalid(await verifyEvidencePackage(duplicated), "INTERVAL_RESULT_MISMATCH");

  const reordered = clonePackage();
  [reordered.intervals[1], reordered.intervals[2]] = [reordered.intervals[2], reordered.intervals[1]];
  expectInvalid(await verifyEvidencePackage(reordered), "INTERVAL_RESULT_MISMATCH");
});

test("invalid JSON and missing fields return structured errors", async () => {
  const invalidJson = await verifyEvidencePackage("{not-json");
  expectInvalid(invalidJson, "INVALID_JSON");

  const missingManifest = structuredClone(fixture.package) as unknown as Record<string, unknown>;
  delete missingManifest.manifest;
  expectInvalid(await verifyEvidencePackage(missingManifest), "MALFORMED_PACKAGE");

  const malformedProof = clonePackage() as unknown as Record<string, unknown>;
  const proof = (malformedProof.proofs as Array<Record<string, unknown>>)[0];
  delete proof.nonce;
  expectInvalid(await verifyEvidencePackage(malformedProof), "MALFORMED_PACKAGE");
});

test("repeated generation produces byte-identical core hashes, roots and proofs", async () => {
  const first = await buildEvidencePackage(fixture.input.scenario, fixture.input.rule);
  const second = await buildEvidencePackage(fixture.input.scenario, fixture.input.rule);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.manifest.merkleRoot, second.manifest.merkleRoot);
  assert.equal(first.manifest.resultSha256, second.manifest.resultSha256);
  assert.deepEqual(first.proofs, second.proofs);
  assert.equal(canonicalJson(first), canonicalJson(second));
});
