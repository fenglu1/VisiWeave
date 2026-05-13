# Security And Privacy Guide

Use this before changing credential handling, provider config, OAuth, cloud storage, generated assets, logs, Docker, or local runtime data.

## Security Model

`gpt-image-canvas` is designed for local workstation use. It stores project state, generated assets, generation history, provider settings, Agent LLM settings, optional COS settings, and Codex OAuth token records in local runtime data.

Do not treat the app as safe for public internet exposure without adding explicit authentication and network controls.

## Secrets

Secrets may come from:

- `.env` or runtime environment variables.
- Local provider config stored in SQLite.
- Agent LLM config stored in SQLite.
- COS `SecretId` and `SecretKey` stored in SQLite.
- Codex OAuth tokens stored in SQLite.

Rules:

- Never commit `.env`, `data/`, SQLite databases, generated images, `.ralph/`, `.codex-temp/`, or build output.
- Never log raw API keys, OAuth tokens, COS secrets, or saved provider values.
- Read APIs should return masked secrets only.
- Preserve existing secret values only when the request explicitly uses a preserve flag or leaves a masked value unchanged.
- If a real key was committed, rotate it. `.gitignore` does not remove secrets from Git history.

## Local Data

Generated images can contain private user content. Treat local assets and previews as sensitive by default.

When adding browser tests that save fake credentials, clear or restore local test configuration before finishing. Do not leave real-looking secrets in `data/`.

## API And Error Handling

- Validate JSON bodies and content types before using request data.
- Prefer stable error codes from shared contracts or API helpers.
- Do not pass raw upstream provider errors directly to clients if they may contain credentials or request internals.
- Do not expose filesystem paths, shell details, environment contents, or database internals through API responses.

## Docker

With real credentials present, validate Docker config with:

```sh
docker compose config --quiet --no-env-resolution
```

Avoid plain `docker compose config` because it can expand and print env values.

## Review Checklist

- Are all user inputs validated before storage or provider calls?
- Are secrets masked in API responses and UI?
- Are logs free of keys, tokens, request headers, and credential-bearing URLs?
- Are generated files written only under `DATA_DIR`?
- Are asset reads constrained to the expected asset directory?
- Does the change avoid exposing the local app publicly by default?

