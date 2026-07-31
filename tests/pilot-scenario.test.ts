import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scenario } from "../lib/contracts";
import { PILOT_ROOFTOP_CAPACITY_KWP, preparePilotScenario } from "../lib/pilot-scenario";

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
  assert.ok(pvPeakWh > Math.max(...tenantPeaksWh));
  assert.ok(pvPeakWh < 20_000);
});

test("pilot scaling is deterministic and does not mutate source scenarios", async () => {
  const raw = JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario;
  const originalPeak = Math.max(...raw.site.generation.points.map((point) => point.energyWh));
  assert.deepEqual(preparePilotScenario(raw), preparePilotScenario(raw));
  assert.equal(Math.max(...raw.site.generation.points.map((point) => point.energyWh)), originalPeak);
});
