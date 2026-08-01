import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scenario } from "../lib/contracts";
import { explainTenantGreenShortfall, matchScenario } from "../lib/energy-engine";
import { buildEvidencePackage, verifyEvidencePackage } from "../lib/evidence";
import {
  PILOT_LOAD_SHAPES,
  PILOT_ROOFTOP_CAPACITY_KWP,
  PILOT_ROOFTOP_PEAK_W,
  PILOT_TENANT_LIMIT,
  preparePilotScenario,
} from "../lib/pilot-scenario";

const scenarioUrl = new URL("../public/data/scenarios/cambridge-campus-real.json", import.meta.url);
const proRataRule = { id: "pro_rata_demand_v1", version: "1.0.0" } as const;

async function pilotScenario() {
  return preparePilotScenario(JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario);
}

test("pilot builds one 100 kW-peak roof and eight distinct approximately 10 kW users", async () => {
  const scenario = await pilotScenario();
  const pvPeakWh = Math.max(...scenario.site.generation.points.map((point) => point.energyWh));
  const tenantPeaksWh = scenario.site.tenants.map((tenant) =>
    Math.max(...tenant.demand.points.map((point) => point.energyWh)),
  );
  const normalisedShapes = scenario.site.tenants.map((tenant) => {
    const peak = Math.max(...tenant.demand.points.map((point) => point.energyWh));
    return tenant.demand.points.map((point) => Math.round((point.energyWh / peak) * 1000)).join(",");
  });

  assert.equal(scenario.site.generation.capacityKwp, PILOT_ROOFTOP_CAPACITY_KWP);
  assert.equal(pvPeakWh, PILOT_ROOFTOP_PEAK_W);
  assert.equal(scenario.site.tenants.length, PILOT_TENANT_LIMIT);
  assert.deepEqual(tenantPeaksWh, PILOT_LOAD_SHAPES.map((shape) => shape.peakW));
  assert.ok(tenantPeaksWh.every((peak) => peak >= 9_000 && peak <= 11_000));
  assert.equal(new Set(normalisedShapes).size, PILOT_TENANT_LIMIT);
  assert.equal(scenario.site.generation.points.length, 365 * 24);
  assert.equal(scenario.site.generation.points[0].startUtc, "2022-01-01T00:00:00.000Z");
  assert.equal(scenario.site.generation.points.at(-1)?.endUtc, "2023-01-01T00:00:00.000Z");
});

test("annual pilot has seasonal PV and weekday-sensitive demand", async () => {
  const scenario = await pilotScenario();
  const dailyGeneration = Array.from({ length: 365 }, (_, day) =>
    scenario.site.generation.points
      .slice(day * 24, (day + 1) * 24)
      .reduce((sum, point) => sum + point.energyWh, 0),
  );
  const januaryAverage = dailyGeneration.slice(0, 31).reduce((sum, value) => sum + value, 0) / 31;
  const juneAverage = dailyGeneration.slice(151, 181).reduce((sum, value) => sum + value, 0) / 30;
  assert.ok(juneAverage > januaryAverage * 2);

  const tenant = scenario.site.tenants[0];
  const monday = tenant.demand.points.slice(2 * 24, 3 * 24).reduce((sum, point) => sum + point.energyWh, 0);
  const sunday = tenant.demand.points.slice(1 * 24, 2 * 24).reduce((sum, point) => sum + point.energyWh, 0);
  assert.ok(monday > sunday);
});

test("eight-user intervals conserve every Wh and cap every user allocation", async () => {
  const scenario = await pilotScenario();
  const tenantIds = scenario.site.tenants.map((tenant) => tenant.id);
  const rules = [
    proRataRule,
    { id: "priority_v1", version: "1.0.0", priority: tenantIds } as const,
    { id: "contract_share_v1", version: "1.0.0", shares: Object.fromEntries(tenantIds.map((id) => [id, 1])) } as const,
  ];
  for (const rule of rules) {
    const intervals = matchScenario(scenario, rule);
    for (let intervalIndex = 0; intervalIndex < intervals.length; intervalIndex += 1) {
      const interval = intervals[intervalIndex];
      assert.equal(
        Object.values(interval.tenantAllocationsWh).reduce((sum, value) => sum + value, 0),
        interval.onsiteMatchedWh,
      );
      assert.equal(
        Object.values(interval.tenantGridImportWh).reduce((sum, value) => sum + value, 0),
        interval.gridImportWh,
      );
      scenario.site.tenants.forEach((tenant) => {
        assert.ok(interval.tenantAllocationsWh[tenant.id] <= tenant.demand.points[intervalIndex].energyWh);
      });
    }
  }
});

test("eight-user EvidencePackage verifies and a one Wh user change fails", async () => {
  const scenario = await pilotScenario();
  const evidencePackage = await buildEvidencePackage(scenario, proRataRule);
  assert.equal((await verifyEvidencePackage(evidencePackage)).valid, true);

  const tampered = structuredClone(evidencePackage);
  tampered.scenario.site.tenants[7].demand.points[12].energyWh += 1;
  const result = await verifyEvidencePackage(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.checks.canonicalIntervalResultHash, false);
});

test("pilot generation is deterministic and does not mutate source scenarios", async () => {
  const raw = JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario;
  const original = structuredClone(raw);
  assert.deepEqual(preparePilotScenario(raw), preparePilotScenario(raw));
  assert.deepEqual(raw, original);
});

test("tenant shortfall explanations reconcile and report the overflowing PV peak", async () => {
  const scenario = await pilotScenario();
  const intervals = matchScenario(scenario, proRataRule);
  const peakGenerationWh = Math.max(...intervals.map((interval) => interval.generationWh));

  for (const tenant of scenario.site.tenants) {
    const explanation = explainTenantGreenShortfall(scenario, intervals, tenant.id);
    assert.equal(
      explanation.noGenerationWh +
        explanation.simultaneousSiteShortageWh +
        explanation.competingAllocationWh,
      explanation.unmetWh,
    );
    assert.equal(explanation.peak.generationWh, peakGenerationWh);
    assert.equal(explanation.peak.generationExceedsAllDemand, true);
    assert.ok(explanation.peak.exportWh > 0);
    assert.equal(explanation.ruleId, proRataRule.id);
  }
});

test("tenant shortfall explanation rejects an unknown user", async () => {
  const scenario = await pilotScenario();
  const intervals = matchScenario(scenario, proRataRule);
  assert.throws(
    () => explainTenantGreenShortfall(scenario, intervals, "not-a-tenant"),
    /Unknown tenant/,
  );
});
