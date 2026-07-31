"""Build small, deterministic GreenProof demo scenarios from public snapshots.

The script intentionally reads the Cambridge archive from work/ and writes only
the selected anonymous day into public/data/scenarios. Large source datasets are
not copied into the deployable application.
"""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAMBRIDGE = ROOT / "work" / "cambridge-estates-source"
BUILDINGS = CAMBRIDGE / "building_data" / "processed_data"
SOLAR = (
    CAMBRIDGE
    / "aux_data"
    / "RenewablesNinja Generation Data"
    / "processed_data"
    / "cambridge_52-194_0-131"
)
NESO = ROOT / "work" / "neso-demand-2025.csv"
OUTPUT = ROOT / "public" / "data" / "scenarios"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_day(path: Path, day: str, value_column: str) -> list[float]:
    with path.open(newline="", encoding="utf-8-sig") as file:
        rows = [
            float(row[value_column])
            for row in csv.DictReader(file)
            if row["datetime"].startswith(day)
        ]
    if len(rows) != 24:
        raise ValueError(f"{path} / {day}: expected 24 hourly rows, got {len(rows)}")
    return rows


def profile_scaled(day: str, annual_kwh: int, profile: str) -> list[int]:
    """Produce an explicit Elexon-style fallback shape, conserving the daily target.

    This is not claimed to reproduce a dated Elexon coefficient release. The
    public Elexon classes inform the shape semantics; it remains profile_scaled.
    """

    if profile == "pc3":
        weights = [0.32] * 7 + [0.58, 0.9, 1.2, 1.42, 1.5, 1.52, 1.48, 1.42, 1.3, 1.1, 0.82] + [0.5] * 6
    else:
        weights = [0.72] * 7 + [0.86, 0.72, 0.62, 0.58, 0.55, 0.52, 0.54, 0.58, 0.66, 0.84, 1.25, 1.48, 1.36, 1.08, 0.9, 0.8, 0.74]
    target = round(annual_kwh * 1000 / 365)
    exact = [target * weight / sum(weights) for weight in weights]
    values = [int(value) for value in exact]
    remainder = target - sum(values)
    order = sorted(range(24), key=lambda index: (-(exact[index] - values[index]), index))
    for index in order[:remainder]:
        values[index] += 1
    return values


def neso_day(day: str) -> list[int]:
    with NESO.open(newline="", encoding="utf-8-sig") as file:
        rows = [row for row in csv.DictReader(file) if row["SETTLEMENT_DATE"] == day]
    if len(rows) != 48:
        raise ValueError(f"NESO {day}: expected 48 settlement periods, got {len(rows)}")
    return [
        round((float(rows[index]["ND"]) + float(rows[index + 1]["ND"])) / 2)
        for index in range(0, 48, 2)
    ]


def points(day: str, values_wh: list[int], provenance: str, source_prefix: str, quality: list[str] | None = None):
    start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    return [
        {
            "startUtc": (start + timedelta(hours=index)).isoformat().replace("+00:00", "Z"),
            "endUtc": (start + timedelta(hours=index + 1)).isoformat().replace("+00:00", "Z"),
            "energyWh": int(value),
            "provenance": provenance,
            "qualityFlags": quality or [],
            "sourceRecordId": f"{source_prefix}:{day}T{index:02d}",
        }
        for index, value in enumerate(values_wh)
    ]


def source(source_id: str, name: str, url: str, version: str, license_name: str, path: Path, provenance: str, limitations: list[str]):
    return {
        "id": source_id,
        "name": name,
        "url": url,
        "version": version,
        "license": license_name,
        "retrievedAt": "2026-07-31T00:00:00Z",
        "sha256": sha256(path),
        "provenance": provenance,
        "limitations": limitations,
    }


def make_scenario(
    scenario_id: str,
    label: str,
    description: str,
    day: str,
    demand_a: list[int],
    demand_b: list[int],
    solar_wh: list[int],
    demand_provenance: str,
    alignment: str,
    sources: list[dict],
    context: dict | None = None,
    demand_quality: list[str] | None = None,
):
    return {
        "schemaVersion": "1.0.0",
        "id": scenario_id,
        "label": label,
        "description": description,
        "representativeDay": day,
        "granularityMinutes": 60,
        "alignment": alignment,
        "site": {
            "id": "cambridge-rooftop-demo",
            "label": "Cambridge shared-roof pilot",
            "locationLabel": "Cambridge, UK (approximate)",
            "generation": {
                "id": "shared-rooftop-pv",
                "label": "60 kWp shared rooftop PV",
                "capacityKwp": 60,
                "points": points(day, solar_wh, "modelled", "renewables-ninja-cambridge"),
            },
            "tenants": [
                {
                    "id": "tenant-a",
                    "label": "Tenant A · daytime-led",
                    "description": "An anonymous university building with a pronounced occupied-hours load shape.",
                    "demand": {
                        "id": "tenant-a-demand",
                        "label": "Tenant A demand",
                        "points": points(day, demand_a, demand_provenance, "anonymous-campus-a", demand_quality),
                    },
                },
                {
                    "id": "tenant-b",
                    "label": "Tenant B · steady base",
                    "description": "An anonymous university building with a comparatively stable base load.",
                    "demand": {
                        "id": "tenant-b-demand",
                        "label": "Tenant B demand",
                        "points": points(day, demand_b, demand_provenance, "anonymous-campus-b", demand_quality),
                    },
                },
            ],
        },
        "sources": sources,
        "context": context,
        "qualitySummary": [
            "Cambridge archive electricity was aggregated from raw half-hourly meter readings to hourly values.",
            "The archive replaces missing or invalid readings with zero; suspicious zeros remain quality-limited.",
            "PV is a Cambridge weather-reanalysis model, not a live or measured rooftop meter.",
            "Building identities remain anonymous; exact addresses are neither used nor exposed.",
        ],
    }


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    a_path = BUILDINGS / "UCam_Building_b53" / "electricity" / "2022.csv"
    b_path = BUILDINGS / "UCam_Building_b46" / "electricity" / "2022.csv"
    solar_path = SOLAR / "2022.csv"

    cambridge_source = source(
        "cambridge-estates-v2.1",
        "Cambridge University Estates Building Energy Archive",
        "https://github.com/EECi/Cambridge-Estates-Building-Energy-Archive",
        "2.1 / 2022 snapshot",
        "MIT",
        a_path,
        "aggregated",
        [
            "Anonymous building IDs.",
            "Raw half-hour readings were cleaned and aggregated to hourly by the archive.",
            "Missing or invalid archive values may have been replaced with zero.",
        ],
    )
    cambridge_source["sha256SecondaryTenant"] = sha256(b_path)
    solar_source = source(
        "renewables-ninja-cambridge",
        "Renewables.ninja Cambridge solar model (distributed in Cambridge archive)",
        "https://www.renewables.ninja/",
        "MERRA-2 / 2022 snapshot",
        "Source dataset terms; redistributed here as a derived 24-point excerpt under archive context",
        solar_path,
        "modelled",
        ["Weather reanalysis and technology model; not measured generation."],
    )

    summer_day = "2022-06-15"
    winter_day = "2022-01-12"
    a_summer = [round(value * 1000) for value in read_day(a_path, summer_day, "equipment load [kWh]")]
    b_summer_raw = [round(value * 1000) for value in read_day(b_path, summer_day, "equipment load [kWh]")]
    b_summer = [round(value * 0.45) for value in b_summer_raw]
    solar_summer = [
        round(value * 60 * 1000)
        for value in read_day(solar_path, summer_day, "solar generation [W/kW]")
    ]

    scenarios = [
        make_scenario(
            "cambridge-campus-real",
            "Cambridge campus archive · summer",
            "Two anonymous measured-demand buildings on one shared modelled Cambridge rooftop.",
            summer_day,
            a_summer,
            b_summer,
            solar_summer,
            "aggregated",
            "same_day",
            [cambridge_source, solar_source],
        ),
        make_scenario(
            "cambridge-weather-driven",
            "Weather-driven pilot fallback",
            "Public UK profile shapes scaled to pilot-sized annual demand, paired with Cambridge weather-modelled PV.",
            summer_day,
            profile_scaled(summer_day, 58_000, "pc3"),
            profile_scaled(summer_day, 92_000, "pc1"),
            solar_summer,
            "profile_scaled",
            "aligned_typical_day",
            [
                {
                    "id": "elexon-profile-semantics",
                    "name": "Elexon standard load-profile semantics",
                    "url": "https://www.elexon.co.uk/bsc/settlement/profiling/",
                    "version": "MVP documented approximation",
                    "license": "Reference only; no raw coefficient redistribution",
                    "retrievedAt": "2026-07-31T00:00:00Z",
                    "sha256": hashlib.sha256(b"greenproof-elexon-profile-semantics-v1").hexdigest(),
                    "provenance": "profile_scaled",
                    "limitations": ["Illustrative class-informed profile, not a dated coefficient set."],
                },
                solar_source,
            ],
            demand_quality=["illustrative_profile_not_metered"],
        ),
        make_scenario(
            "uk-system-context",
            "Campus + GB system context",
            "The campus twin is shown alongside a separate NESO national-demand trace; national data is never rescaled into building demand.",
            winter_day,
            [round(value * 1000) for value in read_day(a_path, winter_day, "equipment load [kWh]")],
            [round(value * 0.45 * 1000) for value in read_day(b_path, winter_day, "equipment load [kWh]")],
            [
                round(value * 60 * 1000)
                for value in read_day(solar_path, winter_day, "solar generation [W/kW]")
            ],
            "aggregated",
            "aligned_typical_day",
            [
                cambridge_source,
                solar_source,
                source(
                    "neso-demand-2025",
                    "NESO Historic Demand Data",
                    "https://www.neso.energy/data-portal/historic-demand-data",
                    "2025",
                    "NESO Open Data terms",
                    NESO,
                    "aggregated",
                    ["National system context only; not building-level demand."],
                ),
            ],
            context={
                "nesoNationalDemandMw": neso_day("2025-01-08"),
                "label": "GB national demand · representative winter weekday (2025-01-08)",
                "provenance": "aggregated",
            },
        ),
    ]

    for scenario in scenarios:
        target = OUTPUT / f"{scenario['id']}.json"
        target.write_text(json.dumps(scenario, indent=2, separators=(",", ": "), ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{target.relative_to(ROOT)} {sha256(target)}")

    index = [
        {
            "id": scenario["id"],
            "label": scenario["label"],
            "description": scenario["description"],
            "path": f"/data/scenarios/{scenario['id']}.json",
        }
        for scenario in scenarios
    ]
    (OUTPUT / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
