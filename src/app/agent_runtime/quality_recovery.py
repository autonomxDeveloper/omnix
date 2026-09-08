"""Crash-safe reconciliation for the durable independent-review stage.

Reviewer reconciliation is intentionally broader than orphan recovery now. Every
supervisor pass may inspect review-stage parents because review attempt/result
identity is deterministic and idempotent. This closes both crash windows and the
normal runtime/protocol retry path without teaching a failed first edit or a dead
reviewer how to recover.
"""
from __future__ import annotations

from typing import Any

from app.persistence.unit_of_work import unit_of_work

from .repository import PostgresAgentRunRepository
from .review_orchestration import reconcile_review_progress_in_repository


def orphaned_quality_review_run_ids(connection: Any, workspace_id: str) -> list[str]:
    """Return every runnable parent currently waiting in independent review.

    The historical name is retained for compatibility. Reconciliation is safe
    for parents with healthy leases too; limiting this query to expired leases
    would delay normal reviewer-runtime retries until an unrelated worker lease
    expired.
    """

    rows = connection.execute(
        """
        SELECT run.run_id
          FROM omnix_agent_runs AS run
          JOIN omnix_agent_coding_quality_state AS quality
            ON quality.workspace_id = run.workspace_id
           AND quality.run_id = run.run_id
         WHERE run.workspace_id = %s
           AND run.status = 'waiting_for_children'
           AND run.desired_state = 'running'
           AND quality.stage = 'reviewing'
         ORDER BY run.created_at, run.run_id
        """,
        (workspace_id,),
    ).fetchall()
    return [str(row[0]) for row in rows]


def reconcile_orphaned_quality_reviews(service: Any) -> list[str]:
    """Consume terminal reviewer attempts and launch deterministic retries.

    Runtime/protocol failures remain ReviewAttempt evidence and never consume an
    implementation quality attempt. Substantive review findings are reconciled by
    the shared orchestration helper and may request the normal repair loop.
    """

    with unit_of_work(service.database) as work:
        run_ids = orphaned_quality_review_run_ids(
            work.connection,
            service.context.workspace_id,
        )
        work.rollback()

    reconciled: list[str] = []
    launch_actions: list[tuple[str, str, int]] = []
    for run_id in run_ids:
        with unit_of_work(service.database) as work:
            locked = work.connection.execute(
                """
                SELECT run_id
                  FROM omnix_agent_runs
                 WHERE workspace_id = %s AND run_id = %s
                 FOR UPDATE
                """,
                (service.context.workspace_id, run_id),
            ).fetchone()
            if locked is None:
                work.rollback()
                continue
            repository = PostgresAgentRunRepository(work.connection, service.context)
            action = reconcile_review_progress_in_repository(
                service,
                repository,
                run_id,
            )
            latest = repository.get_run(run_id)
            work.commit()
        reconciled.append(run_id)
        if action is not None and action[0] == "launch_reviews":
            launch_actions.append((run_id, str(action[1]), int(action[2])))
        # A substantive review finding may have queued the durable repair outbox.
        # Dispatch only after releasing the parent row lock/transaction.
        try:
            service._dispatch_pending_quality_commands(run_id)
        except Exception:
            pass
        if latest is not None and latest.status in {"failed", "cancelled", "completed"}:
            try:
                service._close_terminal_runtime(run_id)
            except Exception:
                pass

    for parent_run_id, snapshot_id, count in launch_actions:
        service._launch_reviewer_children(parent_run_id, snapshot_id, count)
    return reconciled
