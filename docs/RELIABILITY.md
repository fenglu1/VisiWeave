# Reliability Guide

Use this before changing API routes, provider selection, Agent execution, asset storage, SQLite behavior, Docker, or operational verification.

## Runtime Shape

- `apps/api`: Hono API, WebSocket upgrade handling, SQLite persistence, provider selection, image generation, Agent planning and execution, asset storage.
- `apps/web`: Vite React and tldraw client, served by Vite in development and by the built API app in production.
- `packages/shared`: shared contracts, image presets, validation helpers, provider types, storage types, and Agent event types.

## Persistence

`DATA_DIR` defaults to `./data` locally and `/app/data` in Docker. It contains SQLite state and generated assets. Treat it as private runtime data.

SQLite tables are defined in `apps/api/src/infrastructure/schema.ts`; keep `docs/generated/db-schema.md` updated when the schema changes.

Important persistence rules:

- Never write generated assets outside the configured data/assets path.
- Validate asset paths before reading from disk.
- Keep generation records, outputs, reference assets, and asset rows consistent.
- If changing snapshot format, preserve old project restore behavior or document migration behavior.
- Do not run local `pnpm dev` and Docker against the same `data/` directory at the same time.

## Provider Reliability

Provider source order is:

1. Environment OpenAI-compatible config.
2. Local OpenAI-compatible config stored in SQLite.
3. Codex login fallback.

Agent planning uses separate Agent LLM configuration. Do not assume the image provider and planning model are the same provider.

Provider errors should become stable API errors where possible. Avoid exposing raw secrets, raw token values, or noisy upstream internals in responses or logs.

## Image Generation

- Text-to-image and reference-image generation both persist generation records.
- Reference image inputs are size and MIME checked.
- Batch generation uses bounded concurrency.
- Individual output failures should be represented in output status instead of erasing the whole record when partial results exist.
- Generated images must remain locally available even if cloud upload fails.

## Agent Execution

Agent plans are dependency-aware DAGs. Reliability-sensitive rules:

- Plans must be validated before execution.
- Dependency source jobs used downstream must have count `1`.
- Failed jobs can be retried without rerunning successful upstream jobs.
- Cancellation should stop in-flight work where possible and leave the plan in an inspectable state.
- WebSocket events should be stable, typed through `packages/shared`, and safe for reconnect behavior.

## Cloud Backup

Tencent Cloud COS is optional. Saving COS settings performs a test upload and delete before persistence.

COS failures must not fail local image generation. Store upload status and error metadata on the asset so the UI can explain what happened.

## Docker And Build Checks

For normal stories, run:

```sh
pnpm typecheck
pnpm build
```

For browser verification, run:

```sh
pnpm dev
```

Then open `http://localhost:5173`.

For Docker config validation with real `.env` credentials, use:

```sh
docker compose config --quiet --no-env-resolution
```

Do not run plain `docker compose config` when `.env` may contain real secrets.

