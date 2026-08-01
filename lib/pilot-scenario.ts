import type { Provenance, Scenario, Tenant, TimeSeriesPoint } from "./contracts";

export const PILOT_ROOFTOP_CAPACITY_KWP = 125;
export const PILOT_ROOFTOP_PEAK_W = 100_000;
export const PILOT_TENANT_LIMIT = 8;

type LoadShape = {
  id: string;
  label: string;
  description: string;
  peakW: number;
  values: number[];
};

export const PILOT_LOAD_SHAPES: LoadShape[] = [
  { id: "tenant-a", label: "A · office and teaching", description: "Fast morning ramp, occupied-hours plateau and evening decline.", peakW: 10_000, values: [2.2,2.0,1.9,1.8,1.9,2.3,3.4,5.8,8.2,9.3,9.7,10,9.8,9.6,9.7,9.4,8.8,7.5,5.5,4.0,3.2,2.8,2.5,2.3] },
  { id: "tenant-b", label: "B · steady base", description: "High continuous base load with a modest daytime lift.", peakW: 9_800, values: [6.8,6.7,6.7,6.6,6.6,6.7,7.0,7.4,8.0,8.5,8.8,9.0,9.3,9.5,9.8,9.6,9.3,8.9,8.3,7.8,7.4,7.1,6.9,6.8] },
  { id: "tenant-c", label: "C · morning peak", description: "Early operational peak followed by a lower afternoon load.", peakW: 10_200, values: [2.4,2.3,2.2,2.2,2.5,3.8,6.8,9.4,10.2,9.7,8.6,7.5,6.8,6.3,5.9,5.6,5.2,4.8,4.3,3.7,3.2,2.9,2.7,2.5] },
  { id: "tenant-d", label: "D · evening peak", description: "Low daytime demand and a pronounced late-afternoon and evening peak.", peakW: 10_000, values: [2.6,2.5,2.4,2.4,2.3,2.3,2.5,2.8,3.1,3.4,3.7,4.0,4.3,4.8,5.6,6.8,8.2,9.4,10,9.6,8.4,6.7,4.8,3.4] },
  { id: "tenant-e", label: "E · double peak", description: "Distinct morning and evening peaks separated by a midday trough.", peakW: 9_600, values: [2.1,2.0,1.9,1.9,2.1,3.0,5.6,8.2,9.6,8.8,7.0,5.8,5.2,5.0,5.4,6.3,7.7,9.0,9.4,8.2,6.3,4.5,3.2,2.5] },
  { id: "tenant-f", label: "F · midday production", description: "Production load concentrated around the strongest solar hours.", peakW: 10_400, values: [1.8,1.7,1.7,1.6,1.7,2.0,2.8,4.2,6.4,8.3,9.7,10.4,10.3,10.1,9.5,8.4,6.9,5.0,3.5,2.7,2.3,2.1,2.0,1.9] },
  { id: "tenant-g", label: "G · intermittent equipment", description: "A moderate base with deterministic short equipment-operation peaks.", peakW: 9_900, values: [3.0,2.9,2.9,2.8,2.8,3.0,3.2,7.8,4.0,4.3,9.9,4.7,4.8,8.7,4.5,4.4,9.2,4.0,3.8,6.8,3.5,3.3,3.2,3.1] },
  { id: "tenant-h", label: "H · long flat top", description: "A long, stable working-hours plateau with gentle ramps.", peakW: 10_100, values: [2.3,2.2,2.2,2.1,2.2,2.5,3.4,5.5,8.2,9.7,10,10.1,10.1,10,10,9.9,9.7,8.6,6.5,4.7,3.5,2.9,2.6,2.4] },
];

function pointFromTemplate(
  template: TimeSeriesPoint,
  energyWh: number,
  sourceRecordId: string,
  provenance: Provenance,
  qualityFlag: string,
): TimeSeriesPoint {
  return {
    ...template,
    energyWh,
    provenance,
    qualityFlags: [...new Set([...template.qualityFlags, qualityFlag])],
    sourceRecordId,
  };
}

function buildTenant(shape: LoadShape, templates: TimeSeriesPoint[]): Tenant {
  const rawValues = templates.map((template, index) => {
    const date = new Date(template.startUtc);
    const dayOfYear = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000);
    const weekendFactor = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.78 : 1;
    const winterFactor = 1 + 0.08 * Math.cos((2 * Math.PI * dayOfYear) / 365);
    const variation = 0.96 + (((dayOfYear * 17 + index + shape.id.charCodeAt(7)) % 9) / 100);
    return shape.values[date.getUTCHours()] * weekendFactor * winterFactor * variation;
  });
  const scale = shape.peakW / Math.max(...rawValues);
  return {
    id: shape.id,
    label: shape.label,
    description: `${shape.description} Deterministic simulated pilot profile with a ${(shape.peakW / 1000).toFixed(1)} kW peak.`,
    demand: {
      id: `${shape.id}-pilot-demand`,
      label: `${shape.label} demand · simulated`,
      points: templates.map((template, index) =>
        pointFromTemplate(
          template,
          Math.round(rawValues[index] * scale),
          `greenproof-eight-user-year-v1:${shape.id}:${index}`,
          "profile_scaled",
          "simulated_pilot_load_shape",
        ),
      ),
    },
  };
}

function annualTemplates(scenario: Scenario): TimeSeriesPoint[] {
  const year = Number(scenario.representativeDay.slice(0, 4));
  const template = scenario.site.generation.points[0];
  const hours = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000;
  return Array.from({ length: hours }, (_, index) => {
    const start = new Date(Date.UTC(year, 0, 1, index));
    const end = new Date(Date.UTC(year, 0, 1, index + 1));
    return {
      ...template,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      energyWh: 0,
      sourceRecordId: `greenproof-calendar-v1:${start.toISOString()}`,
    };
  });
}

function annualPvValues(templates: TimeSeriesPoint[]): number[] {
  const raw = templates.map((point) => {
    const date = new Date(point.startUtc);
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    const day = Math.floor((date.getTime() - yearStart) / 86_400_000);
    const seasonalPosition = Math.cos((2 * Math.PI * (day - 172)) / 365);
    const daylightHours = 12 + 4 * seasonalPosition;
    const sunrise = 12 - daylightHours / 2;
    const solarPosition = (date.getUTCHours() + 0.5 - sunrise) / daylightHours;
    if (solarPosition <= 0 || solarPosition >= 1) return 0;
    const clearSky = Math.sin(Math.PI * solarPosition) ** 1.55;
    const seasonalYield = 0.48 + 0.52 * ((seasonalPosition + 1) / 2);
    const cloudFactor = 0.68 + (((day * 29 + date.getUTCHours() * 7) % 29) / 100);
    return clearSky * seasonalYield * cloudFactor;
  });
  const peak = Math.max(...raw);
  return raw.map((value) => Math.round((value / peak) * PILOT_ROOFTOP_PEAK_W));
}

/** Build the deterministic 1-roof/8-user circuit used by the local Pilot. */
export function preparePilotScenario(scenario: Scenario): Scenario {
  const templates = annualTemplates(scenario);
  const pvValues = annualPvValues(templates);
  const tenants = PILOT_LOAD_SHAPES.map((shape) => buildTenant(shape, templates));
  return {
    ...scenario,
    label: `${scenario.label} · eight-user circuit`,
    description: "One simulated 100 kW-peak rooftop source serving eight distinct, approximately 10 kW-peak user profiles on a shared low-voltage bus.",
    site: {
      ...scenario.site,
      label: "Cambridge eight-user shared-roof pilot",
      generation: {
        ...scenario.site.generation,
        id: "shared-rooftop-pv-100kw-peak",
        label: `${PILOT_ROOFTOP_CAPACITY_KWP} kWp rooftop · 100 kW simulated peak`,
        capacityKwp: PILOT_ROOFTOP_CAPACITY_KWP,
        points: templates.map((point, index) =>
          pointFromTemplate(
            point,
            pvValues[index],
            `greenproof-eight-user-year-v1:pv:${index}`,
            "modelled",
            "simulated_100kw_peak_pv",
          ),
        ),
      },
      tenants,
    },
    qualitySummary: [
      ...scenario.qualitySummary,
      "Pilot circuit uses eight deterministic simulated annual load shapes and a seasonal, weather-shaped 100 kW peak PV profile.",
      "Values demonstrate allocation and evidence mechanics; they are not electrical design or revenue-grade meter data.",
    ],
  };
}
