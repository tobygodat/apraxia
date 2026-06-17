"""Repository CRUD + upsert idempotency (spec §3, §5)."""

from tobios.db import repo


def test_todo_crud_roundtrip(migrated):
    row = repo.create_row("todos", {"text": "buy milk"})
    assert row["id"]
    assert row["source"] == "webapp"  # web-created rows are tagged (spec §4e)

    assert repo.get_row("todos", row["id"])["text"] == "buy milk"

    repo.update_row("todos", row["id"], {"done": 1})
    assert repo.get_row("todos", row["id"])["done"] == 1

    assert len(repo.list_rows("todos")) == 1

    repo.delete_row("todos", row["id"])
    assert repo.get_row("todos", row["id"]) is None


def test_upsert_by_dedupe_hash_is_idempotent(migrated):
    base = {
        "text": "read Dune",
        "source": "vault",
        "source_note": "2026-06-16.md",
        "dedupe_hash": "hash-1",
    }
    repo.upsert_by_dedupe_hash("todos", dict(base))
    repo.upsert_by_dedupe_hash("todos", {**base, "text": "read Dune (edited)"})

    matches = [r for r in repo.list_rows("todos") if r["dedupe_hash"] == "hash-1"]
    assert len(matches) == 1  # updated in place, not duplicated
    assert matches[0]["text"] == "read Dune (edited)"
