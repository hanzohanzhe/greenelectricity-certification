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
