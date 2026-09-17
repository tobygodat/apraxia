"""apraxia — a self-hosted personal CRM.

Legacy runtime: a FastAPI JSON API, an APScheduler
job runner, and a Telegram bot all run in a single asyncio loop over one SQLite
file. See ``main.py`` for wiring and AGENTS.md for current cloud product rules.
"""

__version__ = "0.1.0"
