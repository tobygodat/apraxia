"""Drafts API — the agent's outbox (spec §4e).

Read approved drafts, copy, send manually. Full CRUD is exposed so the UI can
mark a draft sent or delete it; the agent writes drafts on Telegram approval.
"""

from tobios.web.routes._crud import make_crud_router
from tobios.web.schemas import DraftCreate, DraftUpdate

router = make_crud_router(
    table="drafts",
    create_model=DraftCreate,
    update_model=DraftUpdate,
    prefix="/drafts",
    tags=["drafts"],
)
