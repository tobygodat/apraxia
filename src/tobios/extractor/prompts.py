"""Prompt templates for the extractor (spec §4b)."""

from __future__ import annotations

EXTRACTION_PROMPT = """\
You are the extraction engine for a personal CRM. You are given the full text of
one Obsidian daily note. Identify each actionable or notable line and classify it.

Return JSON only — an object {"items": [...]} where each item is:
  {
    "kind": "todo" | "book" | "movie" | "writing" | "none",
    "confidence": <float 0..1>,
    "payload": { ...fields for that kind... }
  }

Payload fields by kind:
  - todo:    {"text": str, "due": ISO-date-or-null}
  - book:    {"title": str, "author": str-or-null}
  - movie:   {"title": str, "year": int-or-null}
  - writing: {"title": str-or-null, "body": str, "tags": str-or-null}
  - none:    {}

Be conservative with confidence. Do not invent items. Lines that are neither
actionable nor notable should be omitted or classified "none".

Daily note ({source_note}):
---
{note_text}
---
"""
