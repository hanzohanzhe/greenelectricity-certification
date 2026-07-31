# Replacing demo data with pilot CSVs

Provide three files: shared PV, Tenant A demand and Tenant B demand. Required
columns are:

```csv
start_utc,end_utc,energy_wh,source_record_id
2026-06-01T08:00:00Z,2026-06-01T08:30:00Z,14320,pv-meter-0001
```

All three series must describe the same, contiguous UTC intervals and use
non-negative integer Wh. Also provide meter/timezone documentation, asset
boundary, units, missing-data conventions, export/import sign convention and
permission to process the data.

The ingestion adapter must map each row to `TimeSeriesPoint`, preserve source
record identifiers, add provenance and quality flags, validate continuity and
write a new versioned scenario. Do not edit `GreenProofApp` or the allocation
engine. Validate with:

```powershell
python data-pipeline/validate_scenario.py public/data/scenarios/pilot-id.json
npm test
```

For a real pilot, raw files remain access-controlled and out of Git. Publish
only fields and aggregates explicitly authorised by the data owner.
