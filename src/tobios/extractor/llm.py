"""Anthropic-backed extraction (spec §4b).

STUB: returns no items in v1. Wiring the structured-output call is the first
real implementation task — build the prompt from :data:`prompts.EXTRACTION_PROMPT`,
send the note to the Anthropic API, parse the JSON, and return ``ExtractedItem``s.
Until then the pipeline degrades gracefully (no key → no items → no writes).
"""

from __future__ import annotations

import logging

from tobios.config import get_settings
from tobios.models import ExtractedItem

log = logging.getLogger(__name__)


def extract_items(note_text: str, *, source_note: str) -> list[ExtractedItem]:
    """Classify a daily note into structured items. Returns [] until implemented."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        log.debug("ANTHROPIC_API_KEY unset; extractor is a no-op for %s", source_note)
        return []
    # TODO(v1): call anthropic.Anthropic(...).messages.create(...) with
    # EXTRACTION_PROMPT, parse JSON, and map to ExtractedItem. See prompts.py.
    log.warning("extract_items not implemented yet; skipping %s", source_note)
    return []
