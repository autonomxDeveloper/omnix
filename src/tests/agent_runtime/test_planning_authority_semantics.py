from __future__ import annotations

from app.agent_runtime.contracts import TaskRevision
from app.agent_runtime.planning import classify_operation_effect, operation_plan_failures
from app.agent_runtime.planning_api import (
    _planning_state_should_stale,
    _planning_state_status_after_submission,
)


def _revision() -> TaskRevision:
    return TaskRevision(
        revision_id="revision-plan",
        run_id="run-plan",
        sequence=1,
        user_instruction="Update the implementation",
        effective_objective="Update the implementation",
    )


def test_read_and_validation_do_not_require_an_approved_plan() -> None:
    revision = _revision()

    assert operation_plan_failures(None, revision, effect="read") == []
    assert operation_plan_failures(None, revision, effect="validate") == []
    assert operation_plan_failures(None, revision, effect="mutate") == ["approved_plan_missing"]
    assert operation_plan_failures(None, revision, effect="unknown") == ["approved_plan_missing"]


def test_npm_prefix_dependency_commands_are_mutations_not_validation() -> None:
    assert classify_operation_effect(
        "bash",
        command="npm --prefix src/apps/web install",
    ) == "mutate"
    assert classify_operation_effect(
        "powershell",
        command="npm.cmd --prefix src/apps/web update react",
    ) == "mutate"
    assert classify_operation_effect(
        "bash",
        command="npm --prefix src/apps/web uninstall react",
    ) == "mutate"


def test_npm_prefix_known_checks_remain_validation_and_unknown_scripts_fail_closed() -> None:
    assert classify_operation_effect(
        "bash",
        command="npm --prefix src/apps/web run test -- --runInBand",
    ) == "validate"
    assert classify_operation_effect(
        "bash",
        command="npm --prefix src/apps/web run build",
    ) == "validate"
    assert classify_operation_effect(
        "powershell",
        command="npm.cmd --prefix src/apps/web run typecheck",
    ) == "validate"
    assert classify_operation_effect(
        "bash",
        command="npm --prefix src/apps/web run generate-client",
    ) == "mutate"
    assert classify_operation_effect(
        "bash",
        command="npm --prefix src/apps/web run custom-script",
    ) == "unknown"


def test_attempted_off_plan_mutation_does_not_stale_valid_plan_authority() -> None:
    assert not _planning_state_should_stale([
        "mutation_not_in_plan:src/unplanned.py",
        "mutate_command_not_in_plan",
    ])
    assert not _planning_state_should_stale(["repair_requires_plan_delta"])


def test_actual_authority_drift_stales_plan_state() -> None:
    for reason in (
        "plan_task_revision_stale",
        "plan_engineering_contract_stale",
        "plan_inspection_evidence_stale",
        "planning_state_task_revision_stale",
        "planning_base_commit_changed",
    ):
        assert _planning_state_should_stale([reason])


def test_rejected_amendment_does_not_revoke_existing_active_plan() -> None:
    assert _planning_state_status_after_submission("rejected", "approved-plan-1") == "approved"
    assert _planning_state_status_after_submission("rejected", None) == "rejected"
    assert _planning_state_status_after_submission("approved", "approved-plan-2") == "approved"
