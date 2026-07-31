import type { Scenario } from "./contracts";

export const PILOT_ROOFTOP_CAPACITY_KWP = 20;

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

  return {
    ...scenario,
    site: {
      ...scenario.site,
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
