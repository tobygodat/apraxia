"""Writing API (spec §4e)."""

from tobios.web.routes._crud import make_crud_router
from tobios.web.schemas import WritingCreate, WritingUpdate

router = make_crud_router(
    table="writing",
    create_model=WritingCreate,
    update_model=WritingUpdate,
    prefix="/writing",
    tags=["writing"],
)
