import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Scenario } from "../lib/contracts";
import {
  DEFAULT_DEVICE_INTERFACE_SELECTION,
  DEVICE_INTERFACE_OPTIONS,
  describeHistoricalSource,
} from "../lib/data-source-options";
import { matchScenario } from "../lib/energy-engine";
import { buildHumanReport, humanReportFilename } from "../lib/human-report";
import { preparePilotScenario } from "../lib/pilot-scenario";

const scenarioUrl = new URL("../public/data/scenarios/cambridge-campus-real.json", import.meta.url);

async function pilotScenario() {
  return preparePilotScenario(JSON.parse(await readFile(scenarioUrl, "utf8")) as Scenario);
}

test("human report carries tenant allocations and historical operational data sources", async () => {
  const scenario = await pilotScenario();
  const intervals = matchScenario(scenario, { id: "pro_rata_demand_v1", version: "1.0.0" });
  const report = buildHumanReport(scenario, intervals, DEFAULT_DEVICE_INTERFACE_SELECTION);
  assert.match(report, /Operational evidence summary/);
  assert.match(report, /Historical operational data sources/);
  assert.match(report, /Electrical integration posture/);
  scenario.site.tenants.forEach((tenant) => assert.ok(report.includes(tenant.label)));
  scenario.sources.forEach((source) => assert.ok(report.includes(source.name)));
  assert.doesNotMatch(report, /cannot prove/i);
  assert.match(humanReportFilename(scenario), /^greenproof-.*\.html$/);
});

test("source reliability is categorical and every operational stream offers device interfaces", async () => {
  const scenario = await pilotScenario();
  const description = describeHistoricalSource(scenario.sources[0]);
  assert.equal(description.recordClass, "Historical operational data");
  assert.ok(description.sourceDate);
  assert.ok(description.reliability);
  for (const options of Object.values(DEVICE_INTERFACE_OPTIONS)) {
    assert.ok(options.length >= 3);
    assert.ok(options.some((option) => option.status === "current-demo"));
    assert.ok(options.some((option) => option.status === "integration-ready" && option.interfaces.length > 0));
  }
});

test("human report escapes source text", async () => {
  const scenario = await pilotScenario();
  scenario.sources[0] = { ...scenario.sources[0], name: "Meter <script>alert(1)</script>" };
  const intervals = matchScenario(scenario, { id: "pro_rata_demand_v1", version: "1.0.0" });
  const report = buildHumanReport(scenario, intervals, DEFAULT_DEVICE_INTERFACE_SELECTION);
  assert.doesNotMatch(report, /<script>alert/);
  assert.match(report, /&lt;script&gt;alert/);
});
