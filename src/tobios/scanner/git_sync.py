"""Pull the vault git repo (spec §4a step 1).

The vault syncs laptop → private git remote → VPS. Here we just run ``git pull``
in the vault checkout. Defensive: if the vault path isn't a git repo (e.g. local
dev pointing at a plain folder), we log and continue rather than crash.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from tobios.config import get_settings

log = logging.getLogger(__name__)


def pull() -> bool:
    """``git pull`` the vault. Returns True on success, False if skipped/failed."""
    vault: Path = get_settings().vault_path
    if not (vault / ".git").exists():
        log.warning("Vault at %s is not a git repo; skipping pull", vault)
        return False
    try:
        subprocess.run(
            ["git", "-C", str(vault), "pull", "--ff-only"],
            check=True,
            capture_output=True,
            text=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:  # pragma: no cover
        log.error("git pull failed: %s", exc)
        return False
