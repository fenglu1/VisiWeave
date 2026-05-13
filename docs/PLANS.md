# Planning Guide

Use this when writing product specs, execution plans, Ralph PRDs, or multi-story implementation plans for this repository.

## Where Plans Live

- Product specs live in `docs/product-specs/`.
- Active execution plans live in `docs/exec-plans/active/`.
- Completed execution plans live in `docs/exec-plans/completed/`.
- Shared tech debt lives in `docs/exec-plans/tech-debt-tracker.md`.
- Ralph PRDs live in `.agents/tasks/`.
- Ralph runtime state lives in `.ralph/` and must not be committed.

## Planning Standard

A useful plan should be decision complete enough for another engineer or agent to implement without inventing product behavior. Include:

- Goal and user value.
- In-scope and out-of-scope behavior.
- Affected apps or packages: `apps/api`, `apps/web`, `packages/shared`.
- Public interfaces: API routes, shared types, DB schema, WebSocket events, or UI-visible behavior.
- Error and empty states.
- Security and privacy considerations.
- Verification commands and browser checks.

Keep implementation detail proportional to risk. Small docs or copy changes need a compact plan. Cross-cutting changes touching shared contracts, SQLite, Agent execution, or provider selection need more detail.

## Story Acceptance Criteria

Each story should have acceptance criteria covering:

- Functional behavior.
- Negative cases and failure handling.
- Data persistence or migration impact, if any.
- UI behavior on desktop and mobile when `apps/web` changes.
- Security and privacy when secrets, local data, OAuth tokens, generated images, or provider configs are involved.
- Verification: `pnpm typecheck`, `pnpm build`, and browser verification for UI stories.

## Ralph Compatibility

Read `docs/ralph-execution.md` before creating or running Ralph tasks. Ralph stories should be small, independently verifiable, and able to complete with a clean commit.

When invoking Ralph on Windows, prefer:

```powershell
$env:PRD_PATH = ".agents/tasks/prd-example.json"
& "C:\Program Files\Git\bin\bash.exe" ".agents/ralph/loop.sh" build 2
Remove-Item Env:\PRD_PATH
```

Do not store durable PRDs in `.ralph/`. Keep extra wrapper logs in `.codex-temp/`.

## Plan Review Checklist

- Does the plan name the exact workflows it changes?
- Does it avoid duplicating source-of-truth docs or code comments?
- Does it state whether `packages/shared` contracts change?
- Does it state whether SQLite schema or runtime data changes?
- Does it state whether browser verification is required?
- Does it preserve secret handling rules from `docs/SECURITY.md`?

