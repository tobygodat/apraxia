"""Scanner scan_state skip-unchanged logic (spec §4a)."""

from orbitos.scanner import daily_notes


def test_scan_state_skips_unchanged_notes(migrated, tmp_path):
    note = tmp_path / "2026-06-16.md"
    note.write_text("hello", encoding="utf-8")
    h1 = daily_notes.content_hash(note)

    # Never seen → changed.
    assert daily_notes.note_changed("2026-06-16.md", h1) is True

    daily_notes.record_scan("2026-06-16.md", h1)
    assert daily_notes.note_changed("2026-06-16.md", h1) is False

    # Edit the note → changed again.
    note.write_text("hello world", encoding="utf-8")
    h2 = daily_notes.content_hash(note)
    assert daily_notes.note_changed("2026-06-16.md", h2) is True


def test_find_daily_notes_matches_date_pattern(tmp_path):
    (tmp_path / "2026-06-16.md").write_text("x", encoding="utf-8")
    (tmp_path / "random-note.md").write_text("x", encoding="utf-8")
    found = {p.name for p in daily_notes.find_daily_notes(tmp_path)}
    assert found == {"2026-06-16.md"}
