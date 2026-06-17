"""Movies API (spec §4e)."""

from orbitos.web.routes._crud import make_crud_router
from orbitos.web.schemas import MovieCreate, MovieUpdate

router = make_crud_router(
    table="movies",
    create_model=MovieCreate,
    update_model=MovieUpdate,
    prefix="/movies",
    tags=["movies"],
)
