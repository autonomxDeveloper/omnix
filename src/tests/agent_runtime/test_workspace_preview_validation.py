from __future__ import annotations

from pathlib import Path
import subprocess
from unittest.mock import Mock

from app.assistant_tools import browser_adapter
from app.assistant_tools.models import AssistantToolRequest


def _completed(argv: list[str], *, stdout: str = "", returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(argv, returncode, stdout=stdout, stderr="")


def _request(action_id: str, input_payload: dict[str, object]) -> AssistantToolRequest:
    return AssistantToolRequest(
        tool_id="browser",
        action_id=action_id,
        session_id="chat:test",
        proposal_id="agent:run-preview-test:tool-call",
        input=input_payload,
    )


def test_browser_open_workspace_preview_uses_managed_exact_worktree_url(monkeypatch) -> None:
    url = "http://127.0.0.1:43123/chatbot"
    start = Mock(
        return_value=(
            url,
            {
                "workspace_preview": True,
                "workspace_preview_url": "http://127.0.0.1:43123",
                "workspace_preview_port": 43123,
                "workspace_preview_path": "/chatbot",
            },
        )
    )
    calls: list[list[str]] = []

    def fake_run(argv: list[str], *, timeout_seconds: int | None = None):
        calls.append(list(argv))
        return _completed(argv)

    monkeypatch.setattr(browser_adapter, "browser_available", lambda: True)
    monkeypatch.setattr(browser_adapter, "_start_workspace_preview", start)
    monkeypatch.setattr(browser_adapter, "_run", fake_run)

    result = browser_adapter.run_browser_tool_request(
        _request(
            "browser.open",
            {"workspace_preview": True, "path": "/chatbot"},
        )
    )

    assert result.error is None
    assert result.output["workspace_preview"] is True
    assert result.output["url"] == url
    assert calls and calls[0][-2:] == ["open", url]
    start.assert_called_once()


def test_passing_browser_assertion_cleans_preview_and_browser_without_separate_capability(monkeypatch) -> None:
    calls: list[list[str]] = []

    def fake_run(argv: list[str], *, timeout_seconds: int | None = None):
        calls.append(list(argv))
        if argv[-1] == "close":
            assert timeout_seconds == 5
            return _completed(argv)
        return _completed(argv, stdout="‹")

    stop = Mock(return_value=True)
    monkeypatch.setattr(browser_adapter, "browser_available", lambda: True)
    monkeypatch.setattr(browser_adapter, "_run", fake_run)
    monkeypatch.setattr(browser_adapter, "_stop_workspace_preview", stop)

    result = browser_adapter.run_browser_tool_request(
        _request(
            "browser.assert_text_not_contains",
            {"selector": ".assistant-side-panel-minimize", "expected": "Minimize"},
        )
    )

    assert result.error is None
    assert result.output["assertion_passed"] is True
    assert result.output["cleanup"] == {
        "workspace_preview_stopped": True,
        "browser_closed": True,
    }
    assert len(calls) == 2
    assert calls[1][-1] == "close"
    stop.assert_called_once()


def test_failed_browser_assertion_keeps_preview_available_for_repair(monkeypatch) -> None:
    stop = Mock(return_value=True)
    monkeypatch.setattr(browser_adapter, "browser_available", lambda: True)
    monkeypatch.setattr(
        browser_adapter,
        "_run",
        lambda argv, *, timeout_seconds=None: _completed(argv, stdout="Minimize"),
    )
    monkeypatch.setattr(browser_adapter, "_stop_workspace_preview", stop)

    result = browser_adapter.run_browser_tool_request(
        _request(
            "browser.assert_text_not_contains",
            {"selector": ".assistant-side-panel-minimize", "expected": "Minimize"},
        )
    )

    assert result.error == "browser_assertion_failed"
    stop.assert_not_called()


def test_run_id_is_bound_from_broker_execution_identity() -> None:
    request = _request("browser.get_url", {})
    assert browser_adapter._run_id_from_request(request) == "run-preview-test"


def test_pi_guard_rejects_shell_preview_and_prompt_uses_managed_preview() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    guard = (repo_root / "src/app/agent_runtime/pi_guard_extension.ts").read_text(encoding="utf-8")
    runtime = (repo_root / "src/app/agent_runtime/pi_runtime.py").read_text(encoding="utf-8")
    broker_extension = (repo_root / "src/app/agent_runtime/pi_broker_extension.ts").read_text(encoding="utf-8")

    assert "managedPreviewShellCommand" in guard
    assert "Do not launch npm/vite dev or preview servers through shell commands" in guard
    assert '"workspace_preview": true' in runtime
    assert "automatically tears down the workspace preview and browser session" in runtime
    assert "workspace_preview: true" in broker_extension
