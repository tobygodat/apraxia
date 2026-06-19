"""Todos API (spec §4e)."""

from orbitos.web.routes._crud import make_crud_router
from orbitos.web.schemas import TodoCreate, TodoUpdate

router = make_crud_router(
    table="todos",
    create_model=TodoCreate,
    update_model=TodoUpdate,
    prefix="/todos",
    tags=["todos"],
)
