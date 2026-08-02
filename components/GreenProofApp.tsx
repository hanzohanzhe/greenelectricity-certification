"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  AllocationRule,
  AllocationRuleId,
  EvidenceCheckId,
  EvidencePackage,
  IntervalAllocation,
  Scenario,
  VerificationResult,
} from "../lib/contracts";
import {
  DEFAULT_RULES,
  explainTenantGreenShortfall,
  matchScenario,
  summarise,
} from "../lib/energy-engine";
import { buildEvidencePackage, verifyEvidencePackage } from "../lib/evidence";
import { preparePilotScenario } from "../lib/pilot-scenario";
import {
  type PpaContractDraft,
  convertPpaContract,
} from "../lib/ppa-contract";
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

type View = "twin" | "matching" | "contract" | "summary" | "evidence";
type AnalysisScope = "year" | "month" | "day";
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
  { id: "contract", label: "PPA contract", step: "03" },
  { id: "summary", label: "Period summary", step: "04" },
  { id: "evidence", label: "Evidence", step: "05" },
];

const CERTIFICATE_LABELS: Record<PpaContractDraft["certificateTreatment"], string> = {
  not_issued: "No certificate issued",
  included_with_tenant: "Certificate included with tenant entitlement",
  retained_by_owner: "Certificate retained by owner",
  sold_separately: "Certificate sold separately",
  unknown: "Certificate status unknown",
};

const RULE_LABELS: Record<AllocationRuleId, { label: string; note: string }> = {
  pro_rata_demand_v1: {
    label: "Pro-rata demand",
    note: "Each tenant receives a share in proportion to demand in the same interval.",
  },
  priority_v1: {
    label: "Sequential priority",
    note: "Users are served in the displayed A–H order until the interval's rooftop electricity is exhausted.",
  },
  contract_share_v1: {
    label: "PPA contract shares",
    note: "Each user starts with its applied PPA generation share; unused entitlement is redistributed to users with remaining same-interval demand.",
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

function dateKey(iso: string) {
  return iso.slice(0, 10);
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function sliceScenario(scenario: Scenario, predicate: (point: Scenario["site"]["generation"]["points"][number]) => boolean): Scenario {
  return {
    ...scenario,
    site: {
      ...scenario.site,
      generation: { ...scenario.site.generation, points: scenario.site.generation.points.filter(predicate) },
      tenants: scenario.site.tenants.map((tenant) => ({
        ...tenant,
        demand: { ...tenant.demand, points: tenant.demand.points.filter(predicate) },
      })),
    },
  };
}

const DEFAULT_PPA_SHARES_PERCENT: Record<string, number> = {
  "tenant-a": 20,
  "tenant-b": 15,
  "tenant-c": 15,
  "tenant-d": 12.5,
  "tenant-e": 12.5,
  "tenant-f": 10,
  "tenant-g": 10,
  "tenant-h": 5,
};

const DEFAULT_PPA_DRAFT: PpaContractDraft = {
  reference: "CAM-ROOF-PPA-DEMO-001",
  effectiveFrom: "2022-01-01",
  effectiveTo: "2023-01-01",
  pricePencePerKwh: 14.5,
  allocationBasis: "metered_onsite_consumption",
  unusedEntitlement: "not_applicable",
  certificateTreatment: "retained_by_owner",
  tenantSharesPercent: DEFAULT_PPA_SHARES_PERCENT,
};

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
  const isPvSelected = selectedTenantId === "pv";
  const isExporting = interval.exportWh > 0;
  const selectedTenant = scenario.site.tenants.find((tenant) => tenant.id === selectedTenantId) ?? scenario.site.tenants[0];
  const selectedTenantIndex = scenario.site.tenants.findIndex((tenant) => tenant.id === selectedTenant.id);
  const selectedDemand = selectedTenant.demand.points.map((point) => point.energyWh);
  const selectedAllocation = intervals.map((point) => point.tenantAllocationsWh[selectedTenant.id]);
  const generation = intervals.map((point) => point.generationWh);
  const combinedDemand = intervals.map((point) => point.totalDemandWh);
  const focusDemand = isPvSelected ? combinedDemand : selectedDemand;
  const focusAllocation = isPvSelected ? intervals.map((point) => point.onsiteMatchedWh) : selectedAllocation;
  const chartMax = Math.max(...generation, ...focusDemand);
  const totalSelectedAllocation = focusAllocation.reduce((sum, value) => sum + value, 0);
  const totalSelectedDemand = focusDemand.reduce((sum, value) => sum + value, 0);
  const focusLabel = isPvSelected ? "Rooftop PV and shared bus" : selectedTenant.label;
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
        <div className="circuit-source-row">
          <button type="button" className={`asset-card solar-card ${isPvSelected ? "selected" : ""}`} aria-pressed={isPvSelected} onClick={() => setSelectedTenantId("pv")}>
            <span className="asset-icon" aria-hidden="true">☀</span>
            <div><small>125 kWp ROOFTOP · 100 kW PEAK</small><strong>{formatPower(interval.generationWh, scenario.granularityMinutes)}</strong></div>
            <StatusPill tone="blue">Simulated</StatusPill>
            <span className="inspect-hint">Inspect ↓</span>
          </button>
          <span className="circuit-arrow" aria-hidden="true">→</span>
          <div className="circuit-device"><small>INVERTER</small><strong>DC → AC</strong></div>
          <span className="circuit-arrow" aria-hidden="true">→</span>
          <div className="circuit-device"><small>GENERATION METER</small><strong>{formatEnergy(interval.generationWh)}</strong></div>
        </div>
        <div className="circuit-drop" aria-hidden="true" />
        <div className="busbar">
          <span>SHARED LOW-VOLTAGE BUS</span>
          <strong>{formatEnergy(interval.onsiteMatchedWh)} distributed locally</strong>
        </div>
        <div className="circuit-tenant-grid">
          {scenario.site.tenants.map((tenant, tenantIndex) => {
            const point = tenant.demand.points[index];
            const allocation = interval.tenantAllocationsWh[tenant.id];
            return (
              <div className="circuit-tenant-branch" key={tenant.id}>
                <div className="branch-line" aria-hidden="true" />
                <div className="branch-meter"><small>SUBMETER {tenantIndex + 1}</small><strong>{formatEnergy(point.energyWh)}</strong></div>
                <button
                  type="button"
                  className={`asset-card tenant-card ${!isPvSelected && selectedTenant.id === tenant.id ? "selected" : ""}`}
                  aria-pressed={!isPvSelected && selectedTenant.id === tenant.id}
                  onClick={() => setSelectedTenantId(tenant.id)}
                >
                  <span className="tenant-marker">{String.fromCharCode(65 + tenantIndex)}</span>
                  <div>
                    <small>{tenant.label}</small>
                    <strong>{formatPower(point.energyWh, scenario.granularityMinutes)}</strong>
                    <p>{formatEnergy(allocation)} rooftop · {formatEnergy(interval.tenantGridImportWh[tenant.id])} grid</p>
                    <em>Simulated load shape</em>
                  </div>
                  <span className="inspect-hint">Inspect ↓</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="circuit-grid-connection">
          <span className="circuit-arrow" aria-hidden="true">↔</span>
          <div className="circuit-device"><small>POINT OF CONNECTION</small><strong>{isExporting ? `${formatEnergy(interval.exportWh)} export` : `${formatEnergy(interval.gridImportWh)} import`}</strong></div>
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
            <h3 id="tenant-drilldown-title">{isPvSelected ? "Rooftop output: where every interval went" : `${selectedTenant.label}: when rooftop electricity served this load`}</h3>
          </div>
          <div className="drilldown-assets" aria-label="Compared assets">
            <div className="mini-asset solar-mini"><span aria-hidden="true">☀</span><div><small>ROOFTOP OUTPUT</small><strong>{formatPower(interval.generationWh, scenario.granularityMinutes)}</strong></div></div>
            <div className="mini-asset"><span className="tenant-marker">{isPvSelected ? "Σ" : String.fromCharCode(65 + selectedTenantIndex)}</span><div><small>{isPvSelected ? "COMBINED USERS" : "SELECTED LOAD"}</small><strong>{formatPower(focusDemand[index], scenario.granularityMinutes)}</strong></div></div>
          </div>
        </div>

        <div className="focused-chart-card">
          <div className="focused-chart-legend"><span><i className="legend-solar" /> 100 kW peak rooftop output</span><span><i className="legend-a" /> {isPvSelected ? "Combined user demand" : `${selectedTenant.label} demand`}</span></div>
          <svg viewBox="0 0 900 260" role="img" aria-label={`Rooftop output and ${selectedTenant.label} demand by hour`}>
            {[0.25, 0.5, 0.75].map((level) => <line key={level} x1="0" y1={260 * level} x2="900" y2={260 * level} className="gridline" />)}
            <Sparkline values={generation} max={chartMax} color="#e5ff61" fill="rgba(229,255,97,.08)" label="Rooftop output" />
            <Sparkline values={focusDemand} max={chartMax} color="#40d7b5" label={`${focusLabel} demand comparison`} />
            <line x1={(index / (intervals.length - 1)) * 900} x2={(index / (intervals.length - 1)) * 900} y1="0" y2="260" className="cursor-line" />
          </svg>
          <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        </div>

        <div className="green-consumption-card">
          <div className="green-consumption-copy">
            <span className="eyebrow">Verified same-interval allocation</span>
            <h4>{isPvSelected ? "Rooftop electricity used on site" : `Green electricity consumed by ${selectedTenant.label}`}</h4>
            <p>{isPvSelected ? "Each bar is rooftop output consumed across the shared bus; the remainder is exported." : "Each bar is the rooftop electricity allocated to this load in that hour—never more than its simulated demand."}</p>
            <div><strong>{formatEnergy(totalSelectedAllocation)}</strong><span>{isPvSelected ? `of ${formatEnergy(generation.reduce((sum, value) => sum + value, 0))} generated` : `of ${formatEnergy(totalSelectedDemand)} daily demand`}</span></div>
          </div>
          <div className="allocation-bars" role="img" aria-label={`${focusLabel} rooftop electricity consumption by hour`}>
            {focusAllocation.map((value, barIndex) => (
              <button
                type="button"
                key={intervals[barIndex].startUtc}
                className={barIndex === index ? "active" : ""}
                style={{ "--bar": value / Math.max(1, ...focusAllocation) } as React.CSSProperties}
                onClick={() => setIndex(barIndex)}
                aria-label={`${localTime(intervals[barIndex].startUtc)}: ${formatEnergy(value)} rooftop electricity`}
                title={`${localTime(intervals[barIndex].startUtc)} · ${formatEnergy(value)}`}
              ><span /></button>
            ))}
          </div>
          <div className="selected-calculation">
            <div><span>Hour</span><strong>{localTime(interval.startUtc)}–{localTime(interval.endUtc)}</strong></div>
            <div><span>{isPvSelected ? "Combined demand" : "Load demand"}</span><strong>{formatEnergy(focusDemand[index])}</strong></div>
            <div><span>Rooftop consumed</span><strong>{formatEnergy(focusAllocation[index])}</strong></div>
            <div><span>{isPvSelected ? "Export balance" : "Grid balance"}</span><strong>{formatEnergy(isPvSelected ? interval.exportWh : interval.tenantGridImportWh[selectedTenant.id])}</strong></div>
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
  selectedTenantId,
}: {
  scenario: Scenario;
  intervals: IntervalAllocation[];
  index: number;
  setIndex: (value: number) => void;
  selectedTenantId: string;
}) {
  const selectedTenant = scenario.site.tenants.find((tenant) => tenant.id === selectedTenantId) ?? scenario.site.tenants[0];
  const selectedDemand = selectedTenant.demand.points.map((point) => point.energyWh);
  const combinedDemand = intervals.map((point) => point.totalDemandWh);
  const generation = intervals.map((point) => point.generationWh);
  const selectedAllocation = intervals.map((point) => point.tenantAllocationsWh[selectedTenant.id]);
  const max = Math.max(...generation, ...combinedDemand);
  return (
    <section className="view-stack" aria-labelledby="matching-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">One source · eight demand shapes</span>
          <h2 id="matching-title">Where every interval goes</h2>
          <p>Hovering is not required: use the slider or keyboard arrows to inspect exact values.</p>
        </div>
        <div className="legend" aria-label="Chart legend">
          <span><i className="legend-solar" /> Rooftop PV</span>
          <span><i className="legend-a" /> Selected user</span>
          <span><i className="legend-b" /> Combined demand</span>
        </div>
      </div>
      <div className="chart-card">
        <svg viewBox="0 0 900 260" role="img" aria-label="Hourly rooftop generation, tenant demand and locally allocated electricity">
          {[0.25, 0.5, 0.75].map((level) => <line key={level} x1="0" y1={260 * level} x2="900" y2={260 * level} className="gridline" />)}
          <Sparkline values={generation} max={max} color="#e5ff61" fill="rgba(229,255,97,.09)" label="Rooftop generation" />
          <Sparkline values={selectedDemand} max={max} color="#40d7b5" label={`${selectedTenant.label} demand`} />
          <Sparkline values={combinedDemand} max={max} color="#bba7ff" label="Combined user demand" />
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
        <div><span>PV → selected user</span><strong>{formatEnergy(selectedAllocation[index])}</strong><small>of {formatEnergy(selectedDemand[index])} demand</small></div>
        <div><span>All eight users</span><strong>{formatEnergy(combinedDemand[index])}</strong><small>combined interval demand</small></div>
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
        {scenario.site.tenants.map((tenant) => {
          const explanation = explainTenantGreenShortfall(scenario, intervals, tenant.id);
          const ruleLabel = RULE_LABELS[explanation.ruleId].label;
          return (
          <article className="tenant-summary" key={tenant.id}>
            <div className="tenant-title">
              <span className="tenant-marker">{String.fromCharCode(65 + scenario.site.tenants.findIndex((item) => item.id === tenant.id))}</span>
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
            <div className="shortfall-explanation">
              <div className="shortfall-heading">
                <div><small>WHY NOT MORE ROOFTOP ELECTRICITY?</small><strong>{formatEnergy(explanation.unmetWh)} unmatched in the same interval</strong></div>
                <StatusPill tone="blue">{ruleLabel}</StatusPill>
              </div>
              {explanation.unmetWh === 0 ? (
                <p>This load was fully supplied by rooftop electricity in every interval.</p>
              ) : (
                <ul>
                  {explanation.competingAllocationWh > 0 ? (
                    <li><strong>{formatEnergy(explanation.competingAllocationWh)}</strong> occurred when rooftop output could have met this load alone, but electricity was also allocated to concurrent users under the <strong>{ruleLabel}</strong> strategy ({explanation.competingIntervalCount} intervals).</li>
                  ) : null}
                  {explanation.simultaneousSiteShortageWh > 0 ? (
                    <li><strong>{formatEnergy(explanation.simultaneousSiteShortageWh)}</strong> occurred while rooftop electricity was being generated but was insufficient for this load within the simultaneous building demand.</li>
                  ) : null}
                  {explanation.noGenerationWh > 0 ? (
                    <li><strong>{formatEnergy(explanation.noGenerationWh)}</strong> occurred in intervals with no rooftop generation, so it had to come from the grid.</li>
                  ) : null}
                </ul>
              )}
              <div className="peak-fact">
                <span>PERIOD PEAK · {localTime(explanation.peak.startUtc)}</span>
                <strong>{formatPower(explanation.peak.generationWh, scenario.granularityMinutes)} rooftop</strong>
                <p>
                  {explanation.peak.generationExceedsAllDemand
                    ? `This exceeded all users' ${formatPower(explanation.peak.totalDemandWh, scenario.granularityMinutes)} demand; ${formatEnergy(explanation.peak.exportWh)} overflowed to the grid.`
                    : `All users simultaneously demanded ${formatPower(explanation.peak.totalDemandWh, scenario.granularityMinutes)}.`}
                  {" "}Surplus at the peak cannot fill a shortfall in another hour under same-time matching.
                </p>
              </div>
            </div>
          </article>
          );
        })}
      </div>
      <div className="method-note">
        <span aria-hidden="true">i</span>
        <p><strong>No avoided-emissions claim is made.</strong> This MVP certifies the objective facts of time, place, source lineage and same-interval allocation. It deliberately does not assign an “additionality score”.</p>
      </div>
    </section>
  );
}

function PpaContractView({
  scenario,
  draft,
  setDraft,
  applyContract,
  activeContractReference,
}: {
  scenario: Scenario;
  draft: PpaContractDraft;
  setDraft: (draft: PpaContractDraft) => void;
  applyContract: (rule: AllocationRule) => void;
  activeContractReference: string | null;
}) {
  const conversion = useMemo(() => convertPpaContract(scenario, draft), [draft, scenario]);
  const impact = useMemo(() => {
    if (!conversion.allocationRule) return null;
    return summarise(scenario, matchScenario(scenario, conversion.allocationRule));
  }, [conversion.allocationRule, scenario]);

  function updateShare(tenantId: string, value: number) {
    setDraft({
      ...draft,
      tenantSharesPercent: { ...draft.tenantSharesPercent, [tenantId]: value },
    });
  }

  const isManagedTariff = draft.allocationBasis === "metered_onsite_consumption";

  function selectAllocationBasis(allocationBasis: PpaContractDraft["allocationBasis"]) {
    setDraft({
      ...draft,
      allocationBasis,
      unusedEntitlement: allocationBasis === "metered_onsite_consumption" ? "not_applicable" : "redistribute_to_active_loads",
    });
  }

  return (
    <section className="view-stack" aria-labelledby="ppa-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Tenant energy agreement demonstration</span>
          <h2 id="ppa-title">Make rooftop electricity simple for tenants</h2>
          <p>Choose the commercial promise first. GreenProof then translates it into a repeatable interval-by-interval allocation rule.</p>
        </div>
        <StatusPill tone={activeContractReference === draft.reference ? "green" : "amber"}>
          {activeContractReference === draft.reference ? "APPLIED TO MODEL" : "DRAFT · NOT APPLIED"}
        </StatusPill>
      </div>

      <div className="ppa-plan-switch" aria-label="Tenant agreement type">
        <button className={isManagedTariff ? "active" : ""} onClick={() => selectAllocationBasis("metered_onsite_consumption")}>
          <small>RECOMMENDED · NO SHARES TO MANAGE</small>
          <strong>Simple metered rooftop tariff</strong>
          <span>The tenant uses electricity normally and pays the rooftop rate only for local electricity matched to its meter. Grid electricity automatically fills the shortfall.</span>
        </button>
        <button className={!isManagedTariff ? "active" : ""} onClick={() => selectAllocationBasis("same_interval_generation_share")}>
          <small>ADVANCED · NEGOTIATED ENTITLEMENT</small>
          <strong>Reserved allocation weights</strong>
          <span>The parties agree how the on-site rooftop pool is shared when supply is scarce. Unused weight is redistributed to tenants still consuming.</span>
        </button>
      </div>

      <section className="allocation-preview" aria-labelledby="allocation-preview-title">
        <div className="allocation-preview-heading">
          <div><small>FORECAST RESULT</small><h3 id="allocation-preview-title">Annual rooftop electricity allocated to each tenant</h3></div>
          <span>{isManagedTariff ? "Meter-led allocation" : `${conversion.totalSharePercent.toFixed(1)}% weights entered`}</span>
        </div>
        {impact ? (
          <div className="allocation-preview-grid">
            {scenario.site.tenants.map((tenant, index) => (
              <article key={tenant.id}>
                <i>{String.fromCharCode(65 + index)}</i>
                <div><strong>{tenant.label}</strong><small>{formatPercent(impact.tenantGreenShare[tenant.id])} of annual load</small></div>
                <b>{formatEnergy(impact.tenantAllocationWh[tenant.id])}</b>
              </article>
            ))}
          </div>
        ) : <p>Resolve the agreement errors to preview its allocation impact.</p>}
      </section>

      <div className={`ppa-grid ${isManagedTariff ? "managed" : "advanced"}`}>
        <div className="ppa-form-card">
          <div className="ppa-card-heading"><span>01</span><div><small>COMMERCIAL SOURCE</small><h3>Key PPA terms</h3></div></div>
          <div className="ppa-field-grid">
            <label><span>Contract reference</span><input value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} /></label>
            <label><span>Rooftop electricity price</span><div className="input-suffix"><input type="number" min="0" step="0.1" value={draft.pricePencePerKwh} onChange={(event) => setDraft({ ...draft, pricePencePerKwh: Number(event.target.value) })} /><i>p/kWh</i></div></label>
            <label><span>Effective from</span><input type="date" value={draft.effectiveFrom} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} /></label>
            <label><span>Effective to</span><input type="date" value={draft.effectiveTo} onChange={(event) => setDraft({ ...draft, effectiveTo: event.target.value })} /></label>
            <label className="wide-field"><span>Associated green certificate disclosure</span><select value={draft.certificateTreatment} onChange={(event) => setDraft({ ...draft, certificateTreatment: event.target.value as PpaContractDraft["certificateTreatment"] })}>
              {(Object.keys(CERTIFICATE_LABELS) as PpaContractDraft["certificateTreatment"][]).map((item) => <option value={item} key={item}>{CERTIFICATE_LABELS[item]}</option>)}
            </select><small>This disclosure does not change the measured fact of local, same-interval rooftop consumption.</small></label>
          </div>
          <div className="tenant-promise">
            <small>WHAT THE TENANT NEEDS TO UNDERSTAND</small>
            <strong>Use electricity as normal. Pay {draft.pricePencePerKwh.toFixed(1)} p/kWh for the rooftop amount actually matched to your meter; the grid supplies everything else.</strong>
            <p>No tenant is charged for rooftop electricity it did not consume. Certificate ownership is disclosed separately: {CERTIFICATE_LABELS[draft.certificateTreatment].toLowerCase()}.</p>
          </div>
        </div>

        <div className="ppa-form-card ppa-share-controls">
          <div className="ppa-card-heading"><span>02</span><div><small>GENERATION ENTITLEMENT</small><h3>Tenant shares</h3></div><strong className={Math.abs(conversion.totalSharePercent - 100) < 0.001 ? "share-valid" : "share-invalid"}>{conversion.totalSharePercent.toFixed(1)}%</strong></div>
          <p className="ppa-helper">These percentages are weights over the rooftop electricity actually consumed on site, not fixed rights to total PV output. Allocation remains capped by simultaneous demand; unused weight is redistributed to active tenants.</p>
          <div className="share-editor">
            {scenario.site.tenants.map((tenant, index) => (
              <label key={tenant.id}>
                <span className="tenant-marker">{String.fromCharCode(65 + index)}</span>
                <div><strong>{tenant.label}</strong><input aria-label={`${tenant.label} generation share`} type="range" min="0" max="100" step="0.5" value={draft.tenantSharesPercent[tenant.id] ?? 0} onChange={(event) => updateShare(tenant.id, Number(event.target.value))} /></div>
                <div className="input-suffix share-input"><input aria-label={`${tenant.label} generation share percent`} type="number" min="0" max="100" step="0.5" value={draft.tenantSharesPercent[tenant.id] ?? 0} onChange={(event) => updateShare(tenant.id, Number(event.target.value))} /><i>%</i></div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="ppa-output-grid">
        <article className="model-translation">
          <div className="ppa-card-heading"><span>03</span><div><small>MODEL TRANSLATION</small><h3>What GreenProof will calculate</h3></div></div>
          <dl>
            <div><dt>Tenant experience</dt><dd>{isManagedTariff ? "Automatic meter-led settlement" : "Negotiated allocation weights"}</dd></div>
            <div><dt>Engine rule</dt><dd><code>{conversion.allocationRule?.id ?? "invalid"}@1.0.0</code></dd></div>
            <div><dt>Settlement interval</dt><dd>{scenario.granularityMinutes} minutes</dd></div>
            <div><dt>Tenant cap</dt><dd>Actual same-interval demand</dd></div>
            <div><dt>Site cap</dt><dd>Same-interval onsite matched generation</dd></div>
            <div><dt>Grid shortfall</dt><dd>Automatic top-up supply</dd></div>
            <div><dt>Certificate disclosure</dt><dd>{CERTIFICATE_LABELS[draft.certificateTreatment]}</dd></div>
          </dl>
          <details className="model-json"><summary>Inspect generated engine parameters</summary><pre>{JSON.stringify(conversion.allocationRule ?? { errors: conversion.errors }, null, 2)}</pre></details>
          {conversion.errors.length ? <div className="contract-errors" role="alert">{conversion.errors.map((error) => <span key={error}>{error}</span>)}</div> : null}
          <button className="primary-button" disabled={!conversion.allocationRule} onClick={() => conversion.allocationRule && applyContract(conversion.allocationRule)}>
            Apply this tenant agreement to simulation <span>→</span>
          </button>
          <p className="privacy-note">Evidence packages bind the applied rule and tenant shares. Contract reference, price and certificate disclosure remain demonstration metadata in this MVP and are not yet signed or embedded in EvidencePackage.</p>
        </article>

        <article className="contract-impact">
          <div className="ppa-card-heading"><span>04</span><div><small>FORECAST IMPACT</small><h3>What these shares produce</h3></div></div>
          {impact ? (
            <div className="impact-list">
              {scenario.site.tenants.map((tenant, index) => (
                <div key={tenant.id}><span><i>{String.fromCharCode(65 + index)}</i>{tenant.label}</span><strong>{formatPercent(impact.tenantGreenShare[tenant.id])}</strong><small>{formatEnergy(impact.tenantAllocationWh[tenant.id])} locally matched</small></div>
              ))}
            </div>
          ) : <p>Resolve the contract errors to preview its allocation impact.</p>}
        </article>
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
  const [ppaDraft, setPpaDraft] = useState<PpaContractDraft>(DEFAULT_PPA_DRAFT);
  const [contractShares, setContractShares] = useState<Record<string, number>>(
    Object.fromEntries(Object.entries(DEFAULT_PPA_SHARES_PERCENT).map(([id, share]) => [id, share / 100])),
  );
  const [activeContractReference, setActiveContractReference] = useState<string | null>(null);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>("year");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
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
      .then((data) => {
        const prepared = preparePilotScenario(data);
        const defaultDate = `${prepared.representativeDay.slice(0, 4)}-06-15`;
        setScenario(prepared);
        setSelectedMonth(monthKey(defaultDate));
        setSelectedDate(defaultDate);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const rule = useMemo(() => {
    const baseRule = DEFAULT_RULES.find((item) => item.id === ruleId) ?? DEFAULT_RULES[0];
    if (!scenario) return baseRule;
    const tenantIds = scenario.site.tenants.map((tenant) => tenant.id);
    if (baseRule.id === "priority_v1") return { ...baseRule, priority: tenantIds };
    if (baseRule.id === "contract_share_v1") {
      return { ...baseRule, shares: Object.fromEntries(tenantIds.map((id) => [id, contractShares[id] ?? 0])) };
    }
    return baseRule;
  }, [contractShares, ruleId, scenario]);
  const availableMonths = useMemo(() => scenario
    ? [...new Set(scenario.site.generation.points.map((point) => monthKey(point.startUtc)))]
    : [], [scenario]);
  const availableDates = useMemo(() => scenario
    ? [...new Set(scenario.site.generation.points
      .filter((point) => monthKey(point.startUtc) === selectedMonth)
      .map((point) => dateKey(point.startUtc)))]
    : [], [scenario, selectedMonth]);
  const summaryScenario = useMemo(() => {
    if (!scenario || analysisScope === "year") return scenario;
    if (analysisScope === "month") return sliceScenario(scenario, (point) => monthKey(point.startUtc) === selectedMonth);
    return sliceScenario(scenario, (point) => dateKey(point.startUtc) === selectedDate);
  }, [analysisScope, scenario, selectedDate, selectedMonth]);
  const detailScenario = useMemo(() => scenario
    ? sliceScenario(scenario, (point) => dateKey(point.startUtc) === selectedDate)
    : null, [scenario, selectedDate]);
  const evidenceScenario = useMemo(() => {
    if (!scenario) return null;
    if (analysisScope === "year") {
      return sliceScenario(scenario, (point) => monthKey(point.startUtc) === selectedMonth);
    }
    return summaryScenario;
  }, [analysisScope, scenario, selectedMonth, summaryScenario]);
  const summaryIntervals = useMemo(() => summaryScenario ? matchScenario(summaryScenario, rule) : [], [summaryScenario, rule]);
  const detailIntervals = useMemo(() => detailScenario ? matchScenario(detailScenario, rule) : [], [detailScenario, rule]);

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
        const prepared = preparePilotScenario(data);
        const defaultDate = `${prepared.representativeDay.slice(0, 4)}-06-15`;
        setScenario(prepared);
        setSelectedMonth(monthKey(defaultDate));
        setSelectedDate(defaultDate);
        setAnalysisScope("year");
        setTimeIndex(12);
        setEvidenceSession(null);
        setEvidenceFileError(null);
        syncUrl({ scenario: id, time: 12 });
      })
      .catch((error: Error) => setLoadError(error.message));
  }

  async function generateProof() {
    if (!evidenceScenario) return;
    setEvidenceOperation("generating");
    setEvidenceFileError(null);
    try {
      const evidencePackage = await buildEvidencePackage(evidenceScenario, rule);
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

  function applyPpaContract(contractRule: AllocationRule) {
    if (contractRule.id === "contract_share_v1") {
      if (!contractRule.shares) return;
      setContractShares(contractRule.shares);
    }
    setActiveContractReference(ppaDraft.reference);
    setRuleId(contractRule.id);
    setEvidenceSession(null);
    setEvidenceFileError(null);
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

  const safeTimeIndex = Math.min(timeIndex, Math.max(0, detailIntervals.length - 1));
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
        <div className="period-controls" aria-label="Analysis period">
          <label><span>Analysis window</span><select value={analysisScope} onChange={(event) => setAnalysisScope(event.target.value as AnalysisScope)}><option value="year">Full year</option><option value="month">Selected month</option><option value="day">Selected day</option></select></label>
          <label><span>Month</span><select value={selectedMonth} onChange={(event) => { const month = event.target.value; const firstDate = scenario.site.generation.points.find((point) => monthKey(point.startUtc) === month); setSelectedMonth(month); if (firstDate) setSelectedDate(dateKey(firstDate.startUtc)); setTimeIndex(12); }}>
            {availableMonths.map((month) => <option value={month} key={month}>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))}</option>)}
          </select></label>
          <label><span>Day for hourly detail</span><select value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setTimeIndex(12); }}>
            {availableDates.map((date) => <option value={date} key={date}>{new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}</option>)}
          </select></label>
          <p><strong>{analysisScope === "year" ? "Annual totals" : analysisScope === "month" ? "Monthly totals" : "Daily totals"}</strong><span>Hourly detail: {selectedDate || "selected day"}. {analysisScope === "year" ? "Annual evidence is batched by the selected month." : "Evidence follows this analysis window."}</span></p>
        </div>
        {view === "twin" && detailScenario ? <SiteTwin scenario={detailScenario} intervals={detailIntervals} index={safeTimeIndex} setIndex={(value) => { setTimeIndex(value); syncUrl({ time: value }); }} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} /> : null}
        {view === "matching" && detailScenario ? <DailyMatching scenario={detailScenario} intervals={detailIntervals} index={safeTimeIndex} setIndex={(value) => { setTimeIndex(value); syncUrl({ time: value }); }} selectedTenantId={selectedTenantId} /> : null}
        {view === "contract" ? <PpaContractView scenario={scenario} draft={ppaDraft} setDraft={(draft) => { setPpaDraft(draft); setActiveContractReference(null); }} applyContract={applyPpaContract} activeContractReference={activeContractReference} /> : null}
        {view === "summary" && summaryScenario ? <PeriodSummary scenario={summaryScenario} intervals={summaryIntervals} /> : null}
        {view === "evidence" ? (
          <EvidenceView
            scenario={evidenceScenario ?? scenario}
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
