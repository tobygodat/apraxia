"""orbitOS — a self-hosted personal CRM.

One process, one repo, one service (spec §6): a FastAPI JSON API, an APScheduler
job runner, and a Telegram bot all run in a single asyncio loop over one SQLite
file. See SPEC.md for the full design and ``main.py`` for how the pieces wire up.
"""

__version__ = "0.1.0"
