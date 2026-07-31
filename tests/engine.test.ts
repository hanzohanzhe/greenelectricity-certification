import assert from "node:assert/strict";
import test from "node:test";
import type { AllocationRule, Scenario, TimeSeriesPoint } from "../lib/contracts";
import { DEFAULT_RULES, matchScenario, summarise } from "../lib/energy-engine";
import { buildEvidence, canonicalJson, sha256 } from "../lib/evidence";

function point(index: number, energyWh: number): TimeSeriesPoint {
  const start = new Date(Date.UTC(2025, 5, 1, 0, index * 30));
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    energyWh,
    provenance: "user_provided",
    qualityFlags: [],
    sourceRecordId: `golden:${index}`,
  };
}

function scenario(generation: number[], demandA: number[], demandB: number[]): Scenario {
  return {
    schemaVersion: "1.0.0",
    id: "golden",
    label: "Golden dataset",
    description: "Deterministic test",
    representativeDay: "2025-06-01",
    granularityMinutes: 30,
    alignment: "same_day",
    site: {
      id: "site",
      label: "Test site",
      locationLabel: "Test",
      generation: { id: "pv", label: "PV", capacityKwp: 1, points: generation.map((value, index) => point(index, value)) },
      tenants: [
        {
          id: "tenant-a",
          label: "A",
          description: "A",
          demand: { id: "a", label: "A", points: demandA.map((value, index) => point(index, value)) },
        },
        {
          id: "tenant-b",
          label: "B",
          description: "B",
          demand: { id: "b", label: "B", points: demandB.map((value, index) => point(index, value)) },
        },
      ],
    },
    sources: [],
    qualitySummary: [],
  };
}

function assertConservation(input: Scenario, rule: AllocationRule) {
  const output = matchScenario(input, rule);
  output.forEach((interval, index) => {
    const a = interval.tenantAllocationsWh["tenant-a"];
    const b = interval.tenantAllocationsWh["tenant-b"];
    assert.equal(a + b, interval.onsiteMatchedWh);
    assert.equal(interval.onsiteMatchedWh + interval.exportWh, interval.generationWh);
    assert.equal(
      interval.tenantGridImportWh["tenant-a"] + interval.tenantGridImportWh["tenant-b"],
      interval.gridImportWh,
    );
    assert.ok(a <= input.site.tenants[0].demand.points[index].energyWh);
    assert.ok(b <= input.site.tenants[1].demand.points[index].energyWh);
    Object.values(interval).forEach((value) => {
      if (typeof value === "number") assert.ok(value >= 0);
    });
  });
}

test("48-interval golden dataset conserves every Wh under all rules", () => {
  const generation = Array.from({ length: 48 }, (_, index) =>
    index >= 12 && index <= 35 ? Math.round(Math.sin(((index - 12) / 23) * Math.PI) * 3601) : 0,
  );
  const demandA = Array.from({ length: 48 }, (_, index) => (index >= 15 && index <= 35 ? 1701 : 301));
  const demandB = Array.from({ length: 48 }, (_, index) => 899 + (index % 3));
  const input = scenario(generation, demandA, demandB);
  DEFAULT_RULES.forEach((rule) => assertConservation(input, rule));
  const summary = summarise(input, matchScenario(input, DEFAULT_RULES[0]));
  assert.equal(summary.generationWh, generation.reduce((sum, value) => sum + value, 0));
});

test("randomised inputs satisfy conservation and demand caps", () => {
  let seed = 0x2f6e2b1;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let run = 0; run < 500; run += 1) {
    const input = scenario(
      [Math.floor(random() * 1_000_000)],
      [Math.floor(random() * 1_000_000)],
      [Math.floor(random() * 1_000_000)],
    );
    DEFAULT_RULES.forEach((rule) => assertConservation(input, rule));
  }
});

test("canonical JSON ignores object key order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test("a one Wh tamper changes result hash and Merkle root", async () => {
  const input = scenario([1, 200], [1, 100], [1, 100]);
  const original = matchScenario(input, DEFAULT_RULES[0]);
  const changed = structuredClone(original);
  changed[1].generationWh += 1;
  assert.notEqual(await sha256(canonicalJson(original)), await sha256(canonicalJson(changed)));
  const originalProof = await buildEvidence(input, original);
  const changedProof = await buildEvidence(input, changed);
  assert.notEqual(originalProof.tree.root, changedProof.tree.root);
});

test("missing, overlapping or mismatched intervals are rejected", () => {
  const input = scenario([10, 20], [5, 10], [5, 10]);
  input.site.tenants[1].demand.points[1].startUtc = input.site.tenants[1].demand.points[0].startUtc;
  assert.throws(() => matchScenario(input, DEFAULT_RULES[0]), /mismatch/i);
});
