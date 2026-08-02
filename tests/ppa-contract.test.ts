import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scenario } from "../lib/contracts";
import { matchScenario } from "../lib/energy-engine";
import { preparePilotScenario } from "../lib/pilot-scenario";
import { type PpaContractDraft, convertPpaContract } from "../lib/ppa-contract";

const scenarioUrl = new URL("../public/data/scenarios/cambridge-campus-real.json", import.meta.url);

async function pilotScenario() {
  return preparePilotScenario(JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario);
}

function validDraft(): PpaContractDraft {
  return {
    reference: "CAM-PPA-001",
    effectiveFrom: "2022-01-01",
    effectiveTo: "2023-01-01",
    pricePencePerKwh: 14.5,
    allocationBasis: "same_interval_generation_share",
    unusedEntitlement: "redistribute_to_active_loads",
    certificateTreatment: "retained_by_owner",
    tenantSharesPercent: {
      "tenant-a": 20,
      "tenant-b": 15,
      "tenant-c": 15,
      "tenant-d": 12.5,
      "tenant-e": 12.5,
      "tenant-f": 10,
      "tenant-g": 10,
      "tenant-h": 5,
    },
  };
}

test("PPA terms convert deterministically to contract-share engine parameters", async () => {
  const scenario = await pilotScenario();
  const first = convertPpaContract(scenario, validDraft());
  const second = convertPpaContract(scenario, validDraft());
  assert.equal(first.valid, true);
  assert.deepEqual(first, second);
  assert.equal(first.totalSharePercent, 100);
  assert.equal(first.allocationRule?.id, "contract_share_v1");
  assert.equal(first.allocationRule?.shares?.["tenant-a"], 0.2);
  assert.equal(first.allocationRule?.shares?.["tenant-h"], 0.05);
  assert.equal(first.modelParameters.tenantDemandCap, true);
});

test("simple metered tariff converts to demand-led allocation without tenant shares", async () => {
  const scenario = await pilotScenario();
  const draft = validDraft();
  draft.allocationBasis = "metered_onsite_consumption";
  draft.unusedEntitlement = "not_applicable";
  draft.tenantSharesPercent["tenant-a"] = 0;
  const converted = convertPpaContract(scenario, draft);
  assert.equal(converted.valid, true);
  assert.equal(converted.allocationRule?.id, "pro_rata_demand_v1");
  assert.equal(converted.allocationRule?.shares, undefined);
});

test("converted PPA rule conserves every onsite Wh and caps tenant allocation", async () => {
  const scenario = await pilotScenario();
  const converted = convertPpaContract(scenario, validDraft());
  assert.ok(converted.allocationRule);
  const intervals = matchScenario(scenario, converted.allocationRule);
  intervals.forEach((interval, index) => {
    assert.equal(
      Object.values(interval.tenantAllocationsWh).reduce((sum, value) => sum + value, 0),
      interval.onsiteMatchedWh,
    );
    scenario.site.tenants.forEach((tenant) => {
      assert.ok(interval.tenantAllocationsWh[tenant.id] <= tenant.demand.points[index].energyWh);
    });
  });
});

test("invalid PPA totals, dates and commercial values do not produce a rule", async () => {
  const scenario = await pilotScenario();
  const draft = validDraft();
  draft.tenantSharesPercent["tenant-a"] = 19;
  draft.effectiveTo = draft.effectiveFrom;
  draft.pricePencePerKwh = -1;
  const converted = convertPpaContract(scenario, draft);
  assert.equal(converted.valid, false);
  assert.equal(converted.allocationRule, undefined);
  assert.ok(converted.errors.some((error) => error.includes("100%")));
  assert.ok(converted.errors.some((error) => error.includes("end date")));
  assert.ok(converted.errors.some((error) => error.includes("price")));
});
