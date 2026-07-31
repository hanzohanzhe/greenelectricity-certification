import { writeFile } from "node:fs/promises";
import type { AllocationRule, Scenario, TimeSeriesPoint } from "../lib/contracts";
import { buildEvidencePackage } from "../lib/evidence";

function point(index: number, energyWh: number): TimeSeriesPoint {
  const start = new Date(Date.UTC(2025, 5, 1, 0, index * 30));
  return {
    startUtc: start.toISOString(),
    endUtc: new Date(start.getTime() + 30 * 60_000).toISOString(),
    energyWh,
    provenance: "user_provided",
    qualityFlags: [],
    sourceRecordId: `evidence-golden:${index}`,
  };
}

const generation = [0, 1801, 3601, 900, 0];
const demandA = [501, 1001, 1201, 1401, 701];
const demandB = [899, 799, 1099, 599, 999];

const scenario: Scenario = {
  schemaVersion: "1.0.0",
  id: "evidence-golden",
  label: "Evidence Golden Dataset",
  description: "Five fixed half-hour intervals including an odd Merkle leaf count.",
  representativeDay: "2025-06-01",
  granularityMinutes: 30,
  alignment: "same_day",
  site: {
    id: "golden-site",
    label: "Golden site",
    locationLabel: "Test fixture",
    generation: {
      id: "golden-pv",
      label: "Golden PV",
      capacityKwp: 5,
      points: generation.map((value, index) => point(index, value)),
    },
    tenants: [
      {
        id: "tenant-a",
        label: "Tenant A",
        description: "Golden tenant A",
        demand: {
          id: "golden-a",
          label: "Golden A demand",
          points: demandA.map((value, index) => point(index, value)),
        },
      },
      {
        id: "tenant-b",
        label: "Tenant B",
        description: "Golden tenant B",
        demand: {
          id: "golden-b",
          label: "Golden B demand",
          points: demandB.map((value, index) => point(index, value)),
        },
      },
    ],
  },
  sources: [],
  qualitySummary: [],
};

const rule: AllocationRule = { id: "pro_rata_demand_v1", version: "1.0.0" };
const evidencePackage = await buildEvidencePackage(scenario, rule);
const fixture = {
  fixtureVersion: "1.0.0",
  input: { scenario, rule },
  package: evidencePackage,
  expected: {
    manifestHash: evidencePackage.manifestHash,
    merkleRoot: evidencePackage.manifest.merkleRoot,
    nonces: evidencePackage.proofs.map((proof) => proof.nonce),
    firstProof: evidencePackage.proofs[0],
    checks: {
      canonicalIntervalResultHash: true,
      merkleRoot: true,
      inclusionProofs: true,
      manifestHash: true,
      attestationBinding: true,
      scenarioId: true,
      period: true,
      rule: true,
      totals: true,
    },
  },
};

await writeFile(
  new URL("./fixtures/evidence-package.golden.json", import.meta.url),
  `${JSON.stringify(fixture, null, 2)}\n`,
  "utf8",
);
