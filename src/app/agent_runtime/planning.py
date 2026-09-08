"""Evidence-backed durable planning policy and deterministic plan gates."""
from __future__ import annotations

from collections import defaultdict
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
from typing import Iterable, Sequence

from .contracts import AgentRunSpec, TaskRevision
from .planning_contracts import (
    ImpactCandidate,
    ImplementationPlanRevision,
    ImplementationPlanSubmission,
    InspectionEvidence,
    OperationEffect,
    PlanAuthority,
    PlanningConfidence,
    PlanningMode,
)
from .workspace import WorkspaceAuthority, WorkspacePolicyError

_QUOTED_LITERAL = re.compile(r'["`]([^"`\r\n]{2,200})["`]')
_UI = re.compile(r"\b(?:ui|ux|react|tsx|jsx|css|theme|button|modal|dialog|dropdown|menu|label|header|sidebar|form)\b", re.I)
_API = re.compile(r"\b(?:api|endpoint|route|schema|contract|request|response|client|interface)\b", re.I)
_PERSISTENCE = re.compile(r"\b(?:postgres|database|db|persist|migration|sql|repository|storage|model)\b", re.I)
_BUGFIX = re.compile(r"\b(?:bug|bugfix|broken|failure|fails?|incorrect|crash|error)\b", re.I)
_SECURITY = re.compile(r"\b(?:security|auth|authority|approval|capabilit|permission|credential|secret|trading|broker|payment)\b", re.I)
_REFACTOR = re.compile(r"\b(?:refactor|rename|move|extract|restructure|cleanup)\b", re.I)
_GENERATED = re.compile(r"\b(?:generated|codegen|openapi|client generation|schema generation|contract generation)\b", re.I)

_READ_COMMANDS = (
    "git status", "git diff", "git log", "git show", "git grep",
)
_VALIDATE_COMMANDS = (
    "python -m pytest", "pytest", "python -m py_compile",
    "ruff check", "npm test", "npm run test", "npm run build", "npm run typecheck",
    "npm run lint", "npx vitest", "npx tsc", "eslint",
)
_MUTATING_COMMAND = re.compile(
    r"(?:^|\s)--fix(?:\s|$)|\bmakemigrations\b|\balembic\s+revision\b|"
    r"(?:^|\s)(?:codegen|generate)(?:\s|$)|\bprettier\s+--write\b",
    re.I,
)
_NPM_MUTATING = re.compile(
    r"^npm(?:\.cmd)?(?:\s+--prefix\s+\S+)*\s+"
    r"(?:install|i|add|update|uninstall|remove|"
    r"run\s+(?:generate|codegen)(?:[-_:][A-Za-z0-9_.-]+)?)(?:\s|$)",
    re.I,
)
_NPM_VALIDATE = re.compile(
    r"^npm(?:\.cmd)?(?:\s+--prefix\s+\S+)*\s+(?:test|run\s+(?:test|build|typecheck|lint))(?:\s|$)",
    re.I,
)


def planning_mode(environment: dict[str, str] | None = None) -> PlanningMode:
    source = os.environ if environment is None else environment
    value = str(source.get("OMNIX_AGENT_PLANNING_MODE", "shadow") or "shadow").strip().casefold()
    return value if value in {"off", "shadow", "enforce"} else "shadow"  # type: ignore[return-value]


def _stable_digest(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def engineering_contract_digest(revision: TaskRevision) -> str:
    return _stable_digest({
        "revision_id": revision.revision_id,
        "requirements": [item.model_dump(mode="json") for item in revision.requirements],
        "constraints": [item.model_dump(mode="json") for item in revision.constraints],
        "validation_plan": [item.model_dump(mode="json") for item in revision.validation_plan],
    })


def derive_planning_lenses(revision: TaskRevision) -> list[str]:
    text = " ".join([
        revision.effective_objective,
        *[item.description for item in revision.requirements],
    ])
    lenses = {"regression"}
    for pattern, name in (
        (_UI, "ui_behavior"),
        (_API, "api_contract"),
        (_PERSISTENCE, "persistence"),
        (_BUGFIX, "bugfix"),
        (_SECURITY, "security_authority"),
        (_REFACTOR, "refactor"),
        (_GENERATED, "generated_contract"),
    ):
        if pattern.search(text):
            lenses.add(name)
    return sorted(lenses)


def extract_change_literals(revision: TaskRevision) -> list[str]:
    values: list[str] = []
    for value in _QUOTED_LITERAL.findall(revision.effective_objective):
        normalized = value.strip()
        if normalized and normalized not in values:
            values.append(normalized)
    if len(values) >= 2 and re.search(r"\b(?:rename|replace|change|update)\b", revision.effective_objective, re.I):
        return values[:1]
    return values[:8]


def capture_planning_baseline(spec: AgentRunSpec) -> tuple[str, dict[str, object]]:
    workspace = spec.workspace
    if workspace is None:
        raise WorkspacePolicyError("planning requires an issued workspace")
    authority = WorkspaceAuthority(
        workspace.worktree or workspace.root,
        allowed_paths=list(workspace.allowed_paths),
        forbidden_paths=list(workspace.forbidden_paths),
    )
    provenance = authority.provenance_snapshot()
    baseline_id = _stable_digest(provenance)
    return baseline_id, provenance


def _scope_value(authority: WorkspaceAuthority, value: str) -> str:
    cleaned = str(value or ".").strip().lstrip("@") or "."
    resolved = authority.resolve_path(cleaned)
    return resolved.relative_to(authority.root).as_posix() or "."


def _git_grep(authority: WorkspaceAuthority, query: str, scope: str) -> tuple[list[tuple[str, int, str]], str]:
    if not query:
        return [], "complete"
    result = authority.run_command(["git", "grep", "-n", "-F", "-e", query, "--", scope])
    if result.returncode not in {0, 1}:
        return [], "unknown"
    rows: list[tuple[str, int, str]] = []
    for raw in result.stdout.splitlines():
        parts = raw.split(":", 2)
        if len(parts) != 3:
            continue
        path, line, text = parts
        try:
            line_number = int(line)
        except ValueError:
            continue
        rows.append((path.replace("\\", "/"), line_number, text[:500]))
        if len(rows) >= 500:
            return rows, "truncated"
    completeness = "unknown" if len(result.stdout) >= 99_000 else "complete"
    return rows, completeness


def _path_impact(path: str) -> tuple[PlanningConfidence, PlanningConfidence, PlanningConfidence, str]:
    lowered = path.casefold()
    name = Path(lowered).name
    if any(token in lowered for token in ("/test", "/tests", "e2e", ".spec.", ".test.", "__snapshots__", "fixture")):
        return "high", "medium", "high", "exact_literal_in_test_or_fixture"
    if lowered.startswith(("src/", "app/", "apps/", "packages/")):
        return "high", "medium", "high", "exact_literal_in_source"
    if name.endswith((".md", ".rst", ".txt")) or lowered.startswith("docs/"):
        return "low", "low", "medium", "exact_literal_in_documentation"
    if "migration" in lowered:
        return "medium", "medium", "medium", "exact_literal_in_migration"
    return "medium", "medium", "medium", "exact_literal_reference"


def build_inspection_bundle(
    spec: AgentRunSpec,
    revision: TaskRevision,
    *,
    queries: Sequence[str] = (),
    paths: Sequence[str] = (),
) -> tuple[list[InspectionEvidence], list[ImpactCandidate], list[str]]:
    workspace = spec.workspace
    if workspace is None:
        return [], [], derive_planning_lenses(revision)
    authority = WorkspaceAuthority(
        workspace.worktree or workspace.root,
        allowed_paths=list(workspace.allowed_paths),
        forbidden_paths=list(workspace.forbidden_paths),
    )
    search_queries: list[str] = []
    for query in [*extract_change_literals(revision), *queries]:
        value = str(query or "").strip()
        if len(value) >= 2 and value not in search_queries:
            search_queries.append(value)
    scopes = [_scope_value(authority, path) for path in paths] if paths else ["."]
    evidence: list[InspectionEvidence] = []
    candidates: list[ImpactCandidate] = []
    for query in search_queries[:16]:
        for scope in scopes[:16]:
            rows, completeness = _git_grep(authority, query, scope)
            observation_id = _stable_digest({
                "run_id": spec.run_id,
                "task_revision_id": revision.revision_id,
                "kind": "search_observation",
                "query": query,
                "scope": scope,
            })
            observation_excerpt = "\n".join(
                f"{path}:{line}:{text}" for path, line, text in rows[:8]
            )
            evidence.append(InspectionEvidence(
                evidence_id=observation_id,
                run_id=spec.run_id,
                task_revision_id=revision.revision_id,
                kind="search_observation",
                query=query,
                bounded_excerpt=observation_excerpt[:4000],
                evidence_confidence="high",
                relation_strength="medium",
                completeness=completeness,  # type: ignore[arg-type]
                observed_result_count=len(rows),
                reported_total_count=None,
                search_scope=scope,
                result_digest=_stable_digest(rows),
            ))
            grouped: dict[str, list[tuple[int, str]]] = defaultdict(list)
            for path, line, text in rows:
                grouped[path].append((line, text))
            for path, matches in sorted(grouped.items()):
                locations = [line for line, _ in matches]
                excerpts = "\n".join(f"{line}:{text}" for line, text in matches[:8])
                evidence_id = _stable_digest({
                    "run_id": spec.run_id,
                    "task_revision_id": revision.revision_id,
                    "query": query,
                    "scope": scope,
                    "path": path,
                    "locations": locations,
                })
                evidence_item = InspectionEvidence(
                    evidence_id=evidence_id,
                    run_id=spec.run_id,
                    task_revision_id=revision.revision_id,
                    kind="exact_literal_match",
                    path=path,
                    query=query,
                    locations=locations,
                    bounded_excerpt=excerpts[:4000],
                    evidence_confidence="high",
                    relation_strength="high",
                    completeness=completeness,  # type: ignore[arg-type]
                    observed_result_count=len(matches),
                    reported_total_count=None,
                    search_scope=scope,
                    result_digest=_stable_digest(matches),
                )
                impact, uncertainty, relation_strength, relation = _path_impact(path)
                candidate_id = _stable_digest({
                    "evidence_id": evidence_id,
                    "relation": relation,
                    "path": path,
                    "query": query,
                })
                evidence.append(evidence_item)
                candidates.append(ImpactCandidate(
                    candidate_id=candidate_id,
                    run_id=spec.run_id,
                    task_revision_id=revision.revision_id,
                    path=path,
                    relation=relation,
                    query=query,
                    evidence_ids=[evidence_id],
                    evidence_confidence="high",
                    impact_likelihood=impact,
                    semantic_uncertainty=uncertainty,
                    relation_strength=relation_strength,
                ))
    return evidence, candidates, derive_planning_lenses(revision)


def inspection_evidence_digest(evidence: Iterable[InspectionEvidence]) -> str:
    rows = [
        {
            "evidence_id": item.evidence_id,
            "result_digest": item.result_digest,
            "completeness": item.completeness,
        }
        for item in evidence
    ]
    return _stable_digest(sorted(rows, key=lambda row: row["evidence_id"]))


def build_plan_authority(
    revision: TaskRevision,
    *,
    baseline_id: str,
    evidence: Iterable[InspectionEvidence],
    repository_guidance_digest: str | None,
) -> PlanAuthority:
    return PlanAuthority(
        engineering_contract_digest=engineering_contract_digest(revision),
        planning_baseline_id=baseline_id,
        inspection_evidence_digest=inspection_evidence_digest(evidence),
        repository_guidance_digest=repository_guidance_digest,
    )


_CONFIDENCE_SCORE = {"low": 1, "medium": 2, "high": 3}


def waiver_risk(candidate: ImpactCandidate, revision: TaskRevision) -> int:
    lenses = set(derive_planning_lenses(revision))
    task_risk = 3 if "security_authority" in lenses else 2 if lenses & {"api_contract", "persistence"} else 1
    return (
        _CONFIDENCE_SCORE[candidate.impact_likelihood]
        * task_risk
        * _CONFIDENCE_SCORE[candidate.relation_strength]
        * _CONFIDENCE_SCORE[candidate.semantic_uncertainty]
    )


def waiver_requires_critic(candidate: ImpactCandidate, revision: TaskRevision) -> bool:
    return waiver_risk(candidate, revision) >= 12


def _path_matches(pattern: str, path: str) -> bool:
    normalized_pattern = str(pattern or "").replace("\\", "/").lstrip("./")
    normalized_path = str(path or "").replace("\\", "/").lstrip("./")
    if not normalized_pattern:
        return False
    if normalized_pattern == normalized_path:
        return True
    if any(token in normalized_pattern for token in "*?["):
        return fnmatch.fnmatchcase(normalized_path, normalized_pattern)
    return normalized_path.startswith(normalized_pattern.rstrip("/") + "/")


def _plan_path_too_broad(path: str) -> bool:
    normalized = str(path or "").replace("\\", "/").strip()
    return normalized in {"", ".", "./", "*", "**", "**/*", "./**", "./**/*"}


def plan_gate_failures(
    spec: AgentRunSpec,
    revision: TaskRevision,
    submission: ImplementationPlanSubmission,
    candidates: Sequence[ImpactCandidate],
    evidence: Sequence[InspectionEvidence],
) -> list[str]:
    failures: list[str] = []
    all_requirement_ids = {item.id for item in revision.requirements}
    required_ids = {item.id for item in revision.requirements if item.required}
    plan_items = {item.id: item for item in submission.changes}
    candidate_map = {item.candidate_id: item for item in candidates}
    authoritative_validation_ids = {item.id for item in revision.validation_plan}
    custom_validation_ids = {item.id for item in submission.validations}
    validation_ids = authoritative_validation_ids | custom_validation_ids
    evidence_ids = {item.evidence_id for item in evidence}
    coverage = {item.requirement_id: item for item in submission.requirement_coverage}
    dispositions = {item.candidate_id: item for item in submission.impacts}

    for validation in submission.validations:
        if validation.id in authoritative_validation_ids:
            failures.append(f"plan_validation_shadows_authoritative:{validation.id}")
        for requirement_id in validation.requirement_ids:
            if requirement_id not in all_requirement_ids:
                failures.append(f"validation_unknown_requirement:{validation.id}:{requirement_id}")

    for item in submission.changes:
        for requirement_id in item.requirement_ids:
            if requirement_id not in all_requirement_ids:
                failures.append(f"plan_item_unknown_requirement:{item.id}:{requirement_id}")
        for candidate_id in item.candidate_ids:
            if candidate_id not in candidate_map:
                failures.append(f"plan_item_unknown_candidate:{item.id}:{candidate_id}")
        for validation_id in item.validation_ids:
            if validation_id not in validation_ids:
                failures.append(f"plan_item_unknown_validation:{item.id}:{validation_id}")
        for path in item.paths:
            if _plan_path_too_broad(path):
                failures.append(f"plan_path_too_broad:{item.id}:{path}")

    for row in submission.requirement_coverage:
        if row.requirement_id not in all_requirement_ids:
            failures.append(f"coverage_unknown_requirement:{row.requirement_id}")

    for requirement_id in sorted(required_ids):
        row = coverage.get(requirement_id)
        if row is None:
            failures.append(f"requirement_not_planned:{requirement_id}")
            continue
        if not row.plan_item_ids and not row.validation_ids:
            failures.append(f"requirement_has_no_plan_or_verification:{requirement_id}")
        for plan_item_id in row.plan_item_ids:
            if plan_item_id not in plan_items:
                failures.append(f"requirement_unknown_plan_item:{requirement_id}:{plan_item_id}")
        if not row.validation_ids:
            failures.append(f"requirement_has_no_validation:{requirement_id}")
        for validation_id in row.validation_ids:
            if validation_id not in validation_ids:
                failures.append(f"requirement_unknown_validation:{requirement_id}:{validation_id}")
            elif validation_id in custom_validation_ids:
                validation = next(item for item in submission.validations if item.id == validation_id)
                if requirement_id not in validation.requirement_ids:
                    failures.append(
                        f"requirement_validation_missing_reverse_coverage:{requirement_id}:{validation_id}"
                    )

    for disposition in submission.impacts:
        if disposition.candidate_id not in candidate_map:
            failures.append(f"impact_disposition_unknown_candidate:{disposition.candidate_id}")

    for candidate in candidates:
        high_value = candidate.impact_likelihood == "high" and candidate.relation_strength == "high"
        disposition = dispositions.get(candidate.candidate_id)
        if high_value and disposition is None:
            failures.append(f"impact_candidate_unclassified:{candidate.candidate_id}")
            continue
        if disposition is None:
            continue

        if not disposition.evidence_ids:
            failures.append(f"impact_disposition_missing_evidence:{candidate.candidate_id}")
        elif not set(disposition.evidence_ids).issubset(evidence_ids):
            failures.append(f"impact_disposition_unknown_evidence:{candidate.candidate_id}")
        if not set(candidate.evidence_ids).issubset(set(disposition.evidence_ids)):
            failures.append(f"impact_disposition_missing_candidate_evidence:{candidate.candidate_id}")

        linked_items = [
            item for item in submission.changes
            if candidate.candidate_id in item.candidate_ids
        ]
        if disposition.disposition == "modify":
            if not linked_items:
                failures.append(f"impact_modify_not_linked_to_plan_item:{candidate.candidate_id}")
            elif not any(
                _path_matches(path, candidate.path)
                for item in linked_items
                for path in item.paths
            ):
                failures.append(f"impact_modify_path_not_planned:{candidate.candidate_id}:{candidate.path}")
        elif disposition.disposition == "verify":
            if not str(disposition.invariant or "").strip():
                failures.append(f"impact_verify_missing_invariant:{candidate.candidate_id}")
            if high_value and waiver_requires_critic(candidate, revision):
                failures.append(f"semantic_waiver_requires_critic:{candidate.candidate_id}")
        else:
            if not disposition.reason.strip():
                failures.append(f"impact_not_impacted_missing_reason:{candidate.candidate_id}")
            if waiver_requires_critic(candidate, revision):
                if not disposition.waiver_proof_ids:
                    failures.append(f"high_risk_waiver_missing_proof:{candidate.candidate_id}")
                elif not set(disposition.waiver_proof_ids).issubset(evidence_ids):
                    failures.append(f"high_risk_waiver_unknown_proof:{candidate.candidate_id}")
                failures.append(f"semantic_waiver_requires_critic:{candidate.candidate_id}")

        if high_value:
            for evidence_id in candidate.evidence_ids:
                item = next((row for row in evidence if row.evidence_id == evidence_id), None)
                if item is not None and item.completeness != "complete":
                    failures.append(f"inspection_evidence_incomplete:{evidence_id}")

    for hypothesis in submission.causal_hypotheses:
        if not set(hypothesis.evidence_ids).issubset(evidence_ids):
            failures.append("causal_hypothesis_unknown_evidence")

    if submission.blockers:
        failures.extend(f"plan_blocker:{index + 1}" for index, _ in enumerate(submission.blockers))

    if "bugfix" in derive_planning_lenses(revision) and not submission.causal_hypotheses:
        failures.append("bugfix_causal_hypothesis_missing")

    workspace = spec.workspace
    if workspace is not None:
        authority = WorkspaceAuthority(
            workspace.worktree or workspace.root,
            allowed_paths=list(workspace.allowed_paths),
            forbidden_paths=list(workspace.forbidden_paths),
        )
        for item in submission.changes:
            for path in item.paths:
                try:
                    authority.resolve_path(path)
                except WorkspacePolicyError:
                    failures.append(f"plan_path_outside_workspace:{item.id}:{path}")

    return list(dict.fromkeys(failures))


def classify_operation_effect(tool_name: str, *, command: str = "") -> OperationEffect:
    tool = str(tool_name or "").strip().casefold()
    normalized = str(command or "").strip().casefold()
    if tool in {"read", "grep", "find", "ls"}:
        return "read"
    if tool in {"edit", "write"}:
        return "mutate"
    if tool not in {"bash", "powershell"}:
        return "unknown"
    if _NPM_MUTATING.match(normalized):
        return "mutate"
    if _MUTATING_COMMAND.search(normalized):
        return "mutate"
    if any(normalized == prefix or normalized.startswith(prefix + " ") for prefix in _READ_COMMANDS):
        return "read"
    if _NPM_VALIDATE.match(normalized):
        return "validate"
    if any(normalized == prefix or normalized.startswith(prefix + " ") for prefix in _VALIDATE_COMMANDS):
        return "validate"
    return "unknown"


def planned_paths(plan: ImplementationPlanRevision) -> list[str]:
    return list(dict.fromkeys(
        path.replace("\\", "/")
        for item in plan.changes
        for path in item.paths
        if str(path).strip()
    ))


def command_target_paths(command: str) -> list[str]:
    try:
        tokens = shlex.split(command, posix=os.name != "nt")
    except ValueError:
        tokens = command.split()
    output: list[str] = []
    for token in tokens[1:]:
        value = token.strip("'\"")
        if not value or value.startswith("-"):
            continue
        normalized = value.replace("\\", "/")
        if "/" in normalized or normalized.startswith("."):
            output.append(normalized)
    return output


def operation_plan_failures(
    plan: ImplementationPlanRevision | None,
    revision: TaskRevision,
    *,
    effect: OperationEffect,
    target_path: str | None = None,
    command: str = "",
    current_evidence_digest: str | None = None,
    quality_stage: dict[str, object] | None = None,
) -> list[str]:
    if effect in {"read", "validate"}:
        return []
    if plan is None:
        return ["approved_plan_missing"]
    failures: list[str] = []
    if plan.status != "approved":
        failures.append(f"plan_not_approved:{plan.status}")
    if plan.task_revision_id != revision.revision_id:
        failures.append("plan_task_revision_stale")
    if plan.authority.engineering_contract_digest != engineering_contract_digest(revision):
        failures.append("plan_engineering_contract_stale")
    if current_evidence_digest is not None and plan.authority.inspection_evidence_digest != current_evidence_digest:
        failures.append("plan_inspection_evidence_stale")
    if quality_stage:
        stage_name = str(quality_stage.get("stage") or "")
        stage_started = quality_stage.get("stage_started_at")
        if stage_started is not None and plan.created_at < stage_started:
            if stage_name == "repairing":
                failures.append("repair_requires_plan_delta")
            elif stage_name == "validating" and effect in {"mutate", "unknown"}:
                failures.append("validation_failure_mutation_requires_plan_delta")

    if effect in {"mutate", "unknown"}:
        if target_path:
            if not any(_path_matches(path, target_path) for path in planned_paths(plan)):
                failures.append(f"mutation_not_in_plan:{target_path}")
        elif command:
            normalized = command.casefold()
            target_paths = command_target_paths(command)
            for target in target_paths:
                if not any(_path_matches(path, target) for path in planned_paths(plan)):
                    failures.append(f"mutation_not_in_plan:{target}")
            explicit = any(
                effect in item.allowed_effects
                and any(normalized.startswith(hint.casefold()) for hint in item.command_hints)
                for item in plan.changes
            )
            path_referenced = any(path.casefold() in normalized for path in planned_paths(plan))
            if not explicit and not path_referenced:
                failures.append(f"{effect}_command_not_in_plan")
        else:
            failures.append(f"{effect}_operation_not_in_plan")
    return list(dict.fromkeys(failures))


def plan_conformance_failures(
    spec: AgentRunSpec,
    plan: ImplementationPlanRevision,
    candidates: Sequence[ImpactCandidate],
) -> list[str]:
    workspace = spec.workspace
    if workspace is None:
        return ["planning_workspace_unavailable"]
    authority = WorkspaceAuthority(
        workspace.worktree or workspace.root,
        allowed_paths=list(workspace.allowed_paths),
        forbidden_paths=list(workspace.forbidden_paths),
    )
    provenance = authority.provenance_snapshot()
    baseline = dict(plan.baseline_provenance)
    if str(provenance.get("head") or "") != str(baseline.get("head") or ""):
        return ["planning_base_commit_changed"]

    baseline_dirty = {str(item).replace("\\", "/") for item in baseline.get("dirty_paths", []) or []}
    baseline_dirty_digests = {
        str(path).replace("\\", "/"): str(digest)
        for path, digest in dict(baseline.get("dirty_digests", {}) or {}).items()
    }
    current_dirty = {str(item).replace("\\", "/") for item in provenance.get("dirty_paths", []) or []}
    run_owned = current_dirty - baseline_dirty
    patterns = planned_paths(plan)
    failures: list[str] = []

    for path in authority.baseline_conflicts(baseline_dirty_digests):
        failures.append(f"preexisting_dirty_path_modified:{path}")
    for path in sorted(run_owned):
        if not any(_path_matches(pattern, path) for pattern in patterns):
            failures.append(f"unplanned_modified_path:{path}")

    candidate_map = {item.candidate_id: item for item in candidates}
    for disposition in plan.impacts:
        candidate = candidate_map.get(disposition.candidate_id)
        if candidate is None or disposition.disposition != "modify":
            continue
        if candidate.path in baseline_dirty_digests:
            if authority.file_digest(candidate.path) == baseline_dirty_digests[candidate.path]:
                failures.append(f"planned_impact_not_modified:{candidate.candidate_id}:{candidate.path}")
                continue
        elif candidate.path not in current_dirty:
            failures.append(f"planned_impact_not_modified:{candidate.candidate_id}:{candidate.path}")
            continue
        if candidate.query:
            rows, completeness = _git_grep(authority, candidate.query, candidate.path)
            if rows and completeness in {"complete", "truncated"}:
                failures.append(f"residual_impacted_reference:{candidate.candidate_id}:{candidate.path}")

    return list(dict.fromkeys(failures))
