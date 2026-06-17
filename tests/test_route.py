"""Confidence + type routing decisions (spec §4b, §5)."""

from tobios.extractor.route import Route, route_item

THRESHOLD = 0.75


def test_high_confidence_low_risk_autofiles():
    assert route_item("book", 0.95, THRESHOLD) is Route.AUTO
    assert route_item("movie", 0.80, THRESHOLD) is Route.AUTO


def test_todos_always_proposed():
    # Actionable items never auto-file, however confident.
    assert route_item("todo", 0.99, THRESHOLD) is Route.PROPOSE


def test_low_confidence_is_proposed():
    assert route_item("book", 0.50, THRESHOLD) is Route.PROPOSE


def test_none_is_skipped():
    assert route_item("none", 0.99, THRESHOLD) is Route.SKIP
