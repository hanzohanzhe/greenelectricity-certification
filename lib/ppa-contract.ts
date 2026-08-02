import type { AllocationRule, Scenario } from "./contracts";

export type CertificateTreatment =
  | "not_issued"
  | "included_with_tenant"
  | "retained_by_owner"
  | "sold_separately"
  | "unknown";

export interface PpaContractDraft {
  reference: string;
  effectiveFrom: string;
  effectiveTo: string;
  pricePencePerKwh: number;
  allocationBasis: "metered_onsite_consumption" | "same_interval_generation_share";
  unusedEntitlement: "not_applicable" | "redistribute_to_active_loads";
  certificateTreatment: CertificateTreatment;
  tenantSharesPercent: Record<string, number>;
}

export interface PpaConversionResult {
  valid: boolean;
  errors: string[];
  totalSharePercent: number;
  allocationRule?: AllocationRule;
  modelParameters: {
    intervalMinutes: number;
    tenantDemandCap: true;
    totalAllocationCap: "same_interval_onsite_matched_generation";
    unusedEntitlement: PpaContractDraft["unusedEntitlement"];
  };
}

export function convertPpaContract(
  scenario: Scenario,
  draft: PpaContractDraft,
): PpaConversionResult {
  const errors: string[] = [];
  if (!draft.reference.trim()) errors.push("Contract reference is required.");
  const from = Date.parse(`${draft.effectiveFrom}T00:00:00Z`);
  const to = Date.parse(`${draft.effectiveTo}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    errors.push("The effective end date must be later than the start date.");
  }
  if (!Number.isFinite(draft.pricePencePerKwh) || draft.pricePencePerKwh < 0) {
    errors.push("The PPA price must be zero or greater.");
  }

  const tenantIds = scenario.site.tenants.map((tenant) => tenant.id);
  tenantIds.forEach((tenantId) => {
    const share = draft.tenantSharesPercent[tenantId];
    if (!Number.isFinite(share) || share < 0 || share > 100) {
      errors.push(`Invalid generation share for ${tenantId}.`);
    }
  });
  const totalSharePercent = tenantIds.reduce(
    (sum, tenantId) => sum + (Number.isFinite(draft.tenantSharesPercent[tenantId]) ? draft.tenantSharesPercent[tenantId] : 0),
    0,
  );
  if (draft.allocationBasis === "same_interval_generation_share" && Math.abs(totalSharePercent - 100) > 0.001) {
    errors.push("Tenant generation shares must total exactly 100%.");
  }

  const allocationRule: AllocationRule | undefined = errors.length
    ? undefined
    : draft.allocationBasis === "metered_onsite_consumption"
      ? { id: "pro_rata_demand_v1", version: "1.0.0" }
      : {
          id: "contract_share_v1",
          version: "1.0.0",
          shares: Object.fromEntries(tenantIds.map((tenantId) => [tenantId, draft.tenantSharesPercent[tenantId] / 100])),
        };

  return {
    valid: errors.length === 0,
    errors,
    totalSharePercent,
    allocationRule,
    modelParameters: {
      intervalMinutes: scenario.granularityMinutes,
      tenantDemandCap: true,
      totalAllocationCap: "same_interval_onsite_matched_generation",
      unusedEntitlement: draft.unusedEntitlement,
    },
  };
}
