"""Writing API (spec §4e)."""

from orbitos.web.routes._crud import make_crud_router
from orbitos.web.schemas import WritingCreate, WritingUpdate

router = make_crud_router(
    table="writing",
    create_model=WritingCreate,
    update_model=WritingUpdate,
    prefix="/writing",
    tags=["writing"],
)
