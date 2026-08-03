import type { IntervalAllocation, Scenario } from "./contracts";
import { summarise } from "./energy-engine";
import {
  type DeviceInterfaceSelection,
  describeHistoricalSource,
  selectedDeviceOption,
} from "./data-source-options";

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function energy(valueWh: number) {
  return `${(valueWh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kWh`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function safeFilenamePart(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "scenario";
}

export function humanReportFilename(scenario: Scenario) {
  const first = scenario.site.generation.points[0];
  const last = scenario.site.generation.points.at(-1);
  const period = first && last ? `${first.startUtc.slice(0, 10)}_${last.endUtc.slice(0, 10)}` : "period";
  return `greenproof-${safeFilenamePart(scenario.id)}-${period}.html`;
}

export function buildHumanReport(
  scenario: Scenario,
  intervals: IntervalAllocation[],
  deviceSelection: DeviceInterfaceSelection,
) {
  const summary = summarise(scenario, intervals);
  const first = intervals[0];
  const last = intervals.at(-1);
  const rule = first ? `${first.ruleId}@${first.ruleVersion}` : "Unavailable";
  const streamRows = (["generation", "gridExchange", "tenantDemand"] as const).map((stream) => {
    const option = selectedDeviceOption(stream, deviceSelection);
    const label = stream === "generation" ? "Rooftop generation" : stream === "gridExchange" ? "Grid import/export" : "Tenant demand";
    return `<tr><td>${label}</td><td>${escapeHtml(option.label)}</td><td>${escapeHtml(option.deviceExamples)}</td><td>${escapeHtml(option.interfaces.join(", "))}</td></tr>`;
  }).join("");
  const tenantRows = scenario.site.tenants.map((tenant) => `<tr><td>${escapeHtml(tenant.label)}</td><td>${energy(summary.tenantDemandWh[tenant.id])}</td><td>${energy(summary.tenantAllocationWh[tenant.id])}</td><td>${percent(summary.tenantGreenShare[tenant.id])}</td></tr>`).join("");
  const sourceRows = scenario.sources.map((source) => {
    const description = describeHistoricalSource(source);
    return `<tr><td>${escapeHtml(source.name)}</td><td>${description.recordClass}</td><td>${escapeHtml(description.sourceDate)}</td><td>${escapeHtml(description.reliability)}</td><td>${escapeHtml(source.version)}</td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GreenProof local energy evidence summary</title>
<style>@page{size:A4;margin:9mm}*{box-sizing:border-box}body{margin:0;color:#102720;font:9px/1.35 Arial,sans-serif}header{border-bottom:3px solid #0d725c;padding-bottom:8px;margin-bottom:9px;display:flex;justify-content:space-between;gap:20px}h1{font:24px Georgia,serif;margin:0}h2{font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin:10px 0 5px;color:#0d725c}.mark{font-weight:800;color:#0d725c}.muted{color:#61716c}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.metric{border:1px solid #d9e2de;padding:7px}.metric b{display:block;font-size:13px;margin-top:2px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border-bottom:1px solid #dde5e1;padding:4px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eef4f1;font-size:8px;text-transform:uppercase}.note{margin-top:8px;padding:7px;background:#eef4f1;border-left:3px solid #0d725c}.footer{margin-top:7px;color:#61716c;font-size:8px}section,table{break-inside:avoid}</style></head>
<body><header><div><div class="mark">GREENPROOF · LOCAL ENERGY EVIDENCE</div><h1>Operational evidence summary</h1><div class="muted">${escapeHtml(scenario.site.label)}</div></div><div><b>Period</b><br>${escapeHtml(first?.startUtc ?? "Unavailable")}<br>to ${escapeHtml(last?.endUtc ?? "Unavailable")}<br><b>Rule</b> ${escapeHtml(rule)}</div></header>
<div class="metrics"><div class="metric">Rooftop generation<b>${energy(summary.generationWh)}</b></div><div class="metric">Used on site<b>${energy(summary.onsiteMatchedWh)}</b></div><div class="metric">Exported<b>${energy(summary.exportWh)}</b></div><div class="metric">Grid import<b>${energy(summary.gridImportWh)}</b></div></div>
<h2>Tenant allocation</h2><table><thead><tr><th>Tenant</th><th>Demand</th><th>Local rooftop</th><th>Share of load</th></tr></thead><tbody>${tenantRows}</tbody></table>
<h2>Historical operational data sources</h2><table><thead><tr><th>Source</th><th>Record class</th><th>Source date</th><th>Reliability description</th><th>Version</th></tr></thead><tbody>${sourceRows || '<tr><td colspan="5">No source descriptor supplied.</td></tr>'}</tbody></table>
<h2>Electrical integration posture</h2><table><thead><tr><th>Data stream</th><th>Selected route</th><th>Device examples</th><th>Interfaces</th></tr></thead><tbody>${streamRows}</tbody></table>
<div class="note"><b>Data-source interpretation.</b> Results are calculated from the historical operational data and transformations identified above. Device selections describe available ingestion routes; they do not represent a live connection unless commissioned for the site.</div>
<div class="footer">GreenProof demonstration · Human-readable companion to the machine-verifiable EvidencePackage. Open this file in a browser to print or save as PDF.</div></body></html>`;
}
