from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main


def test_generation_requires_review():
    client = TestClient(main.app)
    response = client.post(
        "/api/spreadsheets",
        json={"review_confirmed": False, "products": [{"code": "123456", "quantity": 2}]},
    )
    assert response.status_code == 400


def test_home_allows_native_web_share():
    client = TestClient(main.app)
    response = client.get("/")
    assert response.status_code == 200
    assert "web-share=(self)" in response.headers["permissions-policy"]


def test_generate_and_download(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "GENERATED_DIR", tmp_path / "generated")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "test.db")
    main.GENERATED_DIR.mkdir()
    main.initialize(main.DB_PATH)
    client = TestClient(main.app)

    response = client.post(
        "/api/spreadsheets",
        json={
            "review_confirmed": True,
            "products": [
                {"code": "123456", "quantity": 2},
                {"code": "123456", "quantity": 3},
            ],
        },
    )
    assert response.status_code == 201
    result = response.json()
    assert result["product_count"] == 1
    assert result["unit_count"] == 5
    assert result["filename"].startswith("pedido_natura_")
    assert result["share_url"].startswith("/s/")

    download = client.get(result["download_url"])
    assert download.status_code == 200
    assert download.content[:2] == b"PK"

    shared = client.get(result["share_url"])
    assert shared.status_code == 200
    assert shared.content[:2] == b"PK"
