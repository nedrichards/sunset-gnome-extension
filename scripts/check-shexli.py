#!/usr/bin/env python3
"""Gate the installable ZIP on shexli findings, preserving the full report."""

import argparse
import json
from pathlib import Path

from shexli.analyzer import analyze_path


ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "build/sunset-appearance@nedrichards.com.shell-extension.zip"


def known_gnome_51_false_positive(finding, archive):
    # shexli 0.2.1 hardcodes major > 50 as invalid, including in upstream
    # e053667b046ba8a9dbfd74503fdd0f5dc90939c5. Remove this exception when fixed.
    # Match the exact diagnostic for our supported versions, not the whole rule:
    # malformed versions or a changed compatibility declaration still fail.
    return (
        finding["rule_id"] == "EGO-M-004"
        and finding["severity"] == "error"
        and finding["message"] == (
            "Field `shell-version` contains invalid values, more than one "
            "development release, or implausible future releases."
        )
        and finding["evidence"] == [{
            "path": f"{archive}:metadata.json",
            "line": None,
            "snippet": "shell-version=['45', '46', '47', '48', '49', '50', '51']",
        }]
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", nargs="?", type=Path, default=ARCHIVE)
    parser.add_argument("--report", type=Path, default=ROOT / "build/shexli.json")
    args = parser.parse_args()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.unlink(missing_ok=True)

    # The upstream CLI returns zero even for errors. Inspect its structured
    # result directly so warnings, errors, and analysis failures block upload.
    report = analyze_path(args.archive).to_dict()
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    findings = report["findings"]
    summary = report["summary"]
    if (summary["status"] not in {"clean", "issues_found"}
            or summary["finding_count"] != len(findings)):
        raise RuntimeError(f"Unexpected shexli summary: {summary}")

    failures = 0
    for finding in findings:
        exempt = known_gnome_51_false_positive(finding, args.archive)
        label = "known GNOME 51 false positive" if exempt else finding["severity"]
        print(f"{finding['rule_id']} [{label}]: {finding['message']}")
        for evidence in finding["evidence"]:
            print(f"  {evidence['path']}:{evidence['line'] or ''}")
        if not exempt:
            failures += 1

    print(f"shexli: {failures} blocking findings; full report: {args.report}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
