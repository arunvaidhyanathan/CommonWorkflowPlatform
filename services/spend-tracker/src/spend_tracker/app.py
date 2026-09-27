"""HTTP service. Users reach it through the edge gateway at /api/spend/**;
services post usage events to POST /events on the internal network (the
gateway refuses that path)."""

import asyncio
import contextlib
import logging
import os
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request

from . import store
from .auth import JwtVerifier, Viewer, ingest_caller, platform_admin, spend_viewer
from .db import migrate, open_pool
from .keys import KEYS, check_key

log = logging.getLogger("spend_tracker")
MAX_RANGE = timedelta(days=366)


async def run_key_checks(app: FastAPI) -> list[dict]:
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(check_key(client, spec, app.state.key_env) for spec in KEYS))
    for r in results:
        await store.record_check(app.state.pool, r.key_alias, r.provider, r.status, r.http_status, r.detail)
    log.info("key checks: %s", ", ".join(f"{r.key_alias}={r.status}" for r in results))
    return [{"keyAlias": r.key_alias, "status": r.status} for r in results]


def create_app(
    database_url: str | None = None,
    verifier=None,
    ingest_token: str | None = None,
    admin_user_ids: set[str] | None = None,
    key_env: dict[str, str] | None = None,
    check_interval_s: int | None = None,
) -> FastAPI:
    database_url = database_url or os.environ["SPEND_DATABASE_URL"]
    interval = check_interval_s if check_interval_s is not None else int(os.environ.get("SPEND_KEY_CHECK_INTERVAL_S", "3600"))

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.pool = await open_pool(database_url)
        applied = await migrate(app.state.pool)
        if applied:
            log.info("applied migrations: %s", applied)

        async def periodic_checks():
            while True:
                try:
                    await run_key_checks(app)
                except Exception:
                    log.exception("key checks failed")
                await asyncio.sleep(interval)

        task = asyncio.create_task(periodic_checks()) if interval > 0 else None
        try:
            yield
        finally:
            if task:
                task.cancel()
            await app.state.pool.close()

    app = FastAPI(title="CWP Spend Tracker", lifespan=lifespan)
    app.state.verifier = verifier or JwtVerifier(os.environ["SUPABASE_JWKS_URL"])
    app.state.ingest_token = ingest_token if ingest_token is not None else os.environ.get("SPEND_INGEST_TOKEN", "")
    app.state.admin_user_ids = admin_user_ids if admin_user_ids is not None else {
        u.strip() for u in os.environ.get("SPEND_ADMIN_USER_IDS", "").split(",") if u.strip()
    }
    # Only the keys the tracker checks, never the whole environment.
    app.state.key_env = key_env if key_env is not None else {
        spec.key_alias: os.environ[spec.key_alias] for spec in KEYS if os.environ.get(spec.key_alias)
    }
    if not app.state.ingest_token:
        log.warning("SPEND_INGEST_TOKEN is not set; POST /events will refuse everything.")

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok"}

    @app.post("/events", status_code=204, dependencies=[Depends(ingest_caller)])
    async def ingest(event: store.UsageEventIn, request: Request) -> None:
        await store.insert_event(request.app.state.pool, event)

    @app.get("/summary")
    async def summary(
        request: Request,
        viewer: Viewer = Depends(spend_viewer),
        start: datetime | None = Query(default=None, alias="from"),
        end: datetime | None = Query(default=None, alias="to"),
        scope: str = Query(default="auto", pattern="^(auto|platform|tenant)$"),
    ) -> dict:
        now = datetime.now(UTC)
        start = _utc(start) if start else now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end = _utc(end) if end else now + timedelta(seconds=1)
        if end <= start or end - start > MAX_RANGE:
            raise HTTPException(422, "Range must be positive and at most 366 days.")

        if scope == "platform" and not viewer.platform_admin:
            raise HTTPException(403, "Only platform admins can see platform-wide spend.")
        platform = viewer.platform_admin and scope != "tenant"
        if not platform and not viewer.tenant_id:
            raise HTTPException(403, "Account has no tenant.")
        return await store.summary(request.app.state.pool, start, end, None if platform else viewer.tenant_id)

    @app.get("/keys", dependencies=[Depends(platform_admin)])
    async def keys(request: Request) -> list[dict]:
        return await store.key_status(request.app.state.pool)

    @app.post("/keys/check", dependencies=[Depends(platform_admin)])
    async def keys_check(request: Request) -> list[dict]:
        return await run_key_checks(request.app)

    return app


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


logging.basicConfig(level=logging.INFO)
