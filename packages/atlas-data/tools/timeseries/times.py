"""Reading a time from a file name (or a CSV) and checking a series has one distinct time per file."""
import csv
import io
import re
from datetime import datetime, timezone

from workspace_common import UserFacingError

UTC = timezone.utc
# Digit runs must not touch other digits, so a 12-digit stamp is not read as an 8-digit date.
_REGEX = {
    "YYYYMMDD": (re.compile(r"(?<!\d)(\d{8})(?!\d)"), "%Y%m%d"),
    "YYYYMMDDHHmm": (re.compile(r"(?<!\d)(\d{12})(?!\d)"), "%Y%m%d%H%M"),
    "YYYYDDD": (re.compile(r"(?<!\d)(\d{7})(?!\d)"), "%Y%j"),
}
PATTERNS = set(_REGEX)
MAX_NAMED = 5


def parse_time(filename: str, pattern: str):
    """The UTC time encoded in filename by pattern, or None when it does not match."""
    regex, fmt = _REGEX[pattern]
    m = regex.search(filename)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), fmt).replace(tzinfo=UTC)
    except ValueError:
        return None


def _parse_iso(text: str):
    t = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)


def times_from_csv(text: str) -> dict:
    """{file name: time} from a CSV with `file,time` columns (ISO 8601, UTC when no offset)."""
    out = {}
    for row in csv.DictReader(io.StringIO(text)):
        name, when = (row.get("file") or "").strip(), (row.get("time") or "").strip()
        if not name or not when:
            continue
        try:
            out[name] = _parse_iso(when)
        except ValueError:
            raise UserFacingError(f"Thời điểm không hợp lệ trong tệp CSV: {name}, {when}")
    return out


def _named(names):
    shown = ", ".join(names[:MAX_NAMED])
    return shown + (f" và {len(names) - MAX_NAMED} tệp khác" if len(names) > MAX_NAMED else "")


def assign_times(names, pattern, csv_times):
    """(name, time) for every name, sorted by time. A CSV entry wins over the pattern. Files with
    no time, or two files with the same time, fail the whole series: nothing is dropped."""
    found, missing = [], []
    for name in names:
        t = (csv_times or {}).get(name)
        if t is None and pattern:
            t = parse_time(name, pattern)
        if t is None:
            missing.append(name)
        else:
            found.append((name, t))
    if missing:
        raise UserFacingError(f"Không xác định được thời điểm của: {_named(missing)}")
    seen = {}
    for name, t in sorted(found, key=lambda p: (p[1], p[0])):
        if t in seen:
            raise UserFacingError(f"Trùng thời điểm {t.isoformat()}: {seen[t]}, {name}")
        seen[t] = name
    return sorted(found, key=lambda p: p[1])
