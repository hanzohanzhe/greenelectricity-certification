import type { DataSourceDescriptor, Provenance } from "./contracts";

export type OperationalStream = "generation" | "gridExchange" | "tenantDemand";

export interface DeviceInterfaceOption {
  id: string;
  label: string;
  deviceExamples: string;
  interfaces: string[];
  status: "current-demo" | "integration-ready";
}

export type DeviceInterfaceSelection = Record<OperationalStream, string>;

export const DEVICE_INTERFACE_OPTIONS: Record<OperationalStream, DeviceInterfaceOption[]> = {
  generation: [
    { id: "historical_archive", label: "Historical operational data file", deviceExamples: "Existing inverter or generation-meter export", interfaces: ["CSV", "JSON", "SFTP"], status: "current-demo" },
    { id: "pv_gateway", label: "PV inverter / plant gateway", deviceExamples: "Inverter fleet gateway or plant controller", interfaces: ["SunSpec Modbus TCP", "Modbus RTU/TCP", "Vendor REST API"], status: "integration-ready" },
    { id: "generation_meter", label: "Generation revenue meter", deviceExamples: "Dedicated meter at inverter output", interfaces: ["DLMS/COSEM", "Modbus RTU/TCP", "Meter gateway API"], status: "integration-ready" },
  ],
  gridExchange: [
    { id: "historical_archive", label: "Historical operational data file", deviceExamples: "Existing import/export interval archive", interfaces: ["CSV", "JSON", "SFTP"], status: "current-demo" },
    { id: "bidirectional_meter", label: "Bidirectional site meter", deviceExamples: "Main incomer import/export meter", interfaces: ["DLMS/COSEM", "Modbus RTU/TCP", "Utility meter API"], status: "integration-ready" },
    { id: "site_ems", label: "Site EMS / meter-data platform", deviceExamples: "Energy management or head-end system", interfaces: ["OPC UA", "MQTT", "REST API"], status: "integration-ready" },
  ],
  tenantDemand: [
    { id: "historical_archive", label: "Historical operational data file", deviceExamples: "Existing tenant submeter interval archive", interfaces: ["CSV", "JSON", "SFTP"], status: "current-demo" },
    { id: "tenant_submeters", label: "Tenant electricity submeters", deviceExamples: "DIN-rail, panel or revenue-grade submeters", interfaces: ["Modbus RTU/TCP", "M-Bus", "Meter gateway API"], status: "integration-ready" },
    { id: "building_system", label: "BMS / EMS aggregation", deviceExamples: "Building controls or energy-data gateway", interfaces: ["BACnet/IP", "OPC UA", "MQTT", "REST API"], status: "integration-ready" },
  ],
};

export const DEFAULT_DEVICE_INTERFACE_SELECTION: DeviceInterfaceSelection = {
  generation: "historical_archive",
  gridExchange: "historical_archive",
  tenantDemand: "historical_archive",
};

const RELIABILITY_LABELS: Record<Provenance, string> = {
  measured: "Meter-origin record",
  modelled: "Model reconstruction from a historical source",
  profile_scaled: "Historical profile scaled for this Pilot",
  aggregated: "Aggregated historical record",
  interpolated: "Historical record with interpolated intervals",
  extrapolated: "Historical record with extrapolated intervals",
  user_provided: "User-declared historical record",
};

export function describeHistoricalSource(source: DataSourceDescriptor) {
  return {
    recordClass: "Historical operational data",
    sourceDate: source.retrievedAt,
    reliability: RELIABILITY_LABELS[source.provenance],
  };
}

export function selectedDeviceOption(stream: OperationalStream, selection: DeviceInterfaceSelection) {
  return DEVICE_INTERFACE_OPTIONS[stream].find((option) => option.id === selection[stream])
    ?? DEVICE_INTERFACE_OPTIONS[stream][0];
}
