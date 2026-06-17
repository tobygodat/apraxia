"""Todos API (spec §4e)."""

from tobios.web.routes._crud import make_crud_router
from tobios.web.schemas import TodoCreate, TodoUpdate

router = make_crud_router(
    table="todos",
    create_model=TodoCreate,
    update_model=TodoUpdate,
    prefix="/todos",
    tags=["todos"],
)
