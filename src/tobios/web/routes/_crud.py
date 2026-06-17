"""Generic CRUD router factory.

All five sections share the same REST shape over :mod:`tobios.db.repo`, so we
build their routers from one factory. Every route is gated by ``require_auth``.

NOTE: this module deliberately does *not* use ``from __future__ import
annotations`` — FastAPI must see the real Pydantic model classes (passed in as
arguments) in each endpoint's signature, not stringized annotations.
"""

from fastapi import APIRouter, Depends, HTTPException, Response

from tobios.db import repo
from tobios.web.auth import require_auth


def make_crud_router(*, table, create_model, update_model, prefix, tags):
    """Build a CRUD APIRouter for one table."""
    router = APIRouter(prefix=prefix, tags=tags, dependencies=[Depends(require_auth)])

    @router.get("")
    def list_items():
        return repo.list_rows(table)

    @router.get("/{item_id}")
    def get_item(item_id: int):
        row = repo.get_row(table, item_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        return row

    @router.post("", status_code=201)
    def create_item(body: create_model):
        return repo.create_row(table, body.model_dump(exclude_unset=True))

    @router.patch("/{item_id}")
    def update_item(item_id: int, body: update_model):
        if repo.get_row(table, item_id) is None:
            raise HTTPException(status_code=404, detail="Not found")
        return repo.update_row(table, item_id, body.model_dump(exclude_unset=True))

    @router.delete("/{item_id}", status_code=204)
    def delete_item(item_id: int):
        repo.delete_row(table, item_id)
        return Response(status_code=204)

    return router
