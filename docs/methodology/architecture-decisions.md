# Architecture decisions

## UTC internally; Europe/London in the interface

UTC makes interval boundaries unique through British daylight-saving changes.
The UI converts those timestamps for people in Cambridge. A source with 46, 48
or 50 settlement periods is preserved rather than coerced to a nominal day.

## Integer watt-hours

All matching and allocation uses non-negative integer Wh. Decimal arithmetic is
kept outside the engine. The largest-remainder method distributes rounding
residues deterministically, so each Wh is assigned at most once and interval
conservation is exact.

## Raw data, processed data and scenarios are separate

Raw public archives are large, mutable and subject to their own terms. Processed
data is reproducible but not necessarily redistributable. A scenario is a small,
versioned, privacy-safe excerpt that records source hashes and transformations.
The web demo publishes only scenarios.

## Provenance is part of the value

`measured`, `modelled`, `profile_scaled`, `aggregated`, `interpolated`,
`extrapolated` and `user_provided` are core contract values. A number without
its evidence class cannot support a trustworthy claim.

## No database as an MVP prerequisite

Static JSON makes the pilot demonstrable offline and its calculations easy to
reproduce. A database would add operational state before the product has proven
which evidence users want to retain.
