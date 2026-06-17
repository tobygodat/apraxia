"""API smoke test: auth gate + a todo CRUD round-trip (spec §4e, §9)."""


def test_auth_gate_blocks_until_login(client):
    assert client.get("/api/todos").status_code == 401
    assert client.post("/api/login", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/login", json={"password": "test-secret"}).status_code == 200
    # cookie now set on the TestClient → access granted
    assert client.get("/api/todos").status_code == 200


def test_todo_roundtrip_over_http(client):
    client.post("/api/login", json={"password": "test-secret"})

    created = client.post("/api/todos", json={"text": "buy milk"})
    assert created.status_code == 201
    body = created.json()
    assert body["text"] == "buy milk"
    assert body["source"] == "webapp"

    listing = client.get("/api/todos").json()
    assert any(t["id"] == body["id"] for t in listing)


def test_health_is_open(client):
    assert client.get("/api/health").json() == {"status": "ok"}
