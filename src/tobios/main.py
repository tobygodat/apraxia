"""Single entrypoint — web + scheduler + bot in one asyncio loop (spec §6).

This is the integration point that keeps tobiOS "one process, one service":
uvicorn (the FastAPI app), APScheduler, and the Telegram bot all run on the same
event loop. The bot is optional — without a token, the web app and scheduler run
alone.

Run with ``uv run python -m tobios.main`` or the ``tobios`` console script.
"""

from __future__ import annotations

import asyncio
import logging

import uvicorn

from tobios.config import get_settings
from tobios.db.migrate import migrate
from tobios.scheduler import create_scheduler
from tobios.telegram.bot import build_application
from tobios.web.app import create_app

log = logging.getLogger(__name__)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()

    migrate()

    scheduler = create_scheduler()
    scheduler.start()

    bot_app = build_application()
    app = create_app()
    server = uvicorn.Server(
        uvicorn.Config(app, host=settings.host, port=settings.port, log_level="info")
    )

    try:
        if bot_app is not None:
            async with bot_app:
                await bot_app.start()
                await bot_app.updater.start_polling()
                await server.serve()
                await bot_app.updater.stop()
                await bot_app.stop()
        else:
            log.info("Telegram disabled (no token) — running web + scheduler only")
            await server.serve()
    finally:
        scheduler.shutdown(wait=False)


def run() -> None:
    """Console-script entrypoint (``tobios``)."""
    asyncio.run(main())


if __name__ == "__main__":
    run()
