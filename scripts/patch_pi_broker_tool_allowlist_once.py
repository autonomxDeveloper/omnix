from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "src/app/agent_runtime/pi_runtime_core.py"
RUNTIME = ROOT / "src/app/agent_runtime/pi_runtime.py"
TESTS = ROOT / "src/tests/agent_runtime/test_pi_runtime.py"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"expected patch anchor not found in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    CORE,
    '''    tools = sorted({tool for capability, tool in mapping.items() if capability in spec.capabilities})
    if tools:
        argv.extend(["--tools", ",".join(tools)])
    else:
        argv.append("--no-builtin-tools")
''',
    '''    tools = {tool for capability, tool in mapping.items() if capability in spec.capabilities}
    # Pi's --tools option is a global active-tool allowlist: it filters extension
    # tools as well as built-ins. Whenever Omnix issues governed external
    # capabilities, keep the broker extension's canonical tool active or the
    # model can see the authority in its prompt but has no callable path to use
    # it. This is intentionally independent of the specific external capability
    # IDs; pi_broker_extension.ts still enforces the RunSpec allowlist itself.
    if spec.external_capabilities:
        tools.add("omnix_capability")
    if tools:
        argv.extend(["--tools", ",".join(sorted(tools))])
    else:
        argv.append("--no-builtin-tools")
''',
)

replace_once(
    RUNTIME,
    '''10. REQUEST COMPLETION — Pi settling is only a completion request. Omnix will independently validate/review the exact final state and is the only authority that can mark the run completed.
''',
    '''10. REQUEST COMPLETION — Pi settling is only a completion request. Omnix will independently validate/review the exact final state and is the only authority that can mark the run completed.
GOVERNED CAPABILITIES — capabilities listed under `Issued governed external capabilities` are already issued by Omnix. When one is needed, invoke it through `omnix_capability`; do not ask the user to issue or enable an already-listed capability.
''',
)

tests = TESTS.read_text(encoding="utf-8")
marker = "def test_pi_rpc_keeps_broker_tool_active_with_mixed_authority"
if marker not in tests:
    addition = r'''


def test_pi_rpc_keeps_broker_tool_active_with_mixed_authority(tmp_path: Path) -> None:
    """Regression for runs that have both workspace and governed browser tools.

    Pi's --tools flag allowlists extension tools too. Omitting
    ``omnix_capability`` makes issued browser/research authority visible in the
    prompt but impossible for the model to invoke.
    """
    spec = AgentRunSpec(
        run_id="run-mixed-tools",
        task="Update the visible sidebar and verify it in the browser",
        profile="coding",
        model=ModelRef(provider_id="test", model_id="model"),
        workspace=WorkspaceSpec(root=str(tmp_path)),
        capabilities=["workspace.read", "workspace.edit", "workspace.test"],
        external_capabilities=["browser.open", "browser.assert_text_contains"],
    )

    argv = pi_rpc_argv(spec, pi_path="pi")

    assert "--tools" in argv
    active = set(argv[argv.index("--tools") + 1].split(","))
    assert "read" in active
    assert "edit" in active
    assert "omnix_capability" in active


def test_pi_rpc_external_only_explicitly_allowlists_broker_tool(tmp_path: Path) -> None:
    spec = AgentRunSpec(
        run_id="run-external-only",
        task="Research through the governed broker",
        profile="research",
        model=ModelRef(provider_id="test", model_id="model"),
        workspace=WorkspaceSpec(root=str(tmp_path)),
        capabilities=[],
        external_capabilities=["research.web_search"],
    )

    argv = pi_rpc_argv(spec, pi_path="pi")

    assert "--tools" in argv
    assert argv[argv.index("--tools") + 1].split(",") == ["omnix_capability"]
    assert "--no-builtin-tools" not in argv


def test_pi_rpc_does_not_expose_broker_tool_without_external_authority(tmp_path: Path) -> None:
    spec = AgentRunSpec(
        run_id="run-local-only",
        task="Read a file",
        profile="coding",
        model=ModelRef(provider_id="test", model_id="model"),
        workspace=WorkspaceSpec(root=str(tmp_path)),
        capabilities=["workspace.read"],
        external_capabilities=[],
    )

    argv = pi_rpc_argv(spec, pi_path="pi")

    active = set(argv[argv.index("--tools") + 1].split(","))
    assert active == {"read"}
    assert "omnix_capability" not in active


def test_coding_prompt_treats_listed_governed_capabilities_as_already_issued() -> None:
    spec = AgentRunSpec(
        run_id="run-governed-prompt",
        task="Verify the UI",
        profile="coding",
        model=ModelRef(provider_id="test", model_id="model"),
        capabilities=["workspace.read"],
        external_capabilities=["browser.assert_text_contains"],
    )

    prompt = PiAgentRuntime._initial_prompt(spec)

    assert "capabilities listed under `Issued governed external capabilities` are already issued" in prompt
    assert "invoke it through `omnix_capability`" in prompt
'''
    TESTS.write_text(tests.rstrip() + addition + "\n", encoding="utf-8")

print("Pi broker tool allowlist patch applied")
