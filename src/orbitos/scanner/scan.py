"""Scan orchestration (spec §4a).

Pull the vault → find daily notes → skip unchanged (scan_state) → hand each
changed note to the extractor → record the new hash. Wired into the scheduler
to run every ~15 min.
"""

from __future__ import annotations

import logging

from orbitos.config import get_settings
from orbitos.scanner import daily_notes, git_sync

log = logging.getLogger(__name__)


def scan() -> int:
    """Run one scan pass. Returns the number of notes handed to the extractor."""
    from orbitos.extractor.route import process_note  # local import avoids a cycle

    git_sync.pull()
    vault = get_settings().vault_path
    processed = 0
    for note in daily_notes.find_daily_notes(vault):
        rel = str(note.relative_to(vault))
        digest = daily_notes.content_hash(note)
        if not daily_notes.note_changed(rel, digest):
            continue
        log.info("Scanning changed note: %s", rel)
        process_note(rel, note.read_text(encoding="utf-8"))
        daily_notes.record_scan(rel, digest)
        processed += 1
    return processed
