export const PROVENANCE = [
  "measured",
  "modelled",
  "profile_scaled",
  "aggregated",
  "interpolated",
  "extrapolated",
  "user_provided",
] as const;

export type Provenance = (typeof PROVENANCE)[number];

export interface DataSourceDescriptor {
  id: string;
  name: string;
  url: string;
  version: string;
  license: string;
  retrievedAt: string;
  sha256: string;
  provenance: Provenance;
  limitations: string[];
}

export interface TimeSeriesPoint {
  startUtc: string;
  endUtc: string;
  energyWh: number;
  provenance: Provenance;
  qualityFlags: string[];
  sourceRecordId: string;
}

export interface GenerationSeries {
  id: string;
  label: string;
  capacityKwp: number;
  points: TimeSeriesPoint[];
}

export interface DemandSeries {
  id: string;
  label: string;
  points: TimeSeriesPoint[];
}

export interface Tenant {
  id: string;
  label: string;
  description: string;
  demand: DemandSeries;
}

export interface Site {
  id: string;
  label: string;
  locationLabel: string;
  generation: GenerationSeries;
  tenants: Tenant[];
}

export type AllocationRuleId =
  | "pro_rata_demand_v1"
  | "priority_v1"
  | "contract_share_v1";

export interface AllocationRule {
  id: AllocationRuleId;
  version: "1.0.0";
  priority?: string[];
  shares?: Record<string, number>;
}

export interface IntervalAllocation {
  startUtc: string;
  endUtc: string;
  generationWh: number;
  totalDemandWh: number;
  onsiteMatchedWh: number;
  exportWh: number;
  gridImportWh: number;
  tenantAllocationsWh: Record<string, number>;
  tenantGridImportWh: Record<string, number>;
  status: "verified-input" | "provisional";
  qualityFlags: string[];
  ruleId: AllocationRuleId;
  ruleVersion: string;
}

export interface Scenario {
  schemaVersion: "1.0.0";
  id: string;
  label: string;
  description: string;
  representativeDay: string;
  granularityMinutes: number;
  alignment: "same_day" | "aligned_typical_day";
  site: Site;
  sources: DataSourceDescriptor[];
  context?: {
    nesoNationalDemandMw?: number[];
    label: string;
    provenance: Provenance;
  };
  qualitySummary: string[];
}

export interface EvidenceManifest {
  schemaVersion: "1.0.0";
  scenarioId: string;
  generatedAt: string;
  sources: DataSourceDescriptor[];
  period: { startUtc: string; endUtc: string; granularityMinutes: number };
  alignment: Scenario["alignment"];
  allocationRule: AllocationRule;
  engineVersion: string;
  transformationVersion: string;
  resultSha256: string;
  merkleRoot: string;
  nonceStrategy: string;
  limitations: string[];
}

export interface Attestation {
  proofId: string;
  status: "demonstration";
  scenarioId: string;
  scenarioLabel: string;
  period: { startUtc: string; endUtc: string };
  totalsWh: {
    generation: number;
    onsiteMatched: number;
    tenantAllocations: Record<string, number>;
  };
  ruleId: AllocationRuleId;
  manifestHash: string;
  merkleRoot: string;
  verificationUrl: string;
  blockchainAnchoring: "not_enabled";
}

export function validatePoint(point: TimeSeriesPoint): void {
  if (!Number.isInteger(point.energyWh) || point.energyWh < 0) {
    throw new Error("energyWh must be a non-negative integer");
  }
  if (!PROVENANCE.includes(point.provenance)) {
    throw new Error(`Unknown provenance: ${point.provenance}`);
  }
  if (Date.parse(point.startUtc) >= Date.parse(point.endUtc)) {
    throw new Error("startUtc must be before endUtc");
  }
}

export function validateScenario(scenario: Scenario): void {
  if (scenario.site.tenants.length !== 2) {
    throw new Error("MVP scenarios require exactly two tenants");
  }
  const series = [
    scenario.site.generation.points,
    ...scenario.site.tenants.map((tenant) => tenant.demand.points),
  ];
  const length = series[0].length;
  if (!length || series.some((points) => points.length !== length)) {
    throw new Error("All time series must be non-empty and have equal length");
  }
  series.flat().forEach(validatePoint);
  for (let index = 0; index < length; index += 1) {
    const key = `${series[0][index].startUtc}/${series[0][index].endUtc}`;
    if (series.some((points) => `${points[index].startUtc}/${points[index].endUtc}` !== key)) {
      throw new Error(`Time series mismatch at interval ${index}`);
    }
    if (index > 0 && series[0][index - 1].endUtc !== series[0][index].startUtc) {
      throw new Error(`Time gap or overlap at interval ${index}`);
    }
  }
}
