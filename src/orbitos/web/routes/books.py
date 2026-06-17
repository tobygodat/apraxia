"""Books API (spec §4e)."""

from orbitos.web.routes._crud import make_crud_router
from orbitos.web.schemas import BookCreate, BookUpdate

router = make_crud_router(
    table="books",
    create_model=BookCreate,
    update_model=BookUpdate,
    prefix="/books",
    tags=["books"],
)
