import type {
  EvidencePackage,
  VerificationResult,
} from "./contracts";
import {
  EVIDENCE_PACKAGE_VERSION,
  canonicalJson,
  verifyEvidencePackage,
  verifyMerkleProof,
} from "./evidence";

export const EVIDENCE_PACKAGE_MIME_TYPE = "application/vnd.greenproof.evidence+json";
export const MAX_EVIDENCE_PACKAGE_BYTES = 5 * 1024 * 1024;

export type EvidenceFileErrorCode =
  | "DOWNLOAD_FAILED"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE_SIZE"
  | "INVALID_JSON"
  | "INVALID_PACKAGE"
  | "UNSUPPORTED_SCHEMA";

export interface EvidenceFileIssue {
  code: EvidenceFileErrorCode;
  message: string;
}

export type EvidencePackageParseResult =
  | { ok: true; evidencePackage: EvidencePackage }
  | { ok: false; error: EvidenceFileIssue };

export type EvidenceFileVerificationResult =
  | {
      ok: true;
      evidencePackage: EvidencePackage;
      verification: VerificationResult;
    }
  | { ok: false; error: EvidenceFileIssue };

export interface IntervalInclusionResult {
  leafIndex: number;
  pathLength: number;
  valid: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateEvidenceFileSize(sizeBytes: number): EvidenceFileIssue | null {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    return {
      code: "INVALID_FILE_SIZE",
      message: "The evidence file size is invalid.",
    };
  }
  if (sizeBytes > MAX_EVIDENCE_PACKAGE_BYTES) {
    return {
      code: "FILE_TOO_LARGE",
      message: `Evidence files must not exceed ${MAX_EVIDENCE_PACKAGE_BYTES} bytes.`,
    };
  }
  return null;
}

export function serializeEvidencePackage(evidencePackage: EvidencePackage): string {
  return canonicalJson(evidencePackage);
}

export function parseEvidencePackage(
  text: string,
  declaredSizeBytes?: number,
): EvidencePackageParseResult {
  const encodedSize = new TextEncoder().encode(text).byteLength;
  const sizeIssue = validateEvidenceFileSize(Math.max(encodedSize, declaredSizeBytes ?? 0));
  if (sizeIssue) return { ok: false, error: sizeIssue };
  if (!text.trim()) {
    return {
      ok: false,
      error: { code: "EMPTY_FILE", message: "The selected evidence file is empty." },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      error: { code: "INVALID_JSON", message: "The selected file is not valid JSON." },
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      error: { code: "INVALID_PACKAGE", message: "An evidence package must be a JSON object." },
    };
  }
  if (parsed.schemaVersion !== EVIDENCE_PACKAGE_VERSION) {
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_SCHEMA",
        message: `Only EvidencePackage schema ${EVIDENCE_PACKAGE_VERSION} is supported.`,
      },
    };
  }
  if (
    typeof parsed.scenarioId !== "string" ||
    !isRecord(parsed.scenario) ||
    !Array.isArray(parsed.intervals) ||
    !isRecord(parsed.manifest) ||
    typeof parsed.manifestHash !== "string" ||
    !isRecord(parsed.attestation) ||
    !Array.isArray(parsed.proofs)
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_PACKAGE",
        message: "The evidence package is missing required versioned fields.",
      },
    };
  }

  return { ok: true, evidencePackage: parsed as unknown as EvidencePackage };
}

export async function verifyEvidenceFile(
  text: string,
  declaredSizeBytes?: number,
): Promise<EvidenceFileVerificationResult> {
  const parsed = parseEvidencePackage(text, declaredSizeBytes);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    evidencePackage: parsed.evidencePackage,
    verification: await verifyEvidencePackage(parsed.evidencePackage),
  };
}

function safeFilenameSegment(value: string): string {
  const segment = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return segment || "evidence";
}

export function evidencePackageFilename(evidencePackage: EvidencePackage): string {
  const scenario = safeFilenameSegment(evidencePackage.scenarioId);
  const version = safeFilenameSegment(evidencePackage.schemaVersion.replaceAll(".", "-"));
  return `greenproof-${scenario}-evidence-v${version}.json`;
}

export function createEvidencePackageBlob(evidencePackage: EvidencePackage): Blob {
  return new Blob([serializeEvidencePackage(evidencePackage)], {
    type: `${EVIDENCE_PACKAGE_MIME_TYPE};charset=utf-8`,
  });
}

export function tamperEvidencePackageOneWh(evidencePackage: EvidencePackage): EvidencePackage {
  const copy = JSON.parse(serializeEvidencePackage(evidencePackage)) as EvidencePackage;
  if (!copy.intervals.length) {
    throw new Error("Cannot demonstrate tampering on an evidence package without intervals");
  }
  copy.intervals[0].generationWh += 1;
  return copy;
}

export async function verifyEvidenceInterval(
  evidencePackage: EvidencePackage,
  leafIndex: number,
): Promise<IntervalInclusionResult> {
  const proof = evidencePackage.proofs[leafIndex];
  const interval = evidencePackage.intervals[leafIndex];
  const pathLength = Array.isArray(proof?.path) ? proof.path.length : 0;
  if (!proof || !interval) {
    return { leafIndex, pathLength, valid: false, error: "The selected interval proof is missing." };
  }
  try {
    const valid = await verifyMerkleProof(
      interval,
      proof,
      evidencePackage.manifest.merkleRoot,
      evidencePackage.intervals.length,
    );
    return { leafIndex, pathLength, valid };
  } catch (error) {
    return {
      leafIndex,
      pathLength,
      valid: false,
      error: error instanceof Error ? error.message : "The interval proof is malformed.",
    };
  }
}
