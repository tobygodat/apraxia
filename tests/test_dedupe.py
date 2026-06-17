"""Dedupe hashing — stability + normalization (spec §5)."""

from tobios.extractor.dedupe import compute_dedupe_hash, normalize_line


def test_normalization_strips_checkbox_bullet_and_case():
    assert normalize_line("- [ ] Buy milk  ") == "buy milk"
    assert normalize_line("* Read Dune") == "read dune"


def test_hash_is_stable_across_cosmetic_edits():
    a = compute_dedupe_hash("2026-06-16.md", "- [ ] Buy milk  ")
    b = compute_dedupe_hash("2026-06-16.md", "buy milk")
    assert a == b
    assert len(a) == 64


def test_hash_differs_by_note_and_text():
    assert compute_dedupe_hash("a.md", "x") != compute_dedupe_hash("b.md", "x")
    assert compute_dedupe_hash("a.md", "x") != compute_dedupe_hash("a.md", "y")
