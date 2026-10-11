"""Keep secrets and sensitive files out of the LLM context.

Two layers:
  1. is_sensitive_path()  - files that must never be read/sent at all.
  2. redact_secrets()     - scrub secret-looking values from any content that
                            does get sent (defense in depth).

Secret VALUES are never returned in logs or audit payloads - only the category
name of what was found.
"""

from __future__ import annotations

import fnmatch
import re
from pathlib import PurePosixPath

# Files whose contents are never read or sent to the LLM.
SENSITIVE_GLOBS = [
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx",
    "credentials.*", "secrets.*", "secret.*", "id_rsa", "id_dsa",
    "*.keystore", "*.jks", ".npmrc", ".pypirc", ".netrc",
]

# (category, compiled pattern). Order matters only for readability.
SECRET_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}")),
    ("github_pat", re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("private_key_block", re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----")),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("google_api_key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("bearer_token", re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{20,}")),
    ("generic_secret_assignment", re.compile(
        r"(?i)(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)"
        r"\s*[:=]\s*['\"][^'\"\s]{6,}['\"]"
    )),
]


def is_sensitive_path(path: str) -> bool:
    name = PurePosixPath(path).name.lower()
    return any(fnmatch.fnmatch(name, pat) for pat in SENSITIVE_GLOBS)


def scan_secrets(text: str) -> list[str]:
    """Return the categories of secrets present (never the values)."""
    return sorted({name for name, pat in SECRET_PATTERNS if pat.search(text)})


def redact_secrets(text: str) -> tuple[str, list[str]]:
    """Replace any secret-looking values with <redacted:category>."""
    found: list[str] = []
    out = text
    for name, pat in SECRET_PATTERNS:
        if pat.search(out):
            found.append(name)
            out = pat.sub(f"<redacted:{name}>", out)
    return out, sorted(set(found))
