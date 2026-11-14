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
from pathlib import Path

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


# Words that mark a value as secret when they appear in a key name. Key
# names around them are capped at 64 characters so a huge line cannot make
# the patterns backtrack for minutes (review finding #1).
_SECRET_WORDS = (r"(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token"
                 r"|refresh[_-]?token|client[_-]?secret|private[_-]?key)")

# (category, compiled pattern, replacement). Applied in this order: whole key
# blocks first, then known token formats, then key = value assignments.
# Assignment patterns keep the key and hide only the value.
SECRET_PATTERNS: list[tuple[str, re.Pattern, str]] = [
    # The whole block, BEGIN to END. With no END line, everything after BEGIN.
    ("private_key_block", re.compile(
        r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----"
        r"(?:[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|[\s\S]*)"), "***"),
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}"), "***"),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), "***"),
    ("github_pat", re.compile(r"github_pat_[A-Za-z0-9_]{20,}"), "***"),
    ("slack_token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "***"),
    ("google_api_key", re.compile(r"AIza[0-9A-Za-z_\-]{35}"), "***"),
    ("bearer_token", re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-]{20,}"), r"\1***"),
    ("basic_auth", re.compile(r"(?i)(\bbasic\s+)[A-Za-z0-9+/]{8,}={0,2}"), r"\1***"),
    ("stripe_key", re.compile(r"\b[rsp]k_(?:live|test)_[A-Za-z0-9]{10,}"), "***"),
    ("ai_api_key", re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{16,}"), "***"),
    # user:password@ in any URL (database URLs, git remotes).
    ("url_credentials", re.compile(r"(?i)(\b[a-z][a-z0-9+.\-]{1,20}://[^\s:/@'\"]{1,64}:)[^\s@/'\"]{1,128}(@)"), r"\1***\2"),
    # key = "value" / key: 'value' / "key": "value" (code, JSON, YAML, .env).
    ("generic_secret_assignment", re.compile(
        rf"(?i)((?<![\w.-])[\w.-]{{0,64}}?{_SECRET_WORDS}[\w.-]{{0,64}}['\"]?\s*[:=]\s*)(['\"])[^'\"\n]{{4,}}\2"), r"\1\2***\2"),
    # Upper-case environment style KEY=value anywhere in a line, also inside
    # quotes or a URL (API_KEY=..., DB_PASSWORD=...). Case-sensitive, so
    # lower-case code such as `password=password` is left alone.
    ("env_secret_inline", re.compile(
        r"(?<![\w.-])([A-Z0-9_]{0,64}?(?:API_?KEY|SECRET|PASSWORD|PASSWD|ACCESS_?TOKEN|AUTH_?TOKEN"
        r"|REFRESH_?TOKEN|PRIVATE_?KEY)[A-Z0-9_]{0,64}=)[^\s'\"(){}\[\],;#$<>*&]{4,}"), r"\1***"),
    # Unquoted values in .env (KEY=value) and YAML (key: value) lines. Only a
    # whole line counts, with no spaces around "=" and a space after ":", so
    # code such as `password = get_password()` or `password: str` is left alone.
    # A leading "+", "-" or " " (a diff line) or "E " (pytest output) is allowed.
    ("env_secret_assignment", re.compile(
        rf"(?im)^([ \t]*(?:[+\- ]|E[ \t]+)?[ \t]*(?:export[ \t]+|-[ \t]+)?"
        rf"[\w.-]{{0,64}}?{_SECRET_WORDS}[\w.-]{{0,64}}(?:=|:[ \t]+))"
        r"(?!(?:none|null|true|false|\*\*\*)[ \t]*$)[^\s'\"(){}\[\],;#$<>*]{4,}[ \t]*$"), r"\1***"),
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


def resolve_inside(root: str | Path, rel: str | Path) -> Path:
    """The real file behind *rel* inside *root*, after following every shortcut.

    Raises ValueError when the real path leaves *root*, lies inside .git, or is
    a sensitive file, so a shortcut (symlink) named "notes.py" that points at
    ".env" or "~/.ssh/id_rsa" is refused like the file it points at (D2)."""
    base = Path(root).resolve()
    real = (base / rel).resolve()
    if real != base and base not in real.parents:
        raise ValueError("path escapes the workspace")
    inner = real.relative_to(base)
    if any(part.lower() == ".git" for part in inner.parts):
        raise ValueError("path is inside .git")
    if is_sensitive_path(str(rel)) or is_sensitive_path(inner.as_posix()):
        raise ValueError("refused: sensitive file")
    return real


def scan_secrets(text: str) -> list[str]:
    """Return the categories of secrets present (never the values)."""
    return sorted({name for name, pat, _ in SECRET_PATTERNS if pat.search(text)})


def redact_secrets(text: str) -> tuple[str, list[str]]:
    """Replace secret values with ***. Returns the text and the categories found.

    Run on every text that leaves GateKeep: file reads, search results,
    diffs, repository context and test output (D3)."""
    found: list[str] = []
    out = text
    for name, pat, repl in SECRET_PATTERNS:
        out, n = pat.subn(repl, out)
        if n:
            found.append(name)
    return out, sorted(set(found))
