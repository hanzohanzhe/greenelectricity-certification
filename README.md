# GreenProof MVP

GreenProof is a public-data-driven digital twin for a shared rooftop PV system.
The current complex Pilot models one 100 kW-peak rooftop source serving eight
distinct, approximately 10 kW-peak tenant load profiles on a shared low-voltage
bus. It reconstructs hourly generation, demand, tenant-level local matching,
grid import and export across a full year; then commits the result to a
reproducible evidence manifest and Merkle root.

This is a demonstration, not an official energy certificate. It does not issue
tokens, claim avoided emissions, score additionality, or prove the truth of a
source meter.

## Run locally

Prerequisite: Node.js 22.13+ and Python 3.11+.

```powershell
npm ci
python data-pipeline/build_scenarios.py
npm test
npm run dev
```

The published demo is fully offline after build. Three compact public-data
source scenarios are bundled under `public/data/scenarios` and deterministically
expanded into the annual eight-tenant Pilot in the browser.

## Current Pilot capabilities

- Simulated 100 kW-peak rooftop PV and eight distinct tenant demand profiles.
- Full-year analysis with month and day selection plus hourly drill-down.
- Deterministic integer-Wh reconciliation of generation, local consumption,
  tenant allocation, grid import and export.
- Meter-led pro-rata, priority and contract-share allocation rules.
- A PPA-to-model demonstration with a simple metered rooftop tariff and an
  advanced reserved-weight mode.
- Tenant-level explanations of when and why rooftop electricity was or was not
  allocated.
- Historical-operational-data labels with source dates, categorical reliability
  descriptions and selectable future device/API ingestion routes.
- A downloadable one-page human-readable operational evidence report.
- Downloadable, versioned EvidencePackage JSON with canonical hashing, Merkle
  inclusion proofs and independent verification.

## Architecture

- `app/`, `components/`: vinext / React interface
- `lib/contracts.ts`: shared data contracts and validation
- `lib/energy-engine.ts`: deterministic integer-Wh allocation engine
- `lib/evidence.ts`: canonical JSON, SHA-256, Merkle and attestation
- `lib/evidence-file.ts`: deterministic local package files, import checks and tamper helpers
- `data-pipeline/`: reproducible public-data scenario builders
- `public/data/scenarios/`: deployable, anonymised snapshots
- `docs/`: method, sources, pilot and privacy decisions
- `tests/`: golden, property, tamper and rendered-build tests
- `outputs/greenproof-mvp-codex-prompts/`: original prompts and execution logs

The Evidence view can generate and download a complete JSON package, load one
from local disk, and display the independent verifier's recomputed checks. File
contents stay in the browser; no upload endpoint, identity system or database
is used.

## Commands

```powershell
npm run typecheck
npm run test:unit
npm run build
npm test
python data-pipeline/validate_scenario.py public/data/scenarios/cambridge-campus-real.json
```

No runtime environment variables, identity system or database are required.
Future data-source credentials must be supplied through environment variables;
see `.env.example`.

## Product boundary

The MVP demonstrates objective evidence relevant to additionality, temporal
matching and location matching without assigning a subjective score. Hashing
protects post-commitment integrity, not source truth or anonymity. Blockchain
anchoring remains disabled behind a provider interface until a pilot identifies
a concrete relying party and disclosure model.
