"""In-process job scheduling (spec §6 — APScheduler, no separate cron).

Two interval jobs share the event loop with the web app and bot: the scanner
(~15 min) and the agent poll (~1 min). Sync jobs run in APScheduler's executor
so a slow ``git pull`` or LLM call doesn't block the asyncio loop.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from orbitos.config import get_settings

log = logging.getLogger(__name__)


def create_scheduler() -> AsyncIOScheduler:
    """Build the scheduler with the scan + agent-poll jobs registered."""
    settings = get_settings()
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _run_scan,
        "interval",
        minutes=settings.scan_interval_min,
        id="scan",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _run_agent_poll,
        "interval",
        minutes=1,
        id="agent_poll",
        max_instances=1,
        coalesce=True,
    )
    return scheduler


def _run_scan() -> None:
    from orbitos.scanner.scan import scan

    count = scan()
    if count:
        log.info("Scan processed %d changed note(s)", count)


def _run_agent_poll() -> None:
    from orbitos.agent.loop import poll_proposals

    poll_proposals()
