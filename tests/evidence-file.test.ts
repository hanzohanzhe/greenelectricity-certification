import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { EvidencePackage } from "../lib/contracts";
import {
  EVIDENCE_PACKAGE_MIME_TYPE,
  MAX_EVIDENCE_PACKAGE_BYTES,
  createEvidencePackageBlob,
  evidencePackageFilename,
  parseEvidencePackage,
  serializeEvidencePackage,
  tamperEvidencePackageOneWh,
  verifyEvidenceFile,
  verifyEvidenceInterval,
} from "../lib/evidence-file";
import { verifyEvidencePackage } from "../lib/evidence";

interface GoldenFixture {
  package: EvidencePackage;
  expected: { manifestHash: string; merkleRoot: string };
}

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/evidence-package.golden.json", import.meta.url), "utf8"),
) as GoldenFixture;

test("Golden package serializes deterministically, parses and verifies", async () => {
  const first = serializeEvidencePackage(fixture.package);
  const second = serializeEvidencePackage(fixture.package);
  assert.equal(first, second);

  const parsed = parseEvidencePackage(first);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.evidencePackage.manifestHash, fixture.expected.manifestHash);
  assert.equal(parsed.evidencePackage.manifest.merkleRoot, fixture.expected.merkleRoot);

  const verification = await verifyEvidencePackage(parsed.evidencePackage);
  assert.equal(verification.valid, true);
  assert.ok(Object.values(verification.checks).every(Boolean));
});

test("download metadata uses safe deterministic filename and MIME type", async () => {
  const unsafe = structuredClone(fixture.package);
  unsafe.scenarioId = "../../Cambridge Pilot <script>";
  const filename = evidencePackageFilename(unsafe);
  assert.match(filename, /^greenproof-[a-z0-9-]+-evidence-v[0-9-]+\.json$/);
  assert.equal(filename.includes(".."), false);
  assert.equal(filename.includes("/"), false);

  const blob = createEvidencePackageBlob(fixture.package);
  assert.equal(blob.type, `${EVIDENCE_PACKAGE_MIME_TYPE};charset=utf-8`);
  assert.equal(await blob.text(), serializeEvidencePackage(fixture.package));
});

test("invalid, empty, missing, unsupported and oversized inputs return structured errors", () => {
  const invalid = parseEvidencePackage("not json");
  const empty = parseEvidencePackage("  ");
  const missing = parseEvidencePackage('{"schemaVersion":"1.0.0"}');
  const wrongSchema = parseEvidencePackage('{"schemaVersion":"2.0.0"}');
  const oversized = parseEvidencePackage("{}", MAX_EVIDENCE_PACKAGE_BYTES + 1);

  assert.equal(invalid.ok ? "" : invalid.error.code, "INVALID_JSON");
  assert.equal(empty.ok ? "" : empty.error.code, "EMPTY_FILE");
  assert.equal(missing.ok ? "" : missing.error.code, "INVALID_PACKAGE");
  assert.equal(wrongSchema.ok ? "" : wrongSchema.error.code, "UNSUPPORTED_SCHEMA");
  assert.equal(oversized.ok ? "" : oversized.error.code, "FILE_TOO_LARGE");
});

test("one Wh tamper remains parseable but fails the real verifier", async () => {
  const tampered = tamperEvidencePackageOneWh(fixture.package);
  assert.equal(tampered.intervals[0].generationWh, fixture.package.intervals[0].generationWh + 1);
  const result = await verifyEvidenceFile(serializeEvidencePackage(tampered));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.verification.valid, false);
  assert.equal(result.verification.checks.canonicalIntervalResultHash, false);
  assert.equal(result.verification.checks.merkleRoot, false);
});

test("single-interval helper recomputes inclusion proof from content and nonce", async () => {
  const valid = await verifyEvidenceInterval(fixture.package, 0);
  assert.deepEqual(valid, {
    leafIndex: 0,
    pathLength: fixture.package.proofs[0].path.length,
    valid: true,
  });

  const tampered = tamperEvidencePackageOneWh(fixture.package);
  const invalid = await verifyEvidenceInterval(tampered, 0);
  assert.equal(invalid.valid, false);
});

test("Evidence UI is wired to package generation, independent verification and real tampering", async () => {
  const source = await readFile(new URL("../components/GreenProofApp.tsx", import.meta.url), "utf8");
  assert.match(source, /buildEvidencePackage\(evidenceScenario, rule\)/);
  assert.match(source, /verifyEvidencePackage\(evidencePackage\)/);
  assert.match(source, /verification\.checks\[checkId\]/);
  assert.match(source, /tamperEvidencePackageOneWh\(evidenceSession\.originalPackage\)/);
  assert.match(source, /verifyEvidenceFile\(await file\.text\(\), file\.size\)/);
  assert.doesNotMatch(source, /Source manifest unchanged/);
  assert.doesNotMatch(source, /setVerifyTamper/);
});
