export interface AnchorInput {
  batchId: string;
  merkleRoot: string;
  previousRoot: string;
  schemaVersion: number;
}

export interface AnchorReceipt {
  provider: "none";
  status: "not_enabled";
}

export interface AnchorProvider {
  anchorBatch(input: AnchorInput): Promise<AnchorReceipt>;
  verifyAnchor(receipt: AnchorReceipt): Promise<boolean>;
}

/**
 * The production application defaults to no chain. This seam prevents a
 * future anchoring experiment from becoming a dependency of core evidence.
 */
export class NoopAnchorProvider implements AnchorProvider {
  async anchorBatch(input: AnchorInput): Promise<AnchorReceipt> {
    void input;
    return { provider: "none", status: "not_enabled" };
  }

  async verifyAnchor(receipt: AnchorReceipt): Promise<boolean> {
    return receipt.provider === "none" && receipt.status === "not_enabled";
  }
}
