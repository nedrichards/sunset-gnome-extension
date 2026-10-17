"""Exercise the release gate with real shexli scans of modified packages."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "build/sunset-appearance@nedrichards.com.shell-extension.zip"


class ShexliGateTest(unittest.TestCase):
    def scan(self, *, versions=None, compiled_schema=False, missing_metadata=False):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "extension.zip"
            report_path = Path(directory) / "report.json"
            with ZipFile(ARCHIVE) as source, ZipFile(archive, "w") as target:
                for name in source.namelist():
                    if name == "metadata.json" and missing_metadata:
                        continue
                    contents = source.read(name)
                    if name == "metadata.json" and versions is not None:
                        metadata = json.loads(contents)
                        metadata["shell-version"] = versions
                        contents = json.dumps(metadata).encode()
                    target.writestr(name, contents)
                if compiled_schema:
                    target.writestr("schemas/gschemas.compiled", b"unnecessary artifact")
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/check-shexli.py"),
                 str(archive), "--report", str(report_path)],
                capture_output=True, text=True, check=False,
            )
            self.assertTrue(report_path.exists(), result.stderr)
            return result, json.loads(report_path.read_text())

    def test_current_package_has_only_documented_exception(self):
        result, report = self.scan()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([f["rule_id"] for f in report["findings"]], ["EGO-M-004"])
        self.assertIn("known GNOME 51 false positive", result.stdout)

    def test_clean_scan_passes(self):
        result, report = self.scan(versions=["45", "46", "47", "48", "49", "50"])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(report["summary"]["status"], "clean")

    def test_warning_blocks_even_with_known_exception(self):
        result, report = self.scan(compiled_schema=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("EGO-P-006", [f["rule_id"] for f in report["findings"]])

    def test_invalid_versions_are_not_exempt(self):
        for versions in (["51", "invalid"], ["45", "52"], []):
            with self.subTest(versions=versions):
                result, _ = self.scan(versions=versions)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertNotIn("known GNOME 51 false positive", result.stdout)

    def test_missing_metadata_blocks(self):
        result, report = self.scan(missing_metadata=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("EGO-M-001", [f["rule_id"] for f in report["findings"]])

    def test_missing_archive_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "report.json"
            report_path.write_text('{"summary": {"status": "clean"}}')
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/check-shexli.py"),
                 str(Path(directory) / "missing.zip"),
                 "--report", str(report_path)],
                capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(report_path.exists(), "A failed scan retained a stale report")
