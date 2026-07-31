"""Small offline validator for generated GreenProof scenarios."""

import argparse
import json
from datetime import datetime
from pathlib import Path

PROVENANCE = {
    "measured", "modelled", "profile_scaled", "aggregated",
    "interpolated", "extrapolated", "user_provided",
}


def validate(path: Path) -> None:
    scenario = json.loads(path.read_text(encoding="utf-8"))
    series = [
        scenario["site"]["generation"]["points"],
        *[tenant["demand"]["points"] for tenant in scenario["site"]["tenants"]],
    ]
    assert len(scenario["site"]["tenants"]) == 2
    assert len({len(points) for points in series}) == 1
    for index in range(len(series[0])):
        boundaries = {(points[index]["startUtc"], points[index]["endUtc"]) for points in series}
        assert len(boundaries) == 1
        for points in series:
            point = points[index]
            assert isinstance(point["energyWh"], int) and point["energyWh"] >= 0
            assert point["provenance"] in PROVENANCE
            assert datetime.fromisoformat(point["startUtc"].replace("Z", "+00:00")) < datetime.fromisoformat(point["endUtc"].replace("Z", "+00:00"))
    print(f"valid: {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    validate(parser.parse_args().path)
