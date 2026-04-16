"""
Tests for SPA serving logic in app.py.

These tests verify that the FastAPI SPA serving routes behave correctly:
1. Root serves built SPA when frontend/dist/index.html exists
2. Root falls back to legacy HTML when dist is absent
3. /assets/... serves Vite-built assets with path traversal protection
4. Catch-all SPA fallback does NOT intercept /api, /ws, /static, /assets, /logo namespaces
5. Catch-all returns SPA index.html for client-side routes like /chat, /rpg, /voice

These tests mirror the exact routing logic in app.py without importing it,
because app.py has heavy dependencies (numpy, torch, etc).
"""

import os
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from httpx import ASGITransport, AsyncClient

# ─── Replicate the exact SPA serving logic from app.py ────────────────────


def _create_app(base_dir: Path, templates_dir: Path) -> FastAPI:
    """Create a minimal FastAPI app with the same SPA serving routes as app.py."""
    app = FastAPI()

    index_file = templates_dir / "index.html"
    frontend_dist = base_dir / "frontend" / "dist"
    static_dir = base_dir / "src" / "static"

    _index_html_cache = [None]  # mutable container for closure

    def get_index_html():
        if _index_html_cache[0] is not None:
            return _index_html_cache[0]
        if index_file.exists():
            content = index_file.read_text(encoding="utf-8")
            content = content.replace("{{ url_for('static', filename='", "/static/")
            content = content.replace("') }}", "")
            content = content.replace("{{ ", "").replace(" }}", "")
            _index_html_cache[0] = content
            return content
        return None

    @app.get("/")
    async def root():
        spa_index = frontend_dist / "index.html"
        if spa_index.exists():
            return FileResponse(spa_index)
        content = get_index_html()
        if content:
            return HTMLResponse(content)
        return HTMLResponse("<h1>Omnix</h1><p>Static files not found</p>")

    @app.get("/assets/{path:path}")
    async def serve_frontend_assets(path: str):
        file_path = (frontend_dist / "assets" / path).resolve()
        if not str(file_path).startswith(str(frontend_dist.resolve())):
            return HTMLResponse("Forbidden", status_code=403)
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return HTMLResponse("Not Found", status_code=404)

    @app.get("/static/{path:path}")
    async def serve_static(path: str):
        file_path = static_dir / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return HTMLResponse("Not Found", status_code=404)

    # Dummy API/WS routes for namespace guarding tests
    @app.get("/api/health")
    async def api_health():
        return {"status": "ok"}

    @app.get("/ws/conversation")
    async def ws_placeholder():
        return {"error": "use websocket"}

    @app.get("/logo/icon.png")
    async def logo_placeholder():
        return HTMLResponse("logo", status_code=200)

    # SPA fallback - must be LAST
    @app.get("/{catch_all:path}")
    async def spa_fallback(catch_all: str):
        if catch_all.startswith(("api/", "ws/", "static/", "logo/", "assets/")):
            return HTMLResponse("Not Found", status_code=404)
        spa_index = frontend_dist / "index.html"
        if spa_index.exists():
            return FileResponse(spa_index)
        return HTMLResponse("Not Found", status_code=404)

    return app


# ─── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def tmp_project():
    """Create a temporary project directory structure."""
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        # Create directory structure
        (base / "frontend" / "dist" / "assets").mkdir(parents=True)
        (base / "src" / "static").mkdir(parents=True)
        (base / "src" / "templates").mkdir(parents=True)
        yield base


@pytest.fixture
def spa_index_content():
    return "<!DOCTYPE html><html><body><div id='root'></div></body></html>"


@pytest.fixture
def legacy_index_content():
    return "<html><body>Legacy Omnix</body></html>"


# ─── Test: Root serves SPA when dist exists ───────────────────────────────


@pytest.mark.asyncio
async def test_root_serves_spa_when_dist_exists(tmp_project, spa_index_content):
    """Root (/) should serve frontend/dist/index.html when it exists."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/")
    assert resp.status_code == 200
    assert "root" in resp.text


@pytest.mark.asyncio
async def test_root_falls_back_to_legacy_when_dist_absent(tmp_project, legacy_index_content):
    """Root (/) should fall back to templates/index.html when dist is absent."""
    templates_dir = tmp_project / "src" / "templates"
    (templates_dir / "index.html").write_text(legacy_index_content)
    # Don't create frontend/dist/index.html

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/")
    assert resp.status_code == 200
    assert "Legacy Omnix" in resp.text


@pytest.mark.asyncio
async def test_root_returns_fallback_message_when_nothing_exists(tmp_project):
    """Root (/) should return a fallback message when neither dist nor templates exist."""
    templates_dir = tmp_project / "src" / "templates"
    # Don't create any index files

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/")
    assert resp.status_code == 200
    assert "Static files not found" in resp.text


# ─── Test: Asset serving ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_assets_serves_vite_output(tmp_project):
    """GET /assets/main.js should serve the file from frontend/dist/assets/."""
    asset_path = tmp_project / "frontend" / "dist" / "assets" / "main.js"
    asset_path.write_text("console.log('hello');")
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/assets/main.js")
    assert resp.status_code == 200
    assert "hello" in resp.text


@pytest.mark.asyncio
async def test_assets_rejects_path_traversal(tmp_project):
    """GET /assets/../../etc/passwd should be rejected (403 Forbidden)."""
    templates_dir = tmp_project / "src" / "templates"
    # Create a file outside dist that an attacker might try to reach
    secret = tmp_project / "secret.txt"
    secret.write_text("secret data")

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/assets/../../secret.txt")
    # Should be either 403 (traversal detected) or 404 (not found)
    assert resp.status_code in (403, 404)
    assert "secret data" not in resp.text


@pytest.mark.asyncio
async def test_assets_returns_404_for_missing_file(tmp_project):
    """GET /assets/nonexistent.js should return 404."""
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/assets/nonexistent.js")
    assert resp.status_code == 404


# ─── Test: Catch-all does NOT intercept reserved namespaces ───────────────


@pytest.mark.asyncio
async def test_catchall_does_not_intercept_api(tmp_project, spa_index_content):
    """/api/health should be handled by its own route, not by SPA fallback."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_catchall_does_not_intercept_static(tmp_project, spa_index_content):
    """/static/style.css should serve from static dir, not SPA fallback."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    static_file = tmp_project / "src" / "static" / "style.css"
    static_file.write_text("body { color: red; }")
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/static/style.css")
    assert resp.status_code == 200
    assert "color: red" in resp.text


@pytest.mark.asyncio
async def test_catchall_does_not_intercept_ws(tmp_project, spa_index_content):
    """/ws/conversation should be handled by its own route, not SPA fallback."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/ws/conversation")
    assert resp.status_code == 200
    assert "websocket" in resp.text.lower() or "error" in resp.text.lower()


@pytest.mark.asyncio
async def test_catchall_does_not_intercept_logo(tmp_project, spa_index_content):
    """/logo/icon.png should be handled by logo route, not SPA fallback."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/logo/icon.png")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_catchall_does_not_intercept_assets_prefix(tmp_project, spa_index_content):
    """Catch-all should not intercept /assets/ prefix paths."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # /assets/something should hit the assets route, not the fallback
        resp = await client.get("/assets/missing.js")
    # Should be 404 from the assets handler, not a SPA index
    assert resp.status_code == 404


# ─── Test: Catch-all DOES serve SPA for client routes ─────────────────────


@pytest.mark.asyncio
async def test_catchall_serves_spa_for_chat_route(tmp_project, spa_index_content):
    """/chat should return the SPA index.html for client-side routing."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/chat")
    assert resp.status_code == 200
    assert "root" in resp.text


@pytest.mark.asyncio
async def test_catchall_serves_spa_for_rpg_route(tmp_project, spa_index_content):
    """/rpg should return the SPA index.html."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/rpg")
    assert resp.status_code == 200
    assert "root" in resp.text


@pytest.mark.asyncio
async def test_catchall_serves_spa_for_nested_route(tmp_project, spa_index_content):
    """/chat/some-session-id should return the SPA index.html."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/chat/abc-123-session")
    assert resp.status_code == 200
    assert "root" in resp.text


@pytest.mark.asyncio
async def test_catchall_serves_spa_for_voice_route(tmp_project, spa_index_content):
    """/voice should return the SPA index.html."""
    (tmp_project / "frontend" / "dist" / "index.html").write_text(spa_index_content)
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/voice")
    assert resp.status_code == 200
    assert "root" in resp.text


@pytest.mark.asyncio
async def test_catchall_returns_404_when_no_spa_built(tmp_project):
    """/chat should return 404 when frontend/dist doesn't exist."""
    templates_dir = tmp_project / "src" / "templates"

    app = _create_app(tmp_project, templates_dir)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/chat")
    assert resp.status_code == 404
