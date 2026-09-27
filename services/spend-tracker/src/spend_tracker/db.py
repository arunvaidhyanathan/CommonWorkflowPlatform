"""Connection pool and a minimal forward-only migration runner.

Migrations are the numbered .sql files in ``migrations/``, applied in order
once each and recorded in ``schema_migrations``. Never edit an applied file;
add a new one.
"""

from importlib import resources

from psycopg_pool import AsyncConnectionPool


async def open_pool(database_url: str) -> AsyncConnectionPool:
    pool = AsyncConnectionPool(database_url, min_size=1, max_size=5, open=False)
    await pool.open(wait=True, timeout=30)
    return pool


async def migrate(pool: AsyncConnectionPool) -> list[str]:
    files = sorted(
        (f for f in resources.files("spend_tracker").joinpath("migrations").iterdir() if f.name.endswith(".sql")),
        key=lambda f: f.name,
    )
    applied_now = []
    async with pool.connection() as conn:
        # Serialize concurrent starts (e.g. two replicas) on one lock.
        await conn.execute("select pg_advisory_lock(727001)")
        try:
            await conn.execute(
                "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
            )
            done = {row[0] for row in await (await conn.execute("select name from schema_migrations")).fetchall()}
            for f in files:
                if f.name in done:
                    continue
                async with conn.transaction():
                    await conn.execute(f.read_text())
                    await conn.execute("insert into schema_migrations (name) values (%s)", (f.name,))
                applied_now.append(f.name)
        finally:
            await conn.execute("select pg_advisory_unlock(727001)")
    return applied_now
