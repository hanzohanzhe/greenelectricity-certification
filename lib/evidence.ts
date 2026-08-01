import type {
  AllocationRule,
  Attestation,
  EvidenceCheckId,
  EvidenceManifest,
  EvidencePackage,
  IntervalAllocation,
  IntervalProof,
  MerkleProofNode,
  Scenario,
  VerificationIssue,
  VerificationResult,
} from "./contracts";
import { ENGINE_VERSION, matchScenario, summarise } from "./energy-engine";

export const EVIDENCE_PACKAGE_VERSION = "1.0.0" as const;

const CHECK_IDS: EvidenceCheckId[] = [
  "canonicalIntervalResultHash",
  "merkleRoot",
  "inclusionProofs",
  "manifestHash",
  "attestationBinding",
  "scenarioId",
  "period",
  "rule",
  "totals",
];

const ALLOCATION_RULE_IDS = new Set([
  "pro_rata_demand_v1",
  "priority_v1",
  "contract_share_v1",
]);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function requireSha256(value: unknown, label: string): asserts value is string {
  if (!isSha256(value)) throw new Error(`${label} must be a lowercase 64-character SHA-256 hex string`);
}

function requireNonce(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length) throw new Error("nonce must be a non-empty string");
}

function intervalLeaf(interval: IntervalAllocation, nonce: string): string {
  requireNonce(nonce);
  return canonicalJson({ interval, nonce });
}

function demoNonce(scenarioId: string, leafIndex: number): string {
  return `${scenarioId}:nonce:v1:${leafIndex}`;
}

export async function merkleTree(leaves: string[]) {
  if (!leaves.length) throw new Error("Merkle tree requires at least one leaf");
  const levels: string[][] = [await Promise.all(leaves.map(sha256))];
  while (levels.at(-1)!.length > 1) {
    const current = levels.at(-1)!;
    const next: string[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index];
      const right = current[index + 1] ?? left;
      next.push(await sha256(left + right));
    }
    levels.push(next);
  }
  return { root: levels.at(-1)![0], levels };
}

function expectedPathLength(leafCount: number): number {
  if (!Number.isInteger(leafCount) || leafCount < 1) {
    throw new Error("leafCount must be a positive integer");
  }
  let width = leafCount;
  let depth = 0;
  while (width > 1) {
    width = Math.ceil(width / 2);
    depth += 1;
  }
  return depth;
}

function proofFromLevels(
  levels: string[][],
  leafIndex: number,
  nonce: string,
): IntervalProof {
  if (!levels.length || !levels[0].length) throw new Error("Merkle tree is empty");
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= levels[0].length) {
    throw new Error(`leafIndex ${leafIndex} is outside the Merkle tree`);
  }
  requireNonce(nonce);
  const path: MerkleProofNode[] = [];
  let index = leafIndex;
  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const level = levels[levelIndex];
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;
    path.push({
      siblingHash: level[siblingIndex] ?? level[index],
      position: isRightNode ? "left" : "right",
    });
    index = Math.floor(index / 2);
  }
  return { leafIndex, leafHash: levels[0][leafIndex], nonce, path };
}

export async function generateMerkleProof(
  intervals: IntervalAllocation[],
  nonces: string[],
  leafIndex: number,
): Promise<IntervalProof> {
  if (!intervals.length) throw new Error("Cannot generate a proof for an empty interval set");
  if (nonces.length !== intervals.length) {
    throw new Error("Every interval must have exactly one nonce");
  }
  nonces.forEach(requireNonce);
  const leaves = intervals.map((interval, index) => intervalLeaf(interval, nonces[index]));
  const tree = await merkleTree(leaves);
  return proofFromLevels(tree.levels, leafIndex, nonces[leafIndex]);
}

export async function verifyMerkleProof(
  interval: IntervalAllocation,
  proof: IntervalProof,
  expectedRoot: string,
  leafCount: number,
): Promise<boolean> {
  requireSha256(expectedRoot, "expectedRoot");
  if (!Number.isInteger(proof.leafIndex) || proof.leafIndex < 0 || proof.leafIndex >= leafCount) {
    throw new Error(`leafIndex ${proof.leafIndex} is outside a tree with ${leafCount} leaves`);
  }
  requireNonce(proof.nonce);
  requireSha256(proof.leafHash, "leafHash");
  if (!Array.isArray(proof.path)) throw new Error("proof path must be an array");
  const requiredLength = expectedPathLength(leafCount);
  if (proof.path.length !== requiredLength) {
    throw new Error(`proof path length ${proof.path.length} does not match required length ${requiredLength}`);
  }

  let currentHash = await sha256(intervalLeaf(interval, proof.nonce));
  if (currentHash !== proof.leafHash) return false;
  let index = proof.leafIndex;
  let width = leafCount;
  for (const node of proof.path) {
    if (node.position !== "left" && node.position !== "right") {
      throw new Error(`invalid Merkle proof position: ${String(node.position)}`);
    }
    requireSha256(node.siblingHash, "siblingHash");
    const expectedPosition = index % 2 === 1 ? "left" : "right";
    if (node.position !== expectedPosition) return false;
    if (index % 2 === 0 && index + 1 >= width && node.siblingHash !== currentHash) return false;
    currentHash =
      node.position === "left"
        ? await sha256(node.siblingHash + currentHash)
        : await sha256(currentHash + node.siblingHash);
    index = Math.floor(index / 2);
    width = Math.ceil(width / 2);
  }
  return currentHash === expectedRoot;
}

function allocationRuleFromIntervals(intervals: IntervalAllocation[]): AllocationRule {
  if (!intervals.length) throw new Error("Evidence requires at least one interval");
  const id = intervals[0].ruleId;
  const tenantIds = Object.keys(intervals[0].tenantAllocationsWh);
  return {
    id,
    version: "1.0.0",
    ...(id === "priority_v1"
      ? { priority: tenantIds }
      : id === "contract_share_v1"
        ? { shares: Object.fromEntries(tenantIds.map((tenantId) => [tenantId, 1])) }
        : {}),
  };
}

async function buildEvidenceCore(
  scenario: Scenario,
  intervals: IntervalAllocation[],
  allocationRule: AllocationRule,
) {
  if (!intervals.length) throw new Error("Evidence requires at least one interval");
  const nonces = intervals.map((_, index) => demoNonce(scenario.id, index));
  const leaves = intervals.map((interval, index) => intervalLeaf(interval, nonces[index]));
  const tree = await merkleTree(leaves);
  const resultSha256 = await sha256(canonicalJson(intervals));
  const scenarioSha256 = await sha256(canonicalJson(scenario));
  const manifest: EvidenceManifest = {
    schemaVersion: "1.0.0",
    scenarioId: scenario.id,
    generatedAt: "2026-07-31T00:00:00.000Z",
    sources: scenario.sources,
    period: {
      startUtc: intervals[0].startUtc,
      endUtc: intervals.at(-1)!.endUtc,
      granularityMinutes: scenario.granularityMinutes,
    },
    alignment: scenario.alignment,
    allocationRule,
    engineVersion: ENGINE_VERSION,
    transformationVersion: "greenproof-scenario-builder/1.0.0",
    scenarioSha256,
    resultSha256,
    merkleRoot: tree.root,
    nonceStrategy:
      "Deterministic versioned demo nonces for reproducibility; they are not production privacy protection.",
    limitations: [
      "Demonstration using public, anonymous and modelled data; not an official energy certificate.",
      "Hashing proves package consistency after generation, not truth at the source or issuer identity.",
      "No trusted timestamp, digital signature or blockchain anchoring is enabled.",
    ],
  };
  const manifestHash = await sha256(canonicalJson(manifest));
  const totals = summarise(scenario, intervals);
  const attestation: Attestation = {
    proofId: `GP-DEMO-${manifestHash.slice(0, 12).toUpperCase()}`,
    status: "demonstration",
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    period: { startUtc: intervals[0].startUtc, endUtc: intervals.at(-1)!.endUtc },
    totalsWh: {
      generation: totals.generationWh,
      onsiteMatched: totals.onsiteMatchedWh,
      tenantAllocations: totals.tenantAllocationWh,
    },
    ruleId: allocationRule.id,
    ruleVersion: allocationRule.version,
    manifestHash,
    merkleRoot: tree.root,
    verificationUrl: `/?view=evidence&proof=${manifestHash.slice(0, 16)}`,
    blockchainAnchoring: "not_enabled",
  };
  const proofs = intervals.map((_, index) => proofFromLevels(tree.levels, index, nonces[index]));
  return { manifest, manifestHash, attestation, tree, proofs };
}

/** Backward-compatible wrapper used by the current UI. */
export async function buildEvidence(
  scenario: Scenario,
  intervals: IntervalAllocation[],
  allocationRule: AllocationRule = allocationRuleFromIntervals(intervals),
) {
  return buildEvidenceCore(scenario, intervals, allocationRule);
}

export async function buildEvidencePackage(
  scenario: Scenario,
  allocationRule: AllocationRule,
): Promise<EvidencePackage> {
  const intervals = matchScenario(scenario, allocationRule);
  const evidence = await buildEvidenceCore(scenario, intervals, allocationRule);
  return {
    schemaVersion: EVIDENCE_PACKAGE_VERSION,
    scenarioId: scenario.id,
    scenario,
    intervals,
    manifest: evidence.manifest,
    manifestHash: evidence.manifestHash,
    attestation: evidence.attestation,
    proofs: evidence.proofs,
  };
}

function emptyChecks(): Record<EvidenceCheckId, boolean> {
  return Object.fromEntries(CHECK_IDS.map((id) => [id, false])) as Record<EvidenceCheckId, boolean>;
}

function securityWarnings(): VerificationIssue[] {
  return [
    {
      code: "NO_TRUSTED_ISSUER",
      check: "package",
      message: "The package has no issuer signature and cannot prove who created or authorised it.",
    },
    {
      code: "NO_TRUSTED_TIMESTAMP",
      check: "package",
      message: "The package has no trusted external timestamp or anchoring service.",
    },
    {
      code: "DETERMINISTIC_DEMO_NONCES",
      check: "package",
      message: "The deterministic demo nonces provide reproducibility, not production privacy protection.",
    },
    {
      code: "NOT_OFFICIAL_CERTIFICATE",
      check: "package",
      message: "Successful verification shows internal consistency only, not legal certificate status or source-meter truth.",
    },
  ];
}

function failure(code: string, message: string): VerificationResult {
  return {
    valid: false,
    checks: emptyChecks(),
    errors: [{ code, check: "package", message }],
    warnings: securityWarnings(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  errors: VerificationIssue[],
  check: EvidenceCheckId,
  code: string,
  message: string,
  details: Pick<VerificationIssue, "path" | "leafIndex"> = {},
) {
  errors.push({ code, check, message, ...details });
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/**
 * Independently verifies an untrusted serialized or parsed evidence package.
 * It proves package self-consistency only. Without an issuer signature or a
 * trusted external timestamp, a fully rewritten and re-hashed package can also
 * verify successfully and still have no trusted provenance.
 */
export async function verifyEvidencePackage(input: unknown): Promise<VerificationResult> {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      return failure("INVALID_JSON", "Evidence package is not valid JSON");
    }
  }
  if (!isRecord(parsed)) return failure("INVALID_PACKAGE", "Evidence package must be a JSON object");
  if (
    parsed.schemaVersion !== EVIDENCE_PACKAGE_VERSION ||
    typeof parsed.scenarioId !== "string" ||
    !isRecord(parsed.scenario) ||
    !Array.isArray(parsed.intervals) ||
    !parsed.intervals.length ||
    !isRecord(parsed.manifest) ||
    typeof parsed.manifestHash !== "string" ||
    !isRecord(parsed.attestation) ||
    !Array.isArray(parsed.proofs)
  ) {
    return failure("MALFORMED_PACKAGE", "Evidence package is missing required versioned fields");
  }

  const evidencePackage = parsed as unknown as EvidencePackage;
  const result: VerificationResult = {
    valid: false,
    checks: emptyChecks(),
    errors: [],
    warnings: securityWarnings(),
  };

  try {
    const scenarioIdValid =
      evidencePackage.scenarioId === evidencePackage.scenario.id &&
      evidencePackage.scenarioId === evidencePackage.manifest.scenarioId &&
      evidencePackage.scenarioId === evidencePackage.attestation.scenarioId;
    result.checks.scenarioId = scenarioIdValid;
    if (!scenarioIdValid) {
      issue(result.errors, "scenarioId", "SCENARIO_ID_MISMATCH", "Scenario IDs are not consistently bound");
    }

    const rule = evidencePackage.manifest.allocationRule;
    const ruleShapeValid =
      isRecord(rule) &&
      ALLOCATION_RULE_IDS.has(String(rule.id)) &&
      rule.version === "1.0.0" &&
      evidencePackage.intervals.every(
        (interval) => interval.ruleId === rule.id && interval.ruleVersion === rule.version,
      ) &&
      evidencePackage.attestation.ruleId === rule.id &&
      evidencePackage.attestation.ruleVersion === rule.version;
    result.checks.rule = ruleShapeValid;
    if (!ruleShapeValid) {
      issue(result.errors, "rule", "RULE_BINDING_MISMATCH", "Rule ID or version is invalid or inconsistently bound");
    }

    const firstInterval = evidencePackage.intervals[0];
    const lastInterval = evidencePackage.intervals.at(-1)!;
    const periodValid =
      isRecord(evidencePackage.manifest.period) &&
      evidencePackage.manifest.period.startUtc === firstInterval.startUtc &&
      evidencePackage.manifest.period.endUtc === lastInterval.endUtc &&
      evidencePackage.manifest.period.granularityMinutes === evidencePackage.scenario.granularityMinutes &&
      evidencePackage.attestation.period.startUtc === firstInterval.startUtc &&
      evidencePackage.attestation.period.endUtc === lastInterval.endUtc;
    result.checks.period = periodValid;
    if (!periodValid) {
      issue(result.errors, "period", "PERIOD_MISMATCH", "Manifest or attestation period does not match the intervals");
    }

    let expectedIntervals: IntervalAllocation[] | null = null;
    if (ruleShapeValid) {
      try {
        expectedIntervals = matchScenario(evidencePackage.scenario, rule);
      } catch (error) {
        issue(
          result.errors,
          "canonicalIntervalResultHash",
          "SCENARIO_RECOMPUTE_FAILED",
          error instanceof Error ? error.message : "Scenario could not be recomputed",
        );
      }
    }
    const recomputedResultHash = await sha256(canonicalJson(evidencePackage.intervals));
    const recomputedScenarioHash = await sha256(canonicalJson(evidencePackage.scenario));
    const intervalResultValid =
      evidencePackage.manifest.schemaVersion === "1.0.0" &&
      canonicalEqual(evidencePackage.manifest.sources, evidencePackage.scenario.sources) &&
      evidencePackage.manifest.alignment === evidencePackage.scenario.alignment &&
      evidencePackage.manifest.engineVersion === ENGINE_VERSION &&
      isSha256(evidencePackage.manifest.resultSha256) &&
      isSha256(evidencePackage.manifest.scenarioSha256) &&
      recomputedResultHash === evidencePackage.manifest.resultSha256 &&
      recomputedScenarioHash === evidencePackage.manifest.scenarioSha256 &&
      expectedIntervals !== null &&
      canonicalEqual(expectedIntervals, evidencePackage.intervals);
    result.checks.canonicalIntervalResultHash = intervalResultValid;
    if (!intervalResultValid) {
      issue(
        result.errors,
        "canonicalIntervalResultHash",
        "INTERVAL_RESULT_MISMATCH",
        "Scenario, interval calculation or canonical result hash does not match",
      );
    }

    const proofCoverageValid =
      evidencePackage.proofs.length === evidencePackage.intervals.length &&
      evidencePackage.proofs.every((proof, index) => proof.leafIndex === index);
    let recomputedTreeRoot = "";
    if (proofCoverageValid) {
      const leaves = evidencePackage.intervals.map((interval, index) =>
        intervalLeaf(interval, evidencePackage.proofs[index].nonce),
      );
      recomputedTreeRoot = (await merkleTree(leaves)).root;
    }
    const merkleRootValid =
      proofCoverageValid &&
      isSha256(evidencePackage.manifest.merkleRoot) &&
      recomputedTreeRoot === evidencePackage.manifest.merkleRoot;
    result.checks.merkleRoot = merkleRootValid;
    if (!merkleRootValid) {
      issue(result.errors, "merkleRoot", "MERKLE_ROOT_MISMATCH", "Recomputed Merkle root does not match the manifest");
    }

    let inclusionProofsValid = proofCoverageValid && merkleRootValid;
    if (proofCoverageValid && isSha256(evidencePackage.manifest.merkleRoot)) {
      for (let index = 0; index < evidencePackage.proofs.length; index += 1) {
        try {
          const valid = await verifyMerkleProof(
            evidencePackage.intervals[index],
            evidencePackage.proofs[index],
            evidencePackage.manifest.merkleRoot,
            evidencePackage.intervals.length,
          );
          if (!valid) {
            inclusionProofsValid = false;
            issue(result.errors, "inclusionProofs", "INVALID_INCLUSION_PROOF", "Merkle inclusion proof failed", {
              leafIndex: index,
            });
          }
        } catch (error) {
          inclusionProofsValid = false;
          issue(
            result.errors,
            "inclusionProofs",
            "MALFORMED_INCLUSION_PROOF",
            error instanceof Error ? error.message : "Merkle proof is malformed",
            { leafIndex: index },
          );
        }
      }
    } else {
      inclusionProofsValid = false;
      issue(result.errors, "inclusionProofs", "PROOF_COVERAGE_MISMATCH", "Proofs must cover every interval exactly once");
    }
    result.checks.inclusionProofs = inclusionProofsValid;

    const recomputedManifestHash = await sha256(canonicalJson(evidencePackage.manifest));
    const manifestHashValid =
      isSha256(evidencePackage.manifestHash) && recomputedManifestHash === evidencePackage.manifestHash;
    result.checks.manifestHash = manifestHashValid;
    if (!manifestHashValid) {
      issue(result.errors, "manifestHash", "MANIFEST_HASH_MISMATCH", "Recomputed manifest hash does not match");
    }

    let totalsValid = false;
    try {
      const totals = summarise(evidencePackage.scenario, evidencePackage.intervals);
      totalsValid = canonicalEqual(evidencePackage.attestation.totalsWh, {
        generation: totals.generationWh,
        onsiteMatched: totals.onsiteMatchedWh,
        tenantAllocations: totals.tenantAllocationWh,
      });
    } catch {
      totalsValid = false;
    }
    result.checks.totals = totalsValid;
    if (!totalsValid) {
      issue(result.errors, "totals", "TOTALS_MISMATCH", "Attestation totals do not match the interval results");
    }

    const expectedProofId = `GP-DEMO-${recomputedManifestHash.slice(0, 12).toUpperCase()}`;
    const expectedVerificationUrl = `/?view=evidence&proof=${recomputedManifestHash.slice(0, 16)}`;
    const attestationBindingValid =
      evidencePackage.attestation.manifestHash === recomputedManifestHash &&
      evidencePackage.attestation.merkleRoot === evidencePackage.manifest.merkleRoot &&
      evidencePackage.attestation.proofId === expectedProofId &&
      evidencePackage.attestation.scenarioLabel === evidencePackage.scenario.label &&
      evidencePackage.attestation.verificationUrl === expectedVerificationUrl &&
      evidencePackage.attestation.status === "demonstration" &&
      evidencePackage.attestation.blockchainAnchoring === "not_enabled";
    result.checks.attestationBinding = attestationBindingValid;
    if (!attestationBindingValid) {
      issue(
        result.errors,
        "attestationBinding",
        "ATTESTATION_BINDING_MISMATCH",
        "Attestation is not bound to the recomputed manifest hash and Merkle root",
      );
    }
  } catch (error) {
    result.errors.push({
      code: "MALFORMED_PACKAGE",
      check: "package",
      message: error instanceof Error ? error.message : "Evidence package validation failed",
    });
  }

  result.valid = CHECK_IDS.every((id) => result.checks[id]) && result.errors.length === 0;
  return result;
}
