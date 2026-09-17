#!/usr/bin/env python3
"""Unit-level check for the I7 write/upload invariant in styles.py.

upload() must send exactly the bytes it just wrote to <name>.sld — not a separate copy
of the in-memory string it happened to be called with — so editing styles.py can never
produce a style GeoServer receives that diverges from the committed .sld artifact
contourStyles.test.ts asserts against. See .superpowers/sdd/final-review-fixes.md, I7.

No pytest / requests dependency: this repo has no Python test runner, and pulling one in
for a single check would be new infra for its own sake (the review's fix explicitly says
"do not add a CI step"). Plain asserts, run directly:

    python3 apps/api/scripts/contours/test_styles_upload.py
"""
import importlib.util
import pathlib
import sys
import types

STYLES_PY = pathlib.Path(__file__).resolve().parent / "styles.py"


def _load_styles_with_fake_requests(calls):
    """Import styles.py fresh, with a fake `requests` module installed so upload()'s
    deferred `import requests` picks it up without the real package being installed."""

    class FakeResponse:
        def __init__(self, status_code):
            self.status_code = status_code

        def raise_for_status(self):
            if not 200 <= self.status_code < 300:
                raise RuntimeError(f"HTTP {self.status_code}")

    fake_requests = types.ModuleType("requests")

    def post(url, params=None, data=None, headers=None, auth=None):
        calls.append(("POST", url, data))
        return FakeResponse(201)

    def put(url, data=None, headers=None, auth=None):
        calls.append(("PUT", url, data))
        return FakeResponse(200)

    fake_requests.post = post
    fake_requests.put = put
    sys.modules["requests"] = fake_requests

    spec = importlib.util.spec_from_file_location("contour_styles_under_test", STYLES_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    calls = []
    styles = _load_styles_with_fake_requests(calls)

    sld_path = pathlib.Path(__file__).resolve().parent / "test_upload_fixture.sld"
    try:
        # Stale content already on disk, standing in for a committed artifact that was
        # never regenerated — the exact scenario I7 describes.
        sld_path.write_text("STALE", encoding="utf-8")

        styles.upload("test_upload_fixture", "FRESH", "irrelevant-password")

        assert calls, "upload() never called requests.post/put"
        _method, _url, sent = calls[-1]
        sent_text = sent.decode("utf-8") if isinstance(sent, bytes) else sent
        assert sent_text == "FRESH", f"expected GeoServer to receive 'FRESH', got {sent_text!r}"

        on_disk = sld_path.read_text(encoding="utf-8")
        assert on_disk == "FRESH", (
            f"expected {sld_path.name} to hold exactly what was uploaded ('FRESH'), "
            f"found {on_disk!r} instead — upload() and the committed .sld can diverge"
        )
        assert on_disk == sent_text, "on-disk artifact and uploaded bytes diverged"
    finally:
        sld_path.unlink(missing_ok=True)

    print("OK: upload() writes the .sld first and uploads exactly those bytes")


if __name__ == "__main__":
    main()
