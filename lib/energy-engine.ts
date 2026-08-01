import type {
  AllocationRule,
  IntervalAllocation,
  Scenario,
  TimeSeriesPoint,
} from "./contracts";
import { validateScenario } from "./contracts";

export const ENGINE_VERSION = "greenproof-matching/1.0.0";

function largestRemainder(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (total === 0 || weightSum === 0) return weights.map(() => 0);
  const exact = weights.map((value) => (total * value) / weightSum);
  const result = exact.map(Math.floor);
  const remaining = total - result.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remaining; index += 1) {
    result[order[index].index] += 1;
  }
  return result;
}

function proRata(onsite: number, demands: number[]): number[] {
  return largestRemainder(onsite, demands);
}

function priority(onsite: number, demands: number[], tenantIds: string[], order: string[]): number[] {
  const allocations = demands.map(() => 0);
  let remaining = onsite;
  const sortedIndexes = [
    ...order.map((id) => tenantIds.indexOf(id)).filter((index) => index >= 0),
    ...tenantIds.map((_, index) => index).filter((index) => !order.includes(tenantIds[index])),
  ];
  for (const index of sortedIndexes) {
    const allocation = Math.min(remaining, demands[index]);
    allocations[index] = allocation;
    remaining -= allocation;
  }
  return allocations;
}

function contractShare(
  onsite: number,
  demands: number[],
  tenantIds: string[],
  shares: Record<string, number>,
): number[] {
  const weights = tenantIds.map((id) => Math.max(0, shares[id] ?? 0));
  const requested = largestRemainder(onsite, weights);
  const allocations = requested.map((value, index) => Math.min(value, demands[index]));
  let remaining = onsite - allocations.reduce((sum, value) => sum + value, 0);
  while (remaining > 0) {
    const headroom = demands.map((demand, index) => demand - allocations[index]);
    const eligible = headroom.map((value, index) => (value > 0 ? weights[index] || 1 : 0));
    if (eligible.every((value) => value === 0)) break;
    const pass = largestRemainder(remaining, eligible).map((value, index) =>
      Math.min(value, headroom[index]),
    );
    const applied = pass.reduce((sum, value) => sum + value, 0);
    if (!applied) break;
    pass.forEach((value, index) => {
      allocations[index] += value;
    });
    remaining -= applied;
  }
  return allocations;
}

function quality(points: TimeSeriesPoint[]): { status: IntervalAllocation["status"]; flags: string[] } {
  const flags = [...new Set(points.flatMap((point) => point.qualityFlags))];
  return {
    status: flags.length ? "provisional" : "verified-input",
    flags,
  };
}

export function matchScenario(scenario: Scenario, rule: AllocationRule): IntervalAllocation[] {
  validateScenario(scenario);
  const tenantIds = scenario.site.tenants.map((tenant) => tenant.id);
  return scenario.site.generation.points.map((generation, index) => {
    const demandPoints = scenario.site.tenants.map((tenant) => tenant.demand.points[index]);
    const demands = demandPoints.map((point) => point.energyWh);
    const totalDemandWh = demands.reduce((sum, value) => sum + value, 0);
    const onsiteMatchedWh = Math.min(generation.energyWh, totalDemandWh);
    let allocations: number[];
    if (rule.id === "priority_v1") {
      allocations = priority(onsiteMatchedWh, demands, tenantIds, rule.priority ?? tenantIds);
    } else if (rule.id === "contract_share_v1") {
      allocations = contractShare(onsiteMatchedWh, demands, tenantIds, rule.shares ?? {});
    } else {
      allocations = proRata(onsiteMatchedWh, demands);
    }
    const state = quality([generation, ...demandPoints]);
    return {
      startUtc: generation.startUtc,
      endUtc: generation.endUtc,
      generationWh: generation.energyWh,
      totalDemandWh,
      onsiteMatchedWh,
      exportWh: generation.energyWh - onsiteMatchedWh,
      gridImportWh: totalDemandWh - onsiteMatchedWh,
      tenantAllocationsWh: Object.fromEntries(
        tenantIds.map((id, tenantIndex) => [id, allocations[tenantIndex]]),
      ),
      tenantGridImportWh: Object.fromEntries(
        tenantIds.map((id, tenantIndex) => [id, demands[tenantIndex] - allocations[tenantIndex]]),
      ),
      status: state.status,
      qualityFlags: state.flags,
      ruleId: rule.id,
      ruleVersion: rule.version,
    };
  });
}

export function summarise(scenario: Scenario, intervals: IntervalAllocation[]) {
  const tenantIds = scenario.site.tenants.map((tenant) => tenant.id);
  const tenantDemandWh = Object.fromEntries(
    tenantIds.map((id, tenantIndex) => [
      id,
      scenario.site.tenants[tenantIndex].demand.points.reduce(
        (sum, point) => sum + point.energyWh,
        0,
      ),
    ]),
  );
  const tenantAllocationWh = Object.fromEntries(
    tenantIds.map((id) => [
      id,
      intervals.reduce((sum, interval) => sum + interval.tenantAllocationsWh[id], 0),
    ]),
  );
  const generationWh = intervals.reduce((sum, interval) => sum + interval.generationWh, 0);
  const onsiteMatchedWh = intervals.reduce((sum, interval) => sum + interval.onsiteMatchedWh, 0);
  return {
    generationWh,
    onsiteMatchedWh,
    exportWh: intervals.reduce((sum, interval) => sum + interval.exportWh, 0),
    gridImportWh: intervals.reduce((sum, interval) => sum + interval.gridImportWh, 0),
    tenantDemandWh,
    tenantAllocationWh,
    tenantGreenShare: Object.fromEntries(
      tenantIds.map((id) => [
        id,
        tenantDemandWh[id] ? tenantAllocationWh[id] / tenantDemandWh[id] : 0,
      ]),
    ),
    pvSelfConsumptionRate: generationWh ? onsiteMatchedWh / generationWh : 0,
  };
}

export interface TenantGreenShortfallExplanation {
  tenantId: string;
  unmetWh: number;
  noGenerationWh: number;
  simultaneousSiteShortageWh: number;
  competingAllocationWh: number;
  competingIntervalCount: number;
  peak: {
    startUtc: string;
    generationWh: number;
    totalDemandWh: number;
    tenantDemandWh: number;
    tenantAllocationWh: number;
    exportWh: number;
    generationCouldMeetTenant: boolean;
    generationExceedsAllDemand: boolean;
  };
  ruleId: AllocationRule["id"];
  ruleVersion: string;
}

/**
 * Recomputes an explanatory breakdown from interval facts. The categories are
 * mutually exclusive and sum to the tenant's grid-supplied balance. A period
 * peak or exported surplus cannot be moved to another interval under same-time
 * matching, so peak abundance is reported separately from the shortfall causes.
 */
export function explainTenantGreenShortfall(
  scenario: Scenario,
  intervals: IntervalAllocation[],
  tenantId: string,
): TenantGreenShortfallExplanation {
  const tenant = scenario.site.tenants.find((item) => item.id === tenantId);
  if (!tenant) throw new Error(`Unknown tenant: ${tenantId}`);
  if (!intervals.length || intervals.length !== tenant.demand.points.length) {
    throw new Error("Intervals must align with the tenant demand series");
  }

  let unmetWh = 0;
  let noGenerationWh = 0;
  let simultaneousSiteShortageWh = 0;
  let competingAllocationWh = 0;
  let competingIntervalCount = 0;

  intervals.forEach((interval, index) => {
    const demandWh = tenant.demand.points[index].energyWh;
    const allocationWh = interval.tenantAllocationsWh[tenantId];
    const intervalUnmetWh = demandWh - allocationWh;
    if (intervalUnmetWh <= 0) return;
    unmetWh += intervalUnmetWh;
    if (interval.generationWh === 0) {
      noGenerationWh += intervalUnmetWh;
    } else if (interval.generationWh >= demandWh && interval.onsiteMatchedWh > allocationWh) {
      competingAllocationWh += intervalUnmetWh;
      competingIntervalCount += 1;
    } else {
      simultaneousSiteShortageWh += intervalUnmetWh;
    }
  });

  const peakIndex = intervals.reduce(
    (bestIndex, interval, index) =>
      interval.generationWh > intervals[bestIndex].generationWh ? index : bestIndex,
    0,
  );
  const peakInterval = intervals[peakIndex];
  const peakTenantDemandWh = tenant.demand.points[peakIndex].energyWh;

  return {
    tenantId,
    unmetWh,
    noGenerationWh,
    simultaneousSiteShortageWh,
    competingAllocationWh,
    competingIntervalCount,
    peak: {
      startUtc: peakInterval.startUtc,
      generationWh: peakInterval.generationWh,
      totalDemandWh: peakInterval.totalDemandWh,
      tenantDemandWh: peakTenantDemandWh,
      tenantAllocationWh: peakInterval.tenantAllocationsWh[tenantId],
      exportWh: peakInterval.exportWh,
      generationCouldMeetTenant: peakInterval.generationWh >= peakTenantDemandWh,
      generationExceedsAllDemand: peakInterval.generationWh > peakInterval.totalDemandWh,
    },
    ruleId: peakInterval.ruleId,
    ruleVersion: peakInterval.ruleVersion,
  };
}

export const DEFAULT_RULES: AllocationRule[] = [
  { id: "pro_rata_demand_v1", version: "1.0.0" },
  { id: "priority_v1", version: "1.0.0", priority: ["tenant-a", "tenant-b"] },
  {
    id: "contract_share_v1",
    version: "1.0.0",
    shares: { "tenant-a": 0.6, "tenant-b": 0.4 },
  },
];
