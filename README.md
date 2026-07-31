# GreenProof MVP

GreenProof is a public-data-driven digital twin for a shared rooftop PV system
serving two tenants. It reconstructs interval-level generation, demand, local
matching, grid import and export; then commits the result to a reproducible
evidence manifest and Merkle root.

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

The published demo is fully offline after build: all three small scenario
packages are bundled under `public/data/scenarios`.

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
