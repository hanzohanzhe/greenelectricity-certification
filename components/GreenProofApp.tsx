"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  AllocationRuleId,
  EvidenceCheckId,
  EvidencePackage,
  IntervalAllocation,
  Scenario,
  VerificationResult,
} from "../lib/contracts";
import { DEFAULT_RULES, matchScenario, summarise } from "../lib/energy-engine";
import { buildEvidencePackage, verifyEvidencePackage } from "../lib/evidence";
import { preparePilotScenario } from "../lib/pilot-scenario";
import {
  type EvidenceFileIssue,
  type IntervalInclusionResult,
  createEvidencePackageBlob,
  evidencePackageFilename,
  tamperEvidencePackageOneWh,
  validateEvidenceFileSize,
  verifyEvidenceFile,
  verifyEvidenceInterval,
} from "../lib/evidence-file";

type View = "twin" | "matching" | "summary" | "evidence";
type ScenarioIndex = { id: string; label: string; description: string; path: string };
type EvidenceSession = {
  activePackage: EvidencePackage;
  originalPackage: EvidencePackage;
  verification: VerificationResult;
  inclusion: IntervalInclusionResult;
  source: "generated" | "imported";
  tampered: boolean;
};

type EvidenceOperation = "idle" | "generating" | "reading";

const CHECK_LABELS: Record<EvidenceCheckId, string> = {
  canonicalIntervalResultHash: "Scenario, allocation and result hashes",
  merkleRoot: "Recomputed Merkle root",
  inclusionProofs: "All interval inclusion proofs",
  manifestHash: "Recomputed manifest hash",
  attestationBinding: "Attestation binding",
  scenarioId: "Scenario ID binding",
  period: "Period and granularity",
  rule: "Rule ID and version",
  totals: "Recomputed totals",
};

const TABS: { id: View; label: string; step: string }[] = [
  { id: "twin", label: "Site twin", step: "01" },
  { id: "matching", label: "Daily matching", step: "02" },
  { id: "summary", label: "Period summary", step: "03" },
  { id: "evidence", label: "Evidence", step: "04" },
];

const RULE_LABELS: Record<AllocationRuleId, { label: string; note: string }> = {
  pro_rata_demand_v1: {
    label: "Pro-rata demand",
    note: "Each tenant receives a share in proportion to demand in the same interval.",
  },
  priority_v1: {
    label: "Tenant A priority",
    note: "Tenant A is served first; any remaining rooftop electricity flows to Tenant B.",
  },
  contract_share_v1: {
    label: "60 / 40 contract",
    note: "A fixed share is applied first, then spare electricity is reallocated within demand.",
  },
};

function initialView(): View {
  if (typeof window === "undefined") return "twin";
  const requestedView = new URLSearchParams(window.location.search).get("view") as View | null;
  return requestedView && TABS.some((tab) => tab.id === requestedView) ? requestedView : "twin";
}

function initialTimeIndex(): number {
  if (typeof window === "undefined") return 12;
  const requestedTime = Number(new URLSearchParams(window.location.search).get("time"));
  return Number.isFinite(requestedTime) ? requestedTime : 12;
}

function formatEnergy(valueWh: number) {
  return `${(valueWh / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kWh`;
}

function formatPower(valueWh: number, minutes: number) {
  return `${((valueWh / 1000) * (60 / minutes)).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kW`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function shortHash(value: unknown) {
  if (typeof value !== "string" || !value.length) return "Unavailable";
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function localTime(iso: unknown) {
  if (typeof iso !== "string") return "invalid time";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "invalid time";
  }
}

function Sparkline({
  values,
  max,
  color,
  label,
  fill,
}: {
  values: number[];
  max: number;
  color: string;
  label: string;
  fill?: string;
}) {
  const width = 900;
  const height = 260;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - 10 - (value / Math.max(1, max)) * (height - 25);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <g aria-label={label}>
      {fill ? <polygon points={`0,${height} ${points} ${width},${height}`} fill={fill} /> : null}
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </g>
  );
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SiteTwin({
  scenario,
  intervals,
  index,
  setIndex,
  selectedTenantId,
  setSelectedTenantId,
}: {
  scenario: Scenario;
  intervals: IntervalAllocation[];
  index: number;
  setIndex: (value: number) => void;
  selectedTenantId: string;
  setSelectedTenantId: (value: string) => void;
}) {
  const interval = intervals[index];
  const tenantA = scenario.site.tenants[0];
  const tenantB = scenario.site.tenants[1];
  const pointA = tenantA.demand.points[index];
  const pointB = tenantB.demand.points[index];
  const isExporting = interval.exportWh > 0;
  const selectedTenant = scenario.site.tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenantA;
  const selectedDemand = selectedTenant.demand.points.map((point) => point.energyWh);
  const selectedAllocation = intervals.map((point) => point.tenantAllocationsWh[selectedTenant.id]);
  const generation = intervals.map((point) => point.generationWh);
  const chartMax = Math.max(...generation, ...selectedDemand);
  const totalSelectedAllocation = selectedAllocation.reduce((sum, value) => sum + value, 0);
  const totalSelectedDemand = selectedDemand.reduce((sum, value) => sum + value, 0);
  return (
    <section className="view-stack" aria-labelledby="twin-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Live interval reconstruction</span>
          <h2 id="twin-title">{localTime(interval.startUtc)}–{localTime(interval.endUtc)} · Cambridge time</h2>
        </div>
        <StatusPill tone={interval.status === "provisional" ? "amber" : "green"}>
          {interval.status === "provisional" ? "Quality-limited" : "Inputs checked"}
        </StatusPill>
      </div>

      <div className="twin-stage">
        <div className="asset-card solar-card">
          <span className="asset-icon" aria-hidden="true">☀</span>
          <div><small>SHARED ROOFTOP</small><strong>{formatPower(interval.generationWh, scenario.granularityMinutes)}</strong></div>
          <StatusPill tone="blue">Modelled</StatusPill>
        </div>
        <div className={`flow-line down ${interval.onsiteMatchedWh ? "active" : ""}`}>
          <span>{formatEnergy(interval.onsiteMatchedWh)} matched</span>
        </div>
        <div className="allocation-node">
          <span>Interval matching</span>
          <strong>{formatPercent(interval.generationWh ? interval.onsiteMatchedWh / interval.generationWh : 0)}</strong>
          <small>of PV used on site</small>
        </div>
        <div className="tenant-row">
          {[tenantA, tenantB].map((tenant, tenantIndex) => {
            const point = tenantIndex ? pointB : pointA;
            const allocation = interval.tenantAllocationsWh[tenant.id];
            return (
              <div className="tenant-branch" key={tenant.id}>
                <div className={`flow-line side active tenant-${tenantIndex + 1}`}>
                  <span>{formatEnergy(allocation)}</span>
                </div>
                <button
                  type="button"
                  className={`asset-card tenant-card ${selectedTenant.id === tenant.id ? "selected" : ""}`}
                  aria-pressed={selectedTenant.id === tenant.id}
                  onClick={() => setSelectedTenantId(tenant.id)}
                >
                  <span className="tenant-marker">{tenantIndex ? "B" : "A"}</span>
                  <div>
                    <small>{tenant.label}</small>
                    <strong>{formatPower(point.energyWh, scenario.granularityMinutes)}</strong>
                    <p>{formatEnergy(interval.tenantGridImportWh[tenant.id])} from grid</p>
                  </div>
                  <span className="inspect-hint">Inspect ↓</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className={`grid-flow ${isExporting ? "exporting" : "importing"}`}>
          <div className="flow-line grid active">
            <span>{isExporting ? `${formatEnergy(interval.exportWh)} exported` : `${formatEnergy(interval.gridImportWh)} imported`}</span>
          </div>
          <div className="asset-card grid-card">
            <span className="asset-icon" aria-hidden="true">⌁</span>
            <div><small>PUBLIC GRID</small><strong>{isExporting ? "Receiving" : "Supplying"}</strong></div>
          </div>
        </div>
      </div>

      <div className="time-control">
        <div>
          <span>Explore the day</span>
          <strong>{localTime(interval.startUtc)}</strong>
        </div>
        <input
          aria-label="Selected time interval"
          type="range"
          min="0"
          max={intervals.length - 1}
          value={index}
          onChange={(event) => setIndex(Number(event.target.value))}
        />
        <div className="time-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      </div>

      <section className="tenant-drilldown" aria-labelledby="tenant-drilldown-title">
        <div className="drilldown-heading">
          <div>
            <span className="eyebrow">Clicked load · interval calculation</span>
            <h3 id="tenant-drilldown-title">{selectedTenant.label}: when rooftop electricity served this load</h3>
          </div>
          <div className="drilldown-assets" aria-label="Compared assets">
            <div className="mini-asset solar-mini"><span aria-hidden="true">☀</span><div><small>ROOFTOP OUTPUT</small><strong>{formatPower(interval.generationWh, scenario.granularityMinutes)}</strong></div></div>
            <div className="mini-asset"><span className="tenant-marker">{selectedTenant.id === tenantA.id ? "A" : "B"}</span><div><small>SELECTED LOAD</small><strong>{formatPower(selectedDemand[index], scenario.granularityMinutes)}</strong></div></div>
          </div>
        </div>

        <div className="focused-chart-card">
          <div className="focused-chart-legend"><span><i className="legend-solar" /> 20 kWp rooftop output</span><span><i className={selectedTenant.id === tenantA.id ? "legend-a" : "legend-b"} /> {selectedTenant.label} demand</span></div>
          <svg viewBox="0 0 900 260" role="img" aria-label={`Rooftop output and ${selectedTenant.label} demand by hour`}>
            {[0.25, 0.5, 0.75].map((level) => <line key={level} x1="0" y1={260 * level} x2="900" y2={260 * level} className="gridline" />)}
            <Sparkline values={generation} max={chartMax} color="#e5ff61" fill="rgba(229,255,97,.08)" label="Rooftop output" />
            <Sparkline values={selectedDemand} max={chartMax} color={selectedTenant.id === tenantA.id ? "#40d7b5" : "#bba7ff"} label={`${selectedTenant.label} demand`} />
            <line x1={(index / (intervals.length - 1)) * 900} x2={(index / (intervals.length - 1)) * 900} y1="0" y2="260" className="cursor-line" />
          </svg>
          <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        </div>

        <div className="green-consumption-card">
          <div className="green-consumption-copy">
            <span className="eyebrow">Verified same-interval allocation</span>
            <h4>Green electricity consumed by {selectedTenant.label}</h4>
            <p>Each bar is the rooftop electricity allocated to this load in that hour—never more than its measured or modelled demand.</p>
            <div><strong>{formatEnergy(totalSelectedAllocation)}</strong><span>of {formatEnergy(totalSelectedDemand)} daily demand</span></div>
          </div>
          <div className="allocation-bars" role="img" aria-label={`${selectedTenant.label} rooftop electricity consumption by hour`}>
            {selectedAllocation.map((value, barIndex) => (
              <button
                type="button"
                key={intervals[barIndex].startUtc}
                className={barIndex === index ? "active" : ""}
                style={{ "--bar": value / Math.max(1, ...selectedAllocation) } as React.CSSProperties}
                onClick={() => setIndex(barIndex)}
                aria-label={`${localTime(intervals[barIndex].startUtc)}: ${formatEnergy(value)} rooftop electricity`}
                title={`${localTime(intervals[barIndex].startUtc)} · ${formatEnergy(value)}`}
              ><span /></button>
            ))}
          </div>
          <div className="selected-calculation">
            <div><span>Hour</span><strong>{localTime(interval.startUtc)}–{localTime(interval.endUtc)}</strong></div>
            <div><span>Load demand</span><strong>{formatEnergy(selectedDemand[index])}</strong></div>
            <div><span>Rooftop consumed</span><strong>{formatEnergy(selectedAllocation[index])}</strong></div>
            <div><span>Grid balance</span><strong>{formatEnergy(interval.tenantGridImportWh[selectedTenant.id])}</strong></div>
          </div>
        </div>
      </section>
    </section>
  );
}

function DailyMatching({
  scenario,
  intervals,
  index,
  setIndex,
}: {
  scenario: Scenario;
  intervals: IntervalAllocation[];
  index: number;
  setIndex: (value: number) => void;
}) {
  const demandA = scenario.site.tenants[0].demand.points.map((point) => point.energyWh);
  const demandB = scenario.site.tenants[1].demand.points.map((point) => point.energyWh);
  const generation = intervals.map((point) => point.generationWh);
  const allocatedA = intervals.map((point) => point.tenantAllocationsWh["tenant-a"]);
  const allocatedB = intervals.map((point) => point.tenantAllocationsWh["tenant-b"]);
  const max = Math.max(...generation, ...demandA, ...demandB);
  return (
    <section className="view-stack" aria-labelledby="matching-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">One source · two demand shapes</span>
          <h2 id="matching-title">Where every interval goes</h2>
          <p>Hovering is not required: use the slider or keyboard arrows to inspect exact values.</p>
        </div>
        <div className="legend" aria-label="Chart legend">
          <span><i className="legend-solar" /> Rooftop PV</span>
          <span><i className="legend-a" /> Tenant A</span>
          <span><i className="legend-b" /> Tenant B</span>
        </div>
      </div>
      <div className="chart-card">
        <svg viewBox="0 0 900 260" role="img" aria-label="Hourly rooftop generation, tenant demand and locally allocated electricity">
          {[0.25, 0.5, 0.75].map((level) => <line key={level} x1="0" y1={260 * level} x2="900" y2={260 * level} className="gridline" />)}
          <Sparkline values={generation} max={max} color="#e5ff61" fill="rgba(229,255,97,.09)" label="Rooftop generation" />
          <Sparkline values={demandA} max={max} color="#40d7b5" label="Tenant A demand" />
          <Sparkline values={demandB} max={max} color="#bba7ff" label="Tenant B demand" />
          <line x1={(index / (intervals.length - 1)) * 900} x2={(index / (intervals.length - 1)) * 900} y1="0" y2="260" className="cursor-line" />
        </svg>
        <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        <input
          className="chart-range"
          aria-label="Inspect chart interval"
          type="range"
          min="0"
          max={intervals.length - 1}
          value={index}
          onChange={(event) => setIndex(Number(event.target.value))}
        />
      </div>
      <div className="interval-ledger">
        <div><span>Selected interval</span><strong>{localTime(intervals[index].startUtc)}</strong></div>
        <div><span>PV → Tenant A</span><strong>{formatEnergy(allocatedA[index])}</strong><small>of {formatEnergy(demandA[index])} demand</small></div>
        <div><span>PV → Tenant B</span><strong>{formatEnergy(allocatedB[index])}</strong><small>of {formatEnergy(demandB[index])} demand</small></div>
        <div><span>{intervals[index].exportWh ? "To public grid" : "From public grid"}</span><strong>{formatEnergy(intervals[index].exportWh || intervals[index].gridImportWh)}</strong></div>
      </div>
    </section>
  );
}

function PeriodSummary({
  scenario,
  intervals,
}: {
  scenario: Scenario;
  intervals: IntervalAllocation[];
}) {
  const summary = summarise(scenario, intervals);
  return (
    <section className="view-stack" aria-labelledby="summary-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Auditable period totals</span>
          <h2 id="summary-title">A day, reconciled to the watt-hour</h2>
          <p>Totals are calculated from interval results, not separately recreated in the interface.</p>
        </div>
      </div>
      <div className="metric-grid">
        <Metric label="Rooftop generation" value={formatEnergy(summary.generationWh)} detail="Modelled at Cambridge coordinates" tone="solar" />
        <Metric label="Used on site" value={formatEnergy(summary.onsiteMatchedWh)} detail={`${formatPercent(summary.pvSelfConsumptionRate)} PV self-consumption`} tone="green" />
        <Metric label="Exported" value={formatEnergy(summary.exportWh)} detail="Unmatched rooftop generation" />
        <Metric label="Grid import" value={formatEnergy(summary.gridImportWh)} detail="Demand not met in the same interval" />
      </div>
      <div className="tenant-summary-grid">
        {scenario.site.tenants.map((tenant) => (
          <article className="tenant-summary" key={tenant.id}>
            <div className="tenant-title">
              <span className="tenant-marker">{tenant.id === "tenant-a" ? "A" : "B"}</span>
              <div><small>LOCAL MATCHING RESULT</small><h3>{tenant.label}</h3></div>
            </div>
            <div className="share-ring" style={{ "--share": summary.tenantGreenShare[tenant.id] } as React.CSSProperties}>
              <strong>{formatPercent(summary.tenantGreenShare[tenant.id])}</strong><span>of load matched locally</span>
            </div>
            <dl>
              <div><dt>Total demand</dt><dd>{formatEnergy(summary.tenantDemandWh[tenant.id])}</dd></div>
              <div><dt>Local rooftop share</dt><dd>{formatEnergy(summary.tenantAllocationWh[tenant.id])}</dd></div>
              <div><dt>Grid-supplied balance</dt><dd>{formatEnergy(summary.tenantDemandWh[tenant.id] - summary.tenantAllocationWh[tenant.id])}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <div className="method-note">
        <span aria-hidden="true">i</span>
        <p><strong>No avoided-emissions claim is made.</strong> This MVP certifies the objective facts of time, place, source lineage and same-interval allocation. It deliberately does not assign an “additionality score”.</p>
      </div>
    </section>
  );
}

function EvidenceView({
  scenario,
  session,
  operation,
  fileError,
  generateProof,
  downloadProof,
  loadProof,
  toggleTamper,
  verifySelectedInterval,
}: {
  scenario: Scenario;
  session: EvidenceSession | null;
  operation: EvidenceOperation;
  fileError: EvidenceFileIssue | null;
  generateProof: () => Promise<void>;
  downloadProof: () => void;
  loadProof: (file: File) => Promise<void>;
  toggleTamper: () => Promise<void>;
  verifySelectedInterval: (leafIndex: number) => Promise<void>;
}) {
  const evidencePackage = session?.activePackage;
  const verification = session?.verification;
  const attestation = evidencePackage?.attestation;
  const busy = operation !== "idle";
  return (
    <section className="view-stack" aria-labelledby="evidence-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Inspectable, not inscrutable</span>
          <h2 id="evidence-title">Evidence before claims</h2>
          <p>Every number carries a source class, transformation boundary and quality note.</p>
        </div>
        <button className="primary-button" onClick={() => void generateProof()} disabled={busy}>
          {operation === "generating" ? "Building and verifying…" : session ? "Rebuild proof" : "Generate demo proof"} <span>→</span>
        </button>
      </div>
      <div className="evidence-grid">
        <div className="source-list">
          <h3>Source manifest</h3>
          {scenario.sources.map((source) => (
            <details className="source-card" key={source.id}>
              <summary>
                <div>
                  <StatusPill tone={source.provenance === "modelled" ? "blue" : source.provenance === "profile_scaled" ? "violet" : "green"}>
                    {source.provenance.replace("_", " ")}
                  </StatusPill>
                  <strong>{source.name}</strong>
                </div>
                <span aria-hidden="true">＋</span>
              </summary>
              <dl>
                <div><dt>Version</dt><dd>{source.version}</dd></div>
                <div><dt>Licence</dt><dd>{source.license}</dd></div>
                <div><dt>Source hash</dt><dd><code>{shortHash(source.sha256)}</code></dd></div>
                <div><dt>Source</dt><dd><a href={source.url} target="_blank" rel="noreferrer">Open publisher page ↗</a></dd></div>
              </dl>
              <ul>{source.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          ))}
          <div className="quality-card">
            <h3>Quality & alignment</h3>
            <div className="quality-row"><span>Period alignment</span><strong>{scenario.alignment === "same_day" ? "Same calendar day" : "Aligned typical day"}</strong></div>
            <div className="quality-row"><span>Matching granularity</span><strong>{scenario.granularityMinutes} minutes</strong></div>
            {scenario.qualitySummary.map((item) => <p key={item}>— {item}</p>)}
          </div>
        </div>
        <aside className="proof-panel">
          <div className="proof-heading">
            <span className="proof-mark">GP</span>
            <div><small>GREENPROOF</small><h3>Demonstration attestation</h3></div>
          </div>
          <div className="evidence-file-actions">
            <label className="file-button">
              <span>{operation === "reading" ? "Reading and verifying…" : "Load evidence package"}</span>
              <input
                type="file"
                accept=".json,application/json,application/vnd.greenproof.evidence+json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void loadProof(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {session ? (
              <button className="secondary-button" onClick={downloadProof} disabled={busy}>
                Download evidence package
              </button>
            ) : null}
          </div>
          <p className="privacy-note">
            Files stay in this browser and are not uploaded or saved to the URL. A package contains the full scenario and every interval; real pilot data may be sensitive.
          </p>
          {fileError ? (
            <div className="file-error" role="alert"><strong>{fileError.code}</strong><span>{fileError.message}</span></div>
          ) : null}
          {session && attestation && verification ? (
            <>
              <div className="proof-status" aria-live="polite">
                <StatusPill tone={verification.valid ? "green" : "amber"}>
                  {verification.valid ? "VALID · INTERNALLY CONSISTENT" : "INVALID · CHECKS FAILED"}
                </StatusPill>
                <small>{session.source === "generated" ? "Generated and verified locally" : "Imported and verified locally"}</small>
              </div>
              <StatusPill tone="amber">DEMONSTRATION · NOT A CERTIFICATE</StatusPill>
              <dl className="proof-details">
                <div><dt>Proof ID</dt><dd>{attestation.proofId}</dd></div>
                <div><dt>Scenario</dt><dd>{evidencePackage.scenario.label}</dd></div>
                <div><dt>Rule</dt><dd>{RULE_LABELS[attestation.ruleId]?.label ?? attestation.ruleId}</dd></div>
                <div><dt>Manifest</dt><dd><code>{shortHash(evidencePackage.manifestHash)}</code></dd></div>
                <div><dt>Merkle root</dt><dd><code>{shortHash(attestation.merkleRoot)}</code></dd></div>
              </dl>
              <div className="verification-list">
                {(Object.keys(CHECK_LABELS) as EvidenceCheckId[]).map((checkId) => {
                  const valid = verification.checks[checkId];
                  return (
                    <div key={checkId}>
                      <span className={valid ? "valid" : "invalid"}>
                        {valid ? "✓" : "×"}
                      </span>
                      <p>{CHECK_LABELS[checkId]}<small>{valid ? "Recomputed locally" : "Failed independent verification"}</small></p>
                    </div>
                  );
                })}
                <div>
                  <span className="not-enabled">—</span>
                  <p>Blockchain anchoring<small>Not enabled</small></p>
                </div>
              </div>
              <div className="interval-proof">
                <label>
                  <span>Single interval inclusion proof</span>
                  <select
                    value={session.inclusion.leafIndex}
                    onChange={(event) => void verifySelectedInterval(Number(event.target.value))}
                  >
                    {evidencePackage.intervals.map((interval, index) => (
                      <option value={index} key={`${interval?.startUtc ?? "invalid"}-${index}`}>
                        Leaf {index} · {localTime(interval?.startUtc)}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <span className={session.inclusion.valid ? "valid" : "invalid"}>
                    {session.inclusion.valid ? "✓" : "×"}
                  </span>
                  <p>
                    Leaf {session.inclusion.leafIndex} · path length {session.inclusion.pathLength}
                    <small>{session.inclusion.valid ? "Leaf content and nonce recomputed" : session.inclusion.error ?? "Inclusion proof failed"}</small>
                  </p>
                </div>
              </div>
              {verification.errors.length ? (
                <div className="issue-block errors" role="alert">
                  <h4>Verification errors</h4>
                  <ul>{verification.errors.map((error, index) => (
                    <li key={`${error.code}-${error.leafIndex ?? "package"}-${index}`}>
                      <strong>{error.code}</strong><span>{error.message}</span>
                    </li>
                  ))}</ul>
                </div>
              ) : null}
              <div className="issue-block warnings">
                <h4>Trust boundary warnings</h4>
                <ul>{verification.warnings.map((warning) => (
                  <li key={warning.code}>
                    <strong>{warning.code}</strong><span>{warning.message}</span>
                  </li>
                ))}</ul>
              </div>
              <button className="secondary-button" onClick={() => void toggleTamper()} disabled={busy}>
                {session.tampered ? "Restore original and verify again" : "Change generation by 1 Wh and verify"}
              </button>
              <button className="text-button" onClick={() => window.print()}>Print demonstration page ↗</button>
            </>
          ) : (
            <div className="proof-empty">
              <span>⌁</span>
              <p>Generate a local package or load one from disk. Every check will be recomputed by the independent verifier.</p>
              <small>No personal data or energy values are sent to a blockchain. No blockchain anchoring is enabled.</small>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

export function GreenProofApp() {
  const [scenarioIndex, setScenarioIndex] = useState<ScenarioIndex[]>([]);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>(initialView);
  const [timeIndex, setTimeIndex] = useState(initialTimeIndex);
  const [ruleId, setRuleId] = useState<AllocationRuleId>("pro_rata_demand_v1");
  const [selectedTenantId, setSelectedTenantId] = useState("tenant-a");
  const [evidenceSession, setEvidenceSession] = useState<EvidenceSession | null>(null);
  const [evidenceOperation, setEvidenceOperation] = useState<EvidenceOperation>("idle");
  const [evidenceFileError, setEvidenceFileError] = useState<EvidenceFileIssue | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedScenario = params.get("scenario") ?? "cambridge-campus-real";
    fetch("/data/scenarios/index.json")
      .then((response) => {
        if (!response.ok) throw new Error("Scenario index is unavailable");
        return response.json() as Promise<ScenarioIndex[]>;
      })
      .then((index) => {
        setScenarioIndex(index);
        const selected = index.find((item) => item.id === requestedScenario) ?? index[0];
        return fetch(selected.path);
      })
      .then((response) => {
        if (!response.ok) throw new Error("The selected scenario is unavailable or damaged");
        return response.json() as Promise<Scenario>;
      })
      .then((data) => setScenario(preparePilotScenario(data)))
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const rule = useMemo(
    () => DEFAULT_RULES.find((item) => item.id === ruleId) ?? DEFAULT_RULES[0],
    [ruleId],
  );
  const intervals = useMemo(() => (scenario ? matchScenario(scenario, rule) : []), [scenario, rule]);

  function syncUrl(next: { scenario?: string; view?: View; time?: number }) {
    const params = new URLSearchParams(window.location.search);
    if (next.scenario) params.set("scenario", next.scenario);
    if (next.view) params.set("view", next.view);
    if (next.time !== undefined) params.set("time", String(next.time));
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  function chooseScenario(id: string) {
    const target = scenarioIndex.find((item) => item.id === id);
    if (!target) return;
    setLoadError("");
    fetch(target.path)
      .then((response) => {
        if (!response.ok) throw new Error("The selected scenario is unavailable or damaged");
        return response.json() as Promise<Scenario>;
      })
      .then((data) => {
        setScenario(preparePilotScenario(data));
        setTimeIndex(Math.min(12, data.site.generation.points.length - 1));
        setEvidenceSession(null);
        setEvidenceFileError(null);
        syncUrl({ scenario: id, time: 12 });
      })
      .catch((error: Error) => setLoadError(error.message));
  }

  async function generateProof() {
    if (!scenario) return;
    setEvidenceOperation("generating");
    setEvidenceFileError(null);
    try {
      const evidencePackage = await buildEvidencePackage(scenario, rule);
      const [verification, inclusion] = await Promise.all([
        verifyEvidencePackage(evidencePackage),
        verifyEvidenceInterval(evidencePackage, 0),
      ]);
      setEvidenceSession({
        activePackage: evidencePackage,
        originalPackage: evidencePackage,
        verification,
        inclusion,
        source: "generated",
        tampered: false,
      });
    } catch (error) {
      setEvidenceFileError({
        code: "INVALID_PACKAGE",
        message: error instanceof Error ? error.message : "The evidence package could not be generated.",
      });
    } finally {
      setEvidenceOperation("idle");
    }
  }

  function downloadProof() {
    if (!evidenceSession) return;
    const evidencePackage = evidenceSession.originalPackage;
    let objectUrl = "";
    let anchor: HTMLAnchorElement | null = null;
    setEvidenceFileError(null);
    try {
      objectUrl = URL.createObjectURL(createEvidencePackageBlob(evidencePackage));
      anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = evidencePackageFilename(evidencePackage);
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
    } catch (error) {
      setEvidenceFileError({
        code: "DOWNLOAD_FAILED",
        message: error instanceof Error ? error.message : "This browser could not create the evidence download.",
      });
    } finally {
      anchor?.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  async function loadProof(file: File) {
    setEvidenceOperation("reading");
    setEvidenceFileError(null);
    try {
      const sizeIssue = validateEvidenceFileSize(file.size);
      if (sizeIssue) {
        setEvidenceFileError(sizeIssue);
        return;
      }
      const loaded = await verifyEvidenceFile(await file.text(), file.size);
      if (!loaded.ok) {
        setEvidenceFileError(loaded.error);
        return;
      }
      const inclusion = await verifyEvidenceInterval(loaded.evidencePackage, 0);
      setEvidenceSession({
        activePackage: loaded.evidencePackage,
        originalPackage: loaded.evidencePackage,
        verification: loaded.verification,
        inclusion,
        source: "imported",
        tampered: false,
      });
    } catch (error) {
      setEvidenceFileError({
        code: "INVALID_PACKAGE",
        message: error instanceof Error ? error.message : "The evidence file could not be read.",
      });
    } finally {
      setEvidenceOperation("idle");
    }
  }

  async function toggleTamper() {
    if (!evidenceSession) return;
    setEvidenceOperation("generating");
    setEvidenceFileError(null);
    try {
      const activePackage = evidenceSession.tampered
        ? evidenceSession.originalPackage
        : tamperEvidencePackageOneWh(evidenceSession.originalPackage);
      const [verification, inclusion] = await Promise.all([
        verifyEvidencePackage(activePackage),
        verifyEvidenceInterval(activePackage, evidenceSession.inclusion.leafIndex),
      ]);
      setEvidenceSession({
        ...evidenceSession,
        activePackage,
        verification,
        inclusion,
        tampered: !evidenceSession.tampered,
      });
    } catch (error) {
      setEvidenceFileError({
        code: "INVALID_PACKAGE",
        message: error instanceof Error ? error.message : "The tamper demonstration could not run.",
      });
    } finally {
      setEvidenceOperation("idle");
    }
  }

  async function verifySelectedInterval(leafIndex: number) {
    if (!evidenceSession) return;
    const inclusion = await verifyEvidenceInterval(evidenceSession.activePackage, leafIndex);
    setEvidenceSession((current) => current ? { ...current, inclusion } : current);
  }

  if (loadError) {
    return (
      <main className="error-page">
        <span className="brand-mark">GP</span>
        <p className="eyebrow">Scenario integrity error</p>
        <h1>This evidence package could not be opened.</h1>
        <p>{loadError}. No substitute data has been silently generated.</p>
        <Link href="/">Return to the verified demo</Link>
      </main>
    );
  }

  if (!scenario) {
    return <main className="loading-page"><span className="brand-mark">GP</span><p>Loading offline evidence package…</p></main>;
  }

  const safeTimeIndex = Math.min(timeIndex, intervals.length - 1);
  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="GreenProof home"><span className="brand-mark">GP</span><span>GreenProof<small>LOCAL ENERGY EVIDENCE</small></span></Link>
        <div className="header-controls">
          <label>
            <span>Scenario</span>
            <select value={scenario.id} onChange={(event) => chooseScenario(event.target.value)}>
              {scenarioIndex.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
            </select>
          </label>
          <StatusPill tone="amber">Public-data demo</StatusPill>
        </div>
      </header>
      <div className="disclaimer">
        <span aria-hidden="true">◇</span>
        <p><strong>Demonstration using public, measured and modelled data.</strong> Not an official energy certificate.</p>
      </div>
      <div className="shell">
        <nav className="tabs" aria-label="Product views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={view === tab.id ? "active" : ""}
              onClick={() => { setView(tab.id); syncUrl({ view: tab.id }); }}
            >
              <span>{tab.step}</span>{tab.label}
            </button>
          ))}
        </nav>
        <div className="context-bar">
          <div>
            <span className="site-dot" />
            <p><strong>{scenario.site.label}</strong><small>{scenario.description}</small></p>
          </div>
          <label>
            <span>Allocation rule</span>
            <select value={ruleId} onChange={(event) => { setRuleId(event.target.value as AllocationRuleId); setEvidenceSession(null); setEvidenceFileError(null); }}>
              {DEFAULT_RULES.map((item) => <option value={item.id} key={item.id}>{RULE_LABELS[item.id].label}</option>)}
            </select>
          </label>
        </div>
        <div className="rule-explainer"><span>METHOD</span><p>{RULE_LABELS[ruleId].note}</p><code>{ruleId}</code></div>
        {view === "twin" ? <SiteTwin scenario={scenario} intervals={intervals} index={safeTimeIndex} setIndex={(value) => { setTimeIndex(value); syncUrl({ time: value }); }} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} /> : null}
        {view === "matching" ? <DailyMatching scenario={scenario} intervals={intervals} index={safeTimeIndex} setIndex={(value) => { setTimeIndex(value); syncUrl({ time: value }); }} /> : null}
        {view === "summary" ? <PeriodSummary scenario={scenario} intervals={intervals} /> : null}
        {view === "evidence" ? (
          <EvidenceView
            scenario={scenario}
            session={evidenceSession}
            operation={evidenceOperation}
            fileError={evidenceFileError}
            generateProof={generateProof}
            downloadProof={downloadProof}
            loadProof={loadProof}
            toggleTamper={toggleTamper}
            verifySelectedInterval={verifySelectedInterval}
          />
        ) : null}
      </div>
      <footer>
        <p>GreenProof MVP · Objective facts, explicit assumptions, reproducible allocation.</p>
        <p>Engine 1.0.0 · UTC calculation · Europe/London display · Integer Wh</p>
      </footer>
    </main>
  );
}
