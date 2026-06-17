"""Movies API (spec §4e)."""

from tobios.web.routes._crud import make_crud_router
from tobios.web.schemas import MovieCreate, MovieUpdate

router = make_crud_router(
    table="movies",
    create_model=MovieCreate,
    update_model=MovieUpdate,
    prefix="/movies",
    tags=["movies"],
)
