# Public source register

## Cambridge University Estates Building Energy Archive

- Publisher: Energy Efficient Cities Initiative, University of Cambridge
- Repository: https://github.com/EECi/Cambridge-Estates-Building-Energy-Archive
- Version used: repository v2.1 content, 2022 building files
- Licence: MIT
- Selected anonymous IDs: `UCam_Building_b53` and `UCam_Building_b46`
- Selection: b53 has a strong daytime-to-night load ratio; b46 has a stable
  base-load shape. Both have complete 2022 hourly output in the archive.
- Important limitation: the published files aggregate raw half-hour readings to
  hourly, remove duplicates, replace missing/invalid values with zero, clip
  outliers and round. GreenProof labels these values `aggregated`, not raw meter
  readings.

## Cambridge solar model

- Publisher/source: Renewables.ninja excerpt distributed with the Cambridge
  archive
- Coordinates: approximately 52.194, 0.131
- Parameters: 1 kW reference capacity, 10% system loss, fixed tilt 35°,
  azimuth 180°, MERRA-2 reanalysis
- GreenProof scaling: Wh/kWp × 60 kWp
- Classification: `modelled`; it is not a rooftop meter.

## Open Climate Fix UK PV

- Catalogue: https://huggingface.co/datasets/openclimatefix/uk_pv
- Licence: CC BY 4.0
- Relevance: measured AC-side half-hour cumulative generation for more than
  30,000 UK systems, with locations reduced to roughly 1 km precision.
- MVP decision: the multi-gigabyte collection is not downloaded or redistributed
  in the default build. It is the preferred measured-PV replacement in the next
  data-validation phase.

## Elexon profiling

- Reference: https://www.elexon.co.uk/bsc/settlement/profiling/
- Use: profile semantics and annual-to-interval fallback only.
- Classification: `profile_scaled`.
- Limitation: the bundled fallback is an explicitly illustrative class-informed
  shape, not a dated official coefficient release.

## NESO Historic Demand

- Portal: https://www.neso.energy/data-portal/historic-demand-data
- Snapshot used: official 2025 demand CSV
- Use: GB system context only. It is never scaled down to impersonate a building.

ND-NEED can support later annual magnitude benchmarking but is not used to
fabricate a building interval curve.
