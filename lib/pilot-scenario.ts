import type { Scenario } from "./contracts";

export const PILOT_ROOFTOP_CAPACITY_KWP = 20;
export const PILOT_TENANT_PEAKS_W = {
  "tenant-a": 13_500,
  "tenant-b": 14_500,
} as const;

/**
 * The imported PV profiles were accidentally serialised as if their kWh values
 * were already Wh, making a 60 kWp roof peak in the tens of MW. Correct that
 * unit error, then scale the same profile shape to the 20 kWp pilot roof.
 */
export function preparePilotScenario(scenario: Scenario): Scenario {
  const generation = scenario.site.generation;
  const peakWh = Math.max(...generation.points.map((point) => point.energyWh));
  const hasKwhAsWhUnitError = peakWh > generation.capacityKwp * 1000 * 2;
  const unitCorrection = hasKwhAsWhUnitError ? 0.001 : 1;
  const capacityScale = PILOT_ROOFTOP_CAPACITY_KWP / generation.capacityKwp;
  const tenants = scenario.site.tenants.map((tenant) => {
    const sourcePeakWh = Math.max(...tenant.demand.points.map((point) => point.energyWh));
    const targetPeakWh = PILOT_TENANT_PEAKS_W[tenant.id as keyof typeof PILOT_TENANT_PEAKS_W];
    if (!targetPeakWh || !sourcePeakWh) return tenant;
    const demandScale = targetPeakWh / sourcePeakWh;
    return {
      ...tenant,
      description: `${tenant.description} The source shape is scaled to a ${targetPeakWh / 1000} kW pilot peak.`,
      demand: {
        ...tenant.demand,
        label: `${tenant.label} demand · pilot-scaled`,
        points: tenant.demand.points.map((point) => ({
          ...point,
          energyWh: Math.round(point.energyWh * demandScale),
          provenance: "profile_scaled" as const,
          qualityFlags: [...new Set([...point.qualityFlags, "pilot_peak_scaled"])],
        })),
      },
    };
  });

  return {
    ...scenario,
    description: `${scenario.description} Demand shapes are pilot-scaled to comparable 13.5 kW and 14.5 kW peaks.`,
    site: {
      ...scenario.site,
      tenants,
      generation: {
        ...generation,
        label: `${PILOT_ROOFTOP_CAPACITY_KWP} kWp shared rooftop PV`,
        capacityKwp: PILOT_ROOFTOP_CAPACITY_KWP,
        points: generation.points.map((point) => ({
          ...point,
          energyWh: Math.round(point.energyWh * unitCorrection * capacityScale),
        })),
      },
    },
  };
}
