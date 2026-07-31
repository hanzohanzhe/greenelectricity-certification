import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scenario } from "../lib/contracts";
import {
  PILOT_ROOFTOP_CAPACITY_KWP,
  PILOT_TENANT_PEAKS_W,
  preparePilotScenario,
} from "../lib/pilot-scenario";

const scenarioUrl = new URL("../public/data/scenarios/cambridge-campus-real.json", import.meta.url);

test("pilot scenario corrects the PV unit error and uses a credible roof scale", async () => {
  const raw = JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario;
  const scenario = preparePilotScenario(raw);
  const pvPeakWh = Math.max(...scenario.site.generation.points.map((point) => point.energyWh));
  const tenantPeaksWh = scenario.site.tenants.map((tenant) =>
    Math.max(...tenant.demand.points.map((point) => point.energyWh)),
  );

  assert.equal(scenario.site.generation.capacityKwp, PILOT_ROOFTOP_CAPACITY_KWP);
  assert.equal(pvPeakWh, 15_480);
  assert.deepEqual(tenantPeaksWh, [PILOT_TENANT_PEAKS_W["tenant-a"], PILOT_TENANT_PEAKS_W["tenant-b"]]);
  assert.ok(pvPeakWh > Math.max(...tenantPeaksWh));
  assert.ok(pvPeakWh < 20_000);
});

test("tenant profiles keep their shapes while using comparable pilot peaks", async () => {
  const raw = JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario;
  const scenario = preparePilotScenario(raw);

  scenario.site.tenants.forEach((tenant, tenantIndex) => {
    const rawPoints = raw.site.tenants[tenantIndex].demand.points;
    const scaledPoints = tenant.demand.points;
    const rawPeak = Math.max(...rawPoints.map((point) => point.energyWh));
    const scaledPeak = Math.max(...scaledPoints.map((point) => point.energyWh));
    const targetPeak = PILOT_TENANT_PEAKS_W[tenant.id as keyof typeof PILOT_TENANT_PEAKS_W];
    assert.equal(scaledPeak, targetPeak);
    assert.ok(Math.abs((scaledPoints[0].energyWh / scaledPeak) - (rawPoints[0].energyWh / rawPeak)) < 0.0001);
    assert.ok(scaledPoints.every((point) => point.provenance === "profile_scaled"));
    assert.ok(scaledPoints.every((point) => point.qualityFlags.includes("pilot_peak_scaled")));
  });
});

test("pilot scaling is deterministic and does not mutate source scenarios", async () => {
  const raw = JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario;
  const originalPeak = Math.max(...raw.site.generation.points.map((point) => point.energyWh));
  assert.deepEqual(preparePilotScenario(raw), preparePilotScenario(raw));
  assert.equal(Math.max(...raw.site.generation.points.map((point) => point.energyWh)), originalPeak);
});
