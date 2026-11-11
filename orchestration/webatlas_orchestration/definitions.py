"""Dagster definitions for WebATLAS, first pass: every registry dataset as an observable asset.

The registry in packages/atlas-data stays the one place a dataset is defined. This code location
only reads what the registry records (app.dataset_lineage, app.dataset_stage_state) and shows it;
running builds from Dagster is the next pass.
"""

from __future__ import annotations

from datetime import datetime, timezone

import dagster as dg

from . import catalogue_sync, registry


def _observer(ds: registry.Dataset) -> dg.SourceAsset:
    @dg.observable_source_asset(
        name=registry.asset_name(ds.dataset_id),
        group_name="registry",
        description=f"{ds.statement}\n\nGiấy phép: {ds.licence}",
        metadata={"dataset_id": ds.dataset_id},
    )
    def _observe(context) -> dg.ObserveResult:
        with registry.connect() as conn:
            states = registry.stage_states(conn, ds.dataset_id)
        failed = [s.stage for s in states if s.status != "ok"]
        last = max((s.produced_at for s in states), default=None)
        context.log.info("%s: %d stages, %d failed", ds.dataset_id, len(states), len(failed))
        return dg.ObserveResult(
            data_version=dg.DataVersion(registry.data_version(states)),
            metadata={
                "stages": dg.MetadataValue.md(
                    "\n".join(f"- `{s.stage}`: {s.status} ({s.produced_at:%Y-%m-%d %H:%M})" for s in states)
                    or "_chưa chạy_"
                ),
                "failed_stages": len(failed),
                "last_produced": dg.MetadataValue.text(last.isoformat() if last else "—"),
            },
        )

    return _observe


def full_listing_due(now: datetime) -> bool:
    """
    Every 10th minute: the full listing refreshes what GeoNode's moderation changes without
    bumping last_updated (publish, unpublish, permissions), so a retracted dataset stops being
    public within 10 minutes. It also reconciles deletions (catalogue_sync._DELETE_AFTER keeps
    those about an hour apart).
    """
    return now.minute % 10 == 0


@dg.op
def sync_catalogue(context) -> None:
    """Incremental listing each minute; the full listing (which also deletes) every 10 minutes."""
    now = datetime.now(timezone.utc)
    with registry.connect() as conn:
        report = catalogue_sync.run(conn, now, full=full_listing_due(now))
    if report is None:
        context.log.warning("catalogue: another sync is running, skipped")
        return
    context.log.info("catalogue: %d inserted, %d updated, %d marked, %d removed",
                     report.inserted, report.updated, report.marked, report.removed)


@dg.job(name="dong_bo_danh_muc")
def catalogue_job():
    sync_catalogue()


def _load() -> dg.Definitions:
    with registry.connect() as conn:
        datasets = registry.list_datasets(conn)
    observers = [_observer(ds) for ds in datasets]
    observe_job = dg.define_asset_job("quan_sat_dang_ky", selection=dg.AssetSelection.groups("registry"))
    return dg.Definitions(
        assets=observers,
        jobs=[observe_job, catalogue_job],
        schedules=[
            dg.ScheduleDefinition(
                job=observe_job,
                cron_schedule="*/15 * * * *",
                default_status=dg.DefaultScheduleStatus.STOPPED,
            ),
            dg.ScheduleDefinition(
                job=catalogue_job,
                cron_schedule="* * * * *",
                default_status=dg.DefaultScheduleStatus.RUNNING,
            ),
        ],
    )


defs = _load()
