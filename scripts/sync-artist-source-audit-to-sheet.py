#!/usr/bin/env python3
"""Sync the sheet-ready artist source audit CSV to the Google Sheet bridge."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_API_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbyeskUlFOAAfBKjhVtHpDHfjKn_SOfzaN0CIorRvyRirS_hTzTjjwf5w5gB2qs9yiw8/exec"
)
DEFAULT_CSV = Path("data/artist_sources/artist_source_audit_sheet_ready.csv")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create/update the Artist_Source_Audit tab in the master Google Sheet."
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("JDDM_SPREADSHEET_API_URL", DEFAULT_API_URL),
        help="Spreadsheet bridge web app URL.",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("JDDM_SPREADSHEET_EDIT_TOKEN", ""),
        help="Optional bridge edit token.",
    )
    parser.add_argument(
        "--csv",
        default=str(DEFAULT_CSV),
        help="CSV file to sync.",
    )
    parser.add_argument(
        "--sheet-name",
        default="Artist_Source_Audit",
        help="Target tab name.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="HTTP timeout in seconds.",
    )
    return parser.parse_args()


def post_json(url: str, payload: dict, timeout: int) -> tuple[int, dict]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            status = response.status
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        status = exc.code
    except urllib.error.URLError as exc:
        return 0, {
            "ok": False,
            "code": "NETWORK_ERROR",
            "message": str(exc.reason),
        }

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = {
            "ok": False,
            "code": "BAD_RESPONSE",
            "message": text[:1000],
        }
    return status, parsed


def main() -> int:
    args = parse_args()
    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(
            json.dumps(
                {
                    "ok": False,
                    "code": "CSV_NOT_FOUND",
                    "message": f"CSV file not found: {csv_path}",
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1

    payload = {
        "action": "syncArtistSourceAudit",
        "sheetName": args.sheet_name,
        "csv": csv_path.read_text(encoding="utf-8"),
        "token": args.token,
    }
    status, response = post_json(args.api_url, payload, args.timeout)

    stream = sys.stdout if status == 200 and response.get("ok") else sys.stderr
    print(json.dumps(response, indent=2), file=stream)

    if status != 200 or not response.get("ok"):
        if response.get("code") == "UNKNOWN_ACTION":
            print(
                "\nThe live Apps Script bridge has not been redeployed with "
                "syncArtistSourceAudit yet.",
                file=sys.stderr,
            )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
