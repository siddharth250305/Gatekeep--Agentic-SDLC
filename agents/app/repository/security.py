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

# THE single list of sensitive files. Everything that decides whether a path
# may be read, written, listed, searched or diffed uses is_sensitive_path()
# below (including the MCP PolicyEngine), so there is nothing to keep in sync.

# File names (matched case-insensitively against the last path part).
SENSITIVE_GLOBS = [
    # environment files
    ".env", ".env.*", "*.env", ".envrc",
    # keys and certificates
    "*.pem", "*.key", "*.p12", "*.pfx", "*.p8", "*.ppk", "*.keystore", "*.jks",
    "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    # credential stores
    "credentials", "credentials.*", "secrets.*", "secret.*",
    ".npmrc", ".pypirc", ".netrc", ".pgpass", ".git-credentials", ".htpasswd", "*.kdbx",
    # infrastructure state, which embeds secrets
    "*.tfstate", "*.tfstate.*", "*.tfvars",
]

# Directories whose whole contents are off limits (any path part, any depth).
SENSITIVE_DIRS = {".git", ".ssh", ".aws", ".gnupg", ".kube", ".azure", ".docker"}


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
    """True if *path* names a secret file or lies inside a secret directory.

    Both "/" and "\\" count as separators, so Windows-style paths are checked
    the same way on every platform."""
    parts = [p.lower() for p in re.split(r"[\\/]+", str(path)) if p]
    if not parts:
        return False
    if any(p in SENSITIVE_DIRS for p in parts):
        return True
    return any(fnmatch.fnmatch(parts[-1], pat) for pat in SENSITIVE_GLOBS)


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
