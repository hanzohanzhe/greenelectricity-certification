import type { Attestation, EvidenceManifest, IntervalAllocation, Scenario } from "./contracts";
import { ENGINE_VERSION, summarise } from "./energy-engine";

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

export async function buildEvidence(
  scenario: Scenario,
  intervals: IntervalAllocation[],
) {
  const leaves = intervals.map((interval, index) =>
    canonicalJson({ interval, nonce: `${scenario.id}:nonce:v1:${index}` }),
  );
  const tree = await merkleTree(leaves);
  const resultSha256 = await sha256(canonicalJson(intervals));
  const rule = {
    id: intervals[0].ruleId,
    version: "1.0.0" as const,
    ...(intervals[0].ruleId === "priority_v1"
      ? { priority: ["tenant-a", "tenant-b"] }
      : intervals[0].ruleId === "contract_share_v1"
        ? { shares: { "tenant-a": 0.6, "tenant-b": 0.4 } }
        : {}),
  };
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
    allocationRule: rule,
    engineVersion: ENGINE_VERSION,
    transformationVersion: "greenproof-scenario-builder/1.0.0",
    resultSha256,
    merkleRoot: tree.root,
    nonceStrategy: "Deterministic versioned demo nonce; production disclosure packages use random nonces.",
    limitations: [
      "Demonstration using public, anonymous and modelled data; not an official energy certificate.",
      "Hashing proves post-commitment integrity, not truth at the source and not anonymity.",
      "Blockchain anchoring is not enabled.",
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
    ruleId: intervals[0].ruleId,
    manifestHash,
    merkleRoot: tree.root,
    verificationUrl: `/?view=evidence&proof=${manifestHash.slice(0, 16)}`,
    blockchainAnchoring: "not_enabled",
  };
  return { manifest, manifestHash, attestation, tree };
}
