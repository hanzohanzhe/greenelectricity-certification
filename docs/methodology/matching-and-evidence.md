# Matching and evidence method

For each interval:

```text
total demand = tenant A demand + tenant B demand
onsite matched = min(generation, total demand)
export = generation - onsite matched
grid import = total demand - onsite matched
```

The default `pro_rata_demand_v1` rule allocates onsite electricity in proportion
to simultaneous demand. `priority_v1` serves Tenant A first.
`contract_share_v1` first applies a 60/40 entitlement, caps each allocation at
the tenant's load, and deterministically redistributes spare energy.

Every rule satisfies:

```text
sum(tenant allocations) = onsite matched
onsite matched + export = generation
sum(tenant grid imports) = grid import
tenant allocation <= tenant demand
```

Canonical JSON recursively sorts object keys, preserves array order and uses
standard JSON primitives. Each interval result plus a versioned nonce is a
SHA-256 Merkle leaf. When a level has an odd leaf, the last hash is duplicated.
The manifest commits source descriptors, alignment, rule and result hash.

The demonstration nonce is deterministic for reproducibility. A later private
disclosure package would use random nonces. Hashing is not anonymisation, and a
Merkle root proves that disclosed data matches a commitment—not that upstream
metering was accurate.

## Versioned evidence package

`EvidencePackage` version 1.0.0 is a JSON-serializable disclosure bundle. It
contains the scenario, deterministic interval results, manifest, manifest hash,
demonstration attestation and one inclusion proof for every interval. Including
the scenario allows an independent verifier to run the published allocation
rule again rather than trusting the packaged result array.

The manifest binds:

- canonical scenario hash;
- canonical interval-result hash;
- allocation rule ID, version and parameters;
- period and granularity;
- engine and transformation versions;
- Merkle root.

Each `IntervalProof` records its leaf index, declared leaf hash, deterministic
demo nonce, and ordered sibling path. Every path node records whether the
sibling is on the left or right. Verification recomputes the leaf hash from the
interval and nonce. For an unpaired final node, the verifier requires the right
sibling to equal the current node, preserving the documented duplicate-last
rule.

## Independent verification

`verifyEvidencePackage` accepts parsed JSON or a serialized JSON string and
returns structured checks, errors and warnings. It does not consume UI state or
previously calculated success flags. It independently:

1. checks the package version and required shape;
2. binds the package, scenario, manifest and attestation scenario IDs;
3. validates the rule ID/version across manifest, intervals and attestation;
4. reruns the matching engine from the packaged scenario and manifest rule;
5. recomputes canonical scenario and interval-result hashes;
6. rebuilds the Merkle root from interval content and proof nonces;
7. verifies every inclusion path, including direction and expected path depth;
8. recomputes the manifest hash;
9. recomputes period boundaries and attestation totals;
10. binds the attestation proof ID, manifest hash and Merkle root.

Malformed external packages return a failed `VerificationResult`; they do not
crash the caller. Direct proof-programming errors such as an out-of-range index,
invalid hash encoding or illegal sibling position fail explicitly.

## Security boundary

A valid result proves only that the package is internally self-consistent under
the published algorithms and still matches its declared hashes. There is no
trusted timestamp, digital signature, issuer identity or external anchor.
Consequently, verification cannot prove that source meters were truthful, that
a completely rewritten and re-hashed package came from an authorised issuer,
that anything was written to a blockchain, or that the demonstration has legal
certificate status. Deterministic demo nonces support reproducibility and are
not production privacy protection.

The fixed five-interval Golden Dataset is stored at
`tests/fixtures/evidence-package.golden.json`. It includes the fixed input,
intervals, nonces, manifest, manifest hash, Merkle root, all proofs, the first
fixed path and expected check results. Regenerate it intentionally with
`npm run fixture:evidence`; normal tests only read the frozen file.

## Browser-local download and verification

The Evidence view now calls `buildEvidencePackage` and immediately passes the
result to `verifyEvidencePackage`. The displayed status, individual checks,
errors and warnings come directly from that independent result. The 1 Wh
demonstration changes a copied interval and submits the changed package to the
same verifier; restoring it reruns verification on the original package. A
selected interval can also be checked independently with `verifyMerkleProof`,
which recomputes its leaf from interval content and nonce.

Users can download the complete package as deterministic canonical JSON and
later load one JSON file from local disk. File handling has a 5 MiB limit and
returns structured errors for empty, malformed, unsupported or incomplete
packages. File names, extensions and MIME types are convenience hints only;
the package content and verification result determine validity. Imported
content is not executed, uploaded, written to the URL or saved in browser
storage. Temporary download object URLs are revoked immediately after use.

An EvidencePackage contains the complete scenario and all interval-level data.
The public-data demonstration is anonymous, but a real pilot package may reveal
commercially sensitive generation and demand patterns. Production disclosure
therefore requires an explicit access-control and data-minimisation design.
Browser-local processing reduces unintended disclosure in this MVP but does
not itself provide encryption, anonymity or authorisation.

Successful local verification continues to prove package self-consistency
only. It does not add a trusted issuer signature, a trusted timestamp or an
external anchor. A party can rewrite a whole package and recompute every hash,
so internal validity alone cannot establish issuer identity or source truth.
