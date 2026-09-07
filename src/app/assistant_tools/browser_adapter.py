"""Governed browser adapter backed by Vercel Labs agent-browser.

Pi never receives the raw ``agent-browser`` executable. Browser operations are
canonical Omnix capabilities dispatched here after RunSpec, approval and budget
checks. The adapter adds agent-browser's own domain/network containment as a
second boundary and disables page-provided WebMCP tools.

For coding UI validation, ``browser.open`` also supports an Omnix-owned
``workspace_preview`` mode. The backend resolves the exact run worktree, starts
the repository web app on an allocated loopback port without shell composition,
and tears the preview/browser session down automatically after a passing
deterministic assertion. The model never owns the preview process lifecycle.
"""
from __future__ import annotations

import atexit
from dataclasses import dataclass
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .models import AssistantToolRequest, AssistantToolResult

_BROWSER_ACTIONS = {
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.fill",
    "browser.press",
    "browser.hover",
    "browser.select",
    "browser.scroll",
    "browser.wait",
    "browser.get_text",
    "browser.get_attribute",
    "browser.get_url",
    "browser.screenshot",
    "browser.assert_text_contains",
    "browser.assert_text_not_contains",
    "browser.assert_attribute_contains",
    "browser.assert_url_contains",
    "browser.close",
}
_ASSERTIONS = {
    "browser.assert_text_contains",
    "browser.assert_text_not_contains",
    "browser.assert_attribute_contains",
    "browser.assert_url_contains",
}
_INTERACTIVE = {
    "browser.click",
    "browser.fill",
    "browser.press",
    "browser.select",
}
_DEFAULT_ALLOWED_DOMAINS = ("localhost", "127.0.0.1", "::1")
_SAFE_ENV_KEYS = (
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "LANG",
    "LC_ALL",
)
_SELECTOR = re.compile(r"^.{1,1024}$", re.S)
_MAX_VALUE_CHARS = 16_000
_MAX_OUTPUT_CHARS = 50_000
_PREVIEW_PACKAGE_PATH = "src/apps/web"
_PREVIEW_ROUTE = re.compile(r"^/[^\r\n\x00]{0,2047}$", re.S)


@dataclass
class _WorkspacePreview:
    process: subprocess.Popen[str]
    url: str
    port: int
    timer: threading.Timer | None = None


_PREVIEW_LOCK = threading.RLock()
_PREVIEWS: dict[str, _WorkspacePreview] = {}


def _flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().casefold() in {"1", "true", "yes", "on"}


def agent_browser_command() -> str:
    configured = os.environ.get("OMNIX_AGENT_BROWSER_COMMAND", "").strip()
    if configured:
        return configured
    repo_root = Path(__file__).resolve().parents[3]
    local_bin = repo_root / ".tools" / "npm-global"
    candidates = (
        local_bin / "agent-browser.cmd",
        local_bin / "agent-browser",
    )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return "agent-browser"


def browser_available() -> bool:
    if not _flag("OMNIX_AGENT_BROWSER_ENABLED", True):
        return False
    command = agent_browser_command()
    if os.path.isabs(command) or os.sep in command or (os.altsep and os.altsep in command):
        return Path(command).is_file()
    return shutil.which(command) is not None


def browser_allowed_domains() -> tuple[str, ...]:
    raw = os.environ.get("OMNIX_AGENT_BROWSER_ALLOWED_DOMAINS", "").strip()
    if not raw:
        return _DEFAULT_ALLOWED_DOMAINS
    values: list[str]
    try:
        parsed = json.loads(raw)
        values = [str(item) for item in parsed] if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        values = raw.split(",")
    normalized = []
    for item in values:
        value = item.strip().casefold()
        if value and not any(ch.isspace() for ch in value):
            normalized.append(value)
    return tuple(dict.fromkeys(normalized)) or _DEFAULT_ALLOWED_DOMAINS


def _domain_allowed(hostname: str) -> bool:
    host = hostname.strip().casefold().rstrip(".")
    if not host:
        return False
    for pattern in browser_allowed_domains():
        candidate = pattern.strip().casefold().rstrip(".")
        if candidate.startswith("*."):
            suffix = candidate[2:]
            if host == suffix or host.endswith("." + suffix):
                return True
        elif host == candidate:
            return True
    return False


def _validate_open_url(value: object) -> str:
    url = str(value or "").strip()
    if url == "about:blank":
        return url
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("browser.open requires an http(s) URL or about:blank")
    if parsed.username or parsed.password:
        raise ValueError("browser.open does not allow credentials embedded in URLs")
    if not _domain_allowed(parsed.hostname):
        raise ValueError("browser origin is outside OMNIX_AGENT_BROWSER_ALLOWED_DOMAINS")
    return url


def _session_name(session_id: str | None) -> str:
    digest = hashlib.sha256(str(session_id or "omnix").encode("utf-8")).hexdigest()[:20]
    return f"omnix-{digest}"


def _safe_text(value: object, *, field: str, max_chars: int = _MAX_VALUE_CHARS) -> str:
    text = str(value or "")
    if not text or len(text) > max_chars or "\x00" in text:
        raise ValueError(f"browser {field} is missing or too large")
    return text


def _safe_selector(value: object) -> str:
    selector = str(value or "").strip()
    if not selector or not _SELECTOR.fullmatch(selector):
        raise ValueError("browser selector is missing or too large")
    return selector


def _timeout_seconds() -> int:
    try:
        return max(5, min(int(os.environ.get("OMNIX_AGENT_BROWSER_TIMEOUT_SECONDS", "45")), 180))
    except ValueError:
        return 45


def _preview_start_timeout_seconds() -> int:
    try:
        return max(3, min(int(os.environ.get("OMNIX_AGENT_PREVIEW_START_TIMEOUT_SECONDS", "20")), 60))
    except ValueError:
        return 20


def _preview_ttl_seconds() -> int:
    try:
        return max(30, min(int(os.environ.get("OMNIX_AGENT_PREVIEW_TTL_SECONDS", "300")), 1800))
    except ValueError:
        return 300


def _minimal_environment() -> dict[str, str]:
    source = os.environ
    env = {key: source[key] for key in _SAFE_ENV_KEYS if source.get(key)}
    executable = os.environ.get("AGENT_BROWSER_EXECUTABLE_PATH", "").strip()
    if executable:
        env["AGENT_BROWSER_EXECUTABLE_PATH"] = executable
    return env


def _preview_environment() -> dict[str, str]:
    env = _minimal_environment()
    for key, value in os.environ.items():
        # VITE_* values are deliberately browser-public configuration. Do not
        # leak arbitrary Omnix/backend environment variables into repository
        # code executed by the preview process.
        if key.startswith("VITE_"):
            env[key] = value
    return env


def _base_argv(request: AssistantToolRequest) -> list[str]:
    return [
        agent_browser_command(),
        "--session",
        _session_name(request.session_id),
        "--allowed-domains",
        ",".join(browser_allowed_domains()),
        "--content-boundaries",
        "--max-output",
        str(_MAX_OUTPUT_CHARS),
        "--no-webmcp",
    ]


def _run(
    argv: list[str],
    *,
    timeout_seconds: int | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        shell=False,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout_seconds if timeout_seconds is not None else _timeout_seconds(),
        env=_minimal_environment(),
    )


def _run_id_from_request(request: AssistantToolRequest) -> str | None:
    proposal = str(request.proposal_id or "").strip()
    if not proposal.startswith("agent:"):
        return None
    parts = proposal.split(":", 2)
    if len(parts) != 3 or not parts[1].strip():
        return None
    return parts[1].strip()


def _workspace_for_preview(request: AssistantToolRequest) -> tuple[str, Path]:
    run_id = _run_id_from_request(request)
    if not run_id:
        raise ValueError("workspace preview requires a run-scoped broker proposal")

    # Lazy import avoids coupling the assistant-tool module graph to the Agent
    # service at import time while still resolving the authoritative RunSpec.
    from app.agent_runtime.service import default_agent_run_service

    snapshot = default_agent_run_service().get(run_id)
    if snapshot is None or snapshot.spec.workspace is None:
        raise ValueError("workspace preview requires an issued Agent workspace")
    workspace = snapshot.spec.workspace
    root = Path(workspace.worktree or workspace.root).resolve()
    package_json = root / _PREVIEW_PACKAGE_PATH / "package.json"
    if not package_json.is_file():
        raise ValueError(f"workspace preview package is missing: {_PREVIEW_PACKAGE_PATH}")
    return run_id, root


def _preview_npm_command() -> str:
    configured = os.environ.get("OMNIX_AGENT_PREVIEW_NPM_COMMAND", "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.is_file():
            return str(candidate)
        raise ValueError("OMNIX_AGENT_PREVIEW_NPM_COMMAND does not point to a file")

    repo_root = Path(__file__).resolve().parents[3]
    patterns = (
        "node-v*-win-x64/npm.cmd",
        "node-v*-linux-x64/bin/npm",
        "node-v*-darwin-*/bin/npm",
    )
    candidates: list[Path] = []
    for pattern in patterns:
        candidates.extend((repo_root / ".tools").glob(pattern))
    for candidate in sorted(candidates, key=lambda path: str(path), reverse=True):
        if candidate.is_file():
            return str(candidate)

    resolved = shutil.which("npm.cmd") or shutil.which("npm")
    if not resolved:
        raise ValueError("npm is unavailable for the Omnix workspace preview")
    return resolved


def _allocate_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _wait_for_preview(process: subprocess.Popen[str], port: int) -> bool:
    deadline = time.monotonic() + _preview_start_timeout_seconds()
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def _terminate_preview_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            taskkill = shutil.which("taskkill")
            if taskkill:
                subprocess.run(
                    [taskkill, "/PID", str(process.pid), "/T", "/F"],
                    shell=False,
                    check=False,
                    capture_output=True,
                    timeout=5,
                    env=_minimal_environment(),
                )
            else:
                process.terminate()
        else:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            except (OSError, ProcessLookupError):
                process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if os.name != "nt":
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    process.kill()
            else:
                process.kill()
            process.wait(timeout=2)
    except (OSError, subprocess.SubprocessError):
        try:
            process.kill()
        except OSError:
            pass


def _expire_workspace_preview(run_id: str, pid: int) -> None:
    with _PREVIEW_LOCK:
        preview = _PREVIEWS.get(run_id)
        if preview is None or preview.process.pid != pid:
            return
        _PREVIEWS.pop(run_id, None)
    _terminate_preview_process(preview.process)


def _stop_workspace_preview(request: AssistantToolRequest) -> bool:
    run_id = _run_id_from_request(request)
    if not run_id:
        return False
    with _PREVIEW_LOCK:
        preview = _PREVIEWS.pop(run_id, None)
    if preview is None:
        return False
    if preview.timer is not None:
        preview.timer.cancel()
    _terminate_preview_process(preview.process)
    return True


def _stop_all_workspace_previews() -> None:
    with _PREVIEW_LOCK:
        previews = list(_PREVIEWS.values())
        _PREVIEWS.clear()
    for preview in previews:
        if preview.timer is not None:
            preview.timer.cancel()
        _terminate_preview_process(preview.process)


def _start_workspace_preview(
    request: AssistantToolRequest,
    payload: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    run_id, root = _workspace_for_preview(request)
    route = str(payload.get("path") or "/").strip()
    if not _PREVIEW_ROUTE.fullmatch(route) or "\\" in route:
        raise ValueError("workspace preview path must be a bounded absolute browser route")

    _stop_workspace_preview(request)
    npm = _preview_npm_command()
    last_error = "workspace preview failed to become ready"
    for _attempt in range(3):
        port = _allocate_loopback_port()
        argv = [
            npm,
            "--prefix",
            _PREVIEW_PACKAGE_PATH,
            "run",
            "dev",
            "--",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--strictPort",
        ]
        popen_kwargs: dict[str, Any] = {
            "cwd": str(root),
            "env": _preview_environment(),
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "shell": False,
            "text": True,
        }
        if os.name == "nt":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            popen_kwargs["start_new_session"] = True
        try:
            process = subprocess.Popen(argv, **popen_kwargs)
        except OSError as exc:
            raise ValueError(f"workspace preview could not start npm: {type(exc).__name__}") from exc

        if not _wait_for_preview(process, port):
            code = process.poll()
            _terminate_preview_process(process)
            last_error = (
                f"workspace preview process exited with code {code}"
                if code is not None
                else "workspace preview did not listen before the startup timeout"
            )
            continue

        base_url = f"http://127.0.0.1:{port}"
        url = f"{base_url}{route}"
        preview = _WorkspacePreview(process=process, url=base_url, port=port)
        timer = threading.Timer(
            _preview_ttl_seconds(),
            _expire_workspace_preview,
            args=(run_id, process.pid),
        )
        timer.daemon = True
        preview.timer = timer
        with _PREVIEW_LOCK:
            _PREVIEWS[run_id] = preview
        timer.start()
        return url, {
            "workspace_preview": True,
            "workspace_preview_url": base_url,
            "workspace_preview_port": port,
            "workspace_preview_path": route,
            "workspace_preview_package": _PREVIEW_PACKAGE_PATH,
        }

    raise ValueError(last_error)


def _best_effort_validation_cleanup(request: AssistantToolRequest) -> dict[str, bool]:
    preview_stopped = _stop_workspace_preview(request)
    if not preview_stopped:
        return {
            "workspace_preview_stopped": False,
            "browser_closed": False,
        }
    browser_closed = False
    try:
        completed = _run(_base_argv(request) + ["close"], timeout_seconds=5)
        browser_closed = completed.returncode == 0
    except (OSError, subprocess.SubprocessError):
        browser_closed = False
    return {
        "workspace_preview_stopped": True,
        "browser_closed": browser_closed,
    }


def _command_for(request: AssistantToolRequest) -> tuple[list[str], dict[str, Any]]:
    action = request.action_id
    payload = dict(request.input)
    argv = _base_argv(request)
    metadata: dict[str, Any] = {}

    if action == "browser.open":
        if payload.get("workspace_preview") is True:
            url, preview_metadata = _start_workspace_preview(request, payload)
            metadata.update(preview_metadata)
        else:
            url = _validate_open_url(payload.get("url"))
        argv.extend(["open", url])
        metadata["url"] = url
    elif action == "browser.snapshot":
        argv.extend(["snapshot", "--json"])
    elif action == "browser.click":
        argv.extend(["click", _safe_selector(payload.get("selector"))])
    elif action == "browser.fill":
        argv.extend([
            "fill",
            _safe_selector(payload.get("selector")),
            _safe_text(payload.get("text"), field="text"),
        ])
    elif action == "browser.press":
        argv.extend(["press", _safe_text(payload.get("key"), field="key", max_chars=128)])
    elif action == "browser.hover":
        argv.extend(["hover", _safe_selector(payload.get("selector"))])
    elif action == "browser.select":
        argv.extend([
            "select",
            _safe_selector(payload.get("selector")),
            _safe_text(payload.get("value"), field="value", max_chars=2048),
        ])
    elif action == "browser.scroll":
        direction = str(payload.get("direction") or "down").strip().casefold()
        if direction not in {"up", "down", "left", "right"}:
            raise ValueError("browser.scroll direction must be up/down/left/right")
        argv.extend(["scroll", direction])
        pixels = payload.get("pixels")
        if pixels is not None:
            amount = int(pixels)
            if amount < 1 or amount > 100_000:
                raise ValueError("browser.scroll pixels outside allowed range")
            argv.append(str(amount))
    elif action == "browser.wait":
        supplied = [
            key for key in ("selector", "text", "url", "milliseconds", "load")
            if payload.get(key) not in {None, ""}
        ]
        if len(supplied) != 1:
            raise ValueError("browser.wait requires exactly one bounded wait condition")
        kind = supplied[0]
        if kind == "selector":
            argv.extend(["wait", _safe_selector(payload[kind])])
        elif kind == "text":
            argv.extend(["wait", "--text", _safe_text(payload[kind], field="text", max_chars=4096)])
        elif kind == "url":
            pattern = _safe_text(payload[kind], field="url pattern", max_chars=2048)
            argv.extend(["wait", "--url", pattern])
        elif kind == "load":
            state = str(payload[kind]).strip().casefold()
            if state not in {"load", "domcontentloaded", "networkidle"}:
                raise ValueError("browser.wait load state is not allowed")
            argv.extend(["wait", "--load", state])
        else:
            milliseconds = int(payload[kind])
            if milliseconds < 0 or milliseconds > 30_000:
                raise ValueError("browser.wait milliseconds outside allowed range")
            argv.extend(["wait", str(milliseconds)])
    elif action == "browser.get_text":
        argv.extend(["get", "text", _safe_selector(payload.get("selector"))])
    elif action == "browser.get_attribute":
        argv.extend([
            "get",
            "attr",
            _safe_selector(payload.get("selector")),
            _safe_text(payload.get("attribute"), field="attribute", max_chars=256),
        ])
    elif action == "browser.get_url":
        argv.extend(["get", "url"])
    elif action == "browser.screenshot":
        directory = Path(tempfile.gettempdir()) / "omnix-agent-browser"
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{_session_name(request.session_id)}-{os.urandom(6).hex()}.png"
        argv.extend(["screenshot", str(target)])
        if bool(payload.get("full_page")):
            argv.append("--full")
        metadata["screenshot_path"] = str(target)
    elif action == "browser.assert_text_contains":
        argv.extend(["get", "text", _safe_selector(payload.get("selector"))])
        metadata["assertion_expected"] = _safe_text(
            payload.get("expected"), field="expected text", max_chars=4096
        )
    elif action == "browser.assert_text_not_contains":
        argv.extend(["get", "text", _safe_selector(payload.get("selector"))])
        metadata["assertion_expected"] = _safe_text(
            payload.get("expected"), field="forbidden text", max_chars=4096
        )
    elif action == "browser.assert_attribute_contains":
        argv.extend([
            "get",
            "attr",
            _safe_selector(payload.get("selector")),
            _safe_text(payload.get("attribute"), field="attribute", max_chars=256),
        ])
        metadata["assertion_expected"] = _safe_text(
            payload.get("expected"), field="expected attribute", max_chars=4096
        )
    elif action == "browser.assert_url_contains":
        argv.extend(["get", "url"])
        metadata["assertion_expected"] = _safe_text(
            payload.get("expected"), field="expected URL", max_chars=4096
        )
    elif action == "browser.close":
        argv.append("close")
    else:
        raise ValueError("unsupported browser capability")
    return argv, metadata


def run_browser_tool_request(request: AssistantToolRequest) -> AssistantToolResult:
    if request.action_id not in _BROWSER_ACTIONS:
        return AssistantToolResult(
            tool_id="browser",
            action_id=request.action_id,
            session_id=request.session_id,
            result_summary="Unsupported governed browser action.",
            error="unsupported_browser_action",
        )
    if not browser_available():
        return AssistantToolResult(
            tool_id="browser",
            action_id=request.action_id,
            session_id=request.session_id,
            result_summary="agent-browser is not installed or is disabled.",
            error="browser_runtime_unavailable",
        )
    try:
        argv, metadata = _command_for(request)
        completed = _run(argv)
    except (ValueError, TypeError) as exc:
        if request.action_id == "browser.open" and request.input.get("workspace_preview") is True:
            _stop_workspace_preview(request)
        return AssistantToolResult(
            tool_id="browser",
            action_id=request.action_id,
            session_id=request.session_id,
            result_summary="Browser request was rejected by Omnix policy.",
            error=f"browser_policy_rejected:{exc}",
        )
    except (OSError, subprocess.SubprocessError) as exc:
        if request.action_id == "browser.open" and request.input.get("workspace_preview") is True:
            _stop_workspace_preview(request)
        return AssistantToolResult(
            tool_id="browser",
            action_id=request.action_id,
            session_id=request.session_id,
            result_summary="agent-browser failed to execute.",
            error=f"browser_runtime_error:{type(exc).__name__}",
        )

    stdout = (completed.stdout or "")[:_MAX_OUTPUT_CHARS]
    stderr = (completed.stderr or "")[:8_000]
    if completed.returncode != 0:
        if metadata.get("workspace_preview") is True:
            _stop_workspace_preview(request)
        return AssistantToolResult(
            tool_id="browser",
            action_id=request.action_id,
            session_id=request.session_id,
            state_changed=False,
            result_summary=f"Browser action failed with exit code {completed.returncode}.",
            output={"stdout": stdout, "stderr": stderr, **metadata},
            error="browser_command_failed",
        )

    output: dict[str, Any] = {"stdout": stdout, **metadata}
    if request.action_id in _ASSERTIONS:
        expected = str(metadata.get("assertion_expected") or "")
        assertion_failed = (
            expected in stdout
            if request.action_id == "browser.assert_text_not_contains"
            else expected not in stdout
        )
        if assertion_failed:
            return AssistantToolResult(
                tool_id="browser",
                action_id=request.action_id,
                session_id=request.session_id,
                state_changed=False,
                result_summary=f"Browser assertion failed for {request.action_id}.",
                output=output,
                error="browser_assertion_failed",
            )
        output["assertion_passed"] = True
        # A passing deterministic assertion is the terminal proof required by
        # coding validation. Cleanup applies only when this run owns a workspace
        # preview; unrelated governed browser sessions retain their old behavior.
        output["cleanup"] = _best_effort_validation_cleanup(request)
    if request.action_id == "browser.snapshot" and stdout.strip():
        try:
            output["snapshot"] = json.loads(stdout)
        except json.JSONDecodeError:
            pass
    screenshot_path = metadata.get("screenshot_path")
    if isinstance(screenshot_path, str):
        target = Path(screenshot_path)
        if target.is_file():
            data = target.read_bytes()
            output.update({
                "size_bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            })
    if request.action_id == "browser.close":
        output["workspace_preview_stopped"] = _stop_workspace_preview(request)

    return AssistantToolResult(
        tool_id="browser",
        action_id=request.action_id,
        session_id=request.session_id,
        state_changed=request.action_id in _INTERACTIVE,
        result_summary=f"Completed governed browser action {request.action_id}.",
        output=output,
    )


atexit.register(_stop_all_workspace_previews)
