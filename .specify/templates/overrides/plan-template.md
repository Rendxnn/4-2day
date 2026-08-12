# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command.

## Summary

[Primary requirement and the simplest safe technical approach]

## Current-State Evidence

<!-- Cite the files, symbols, tests, migrations, and dated external checks inspected. Explain the
current control/data flow and distinguish evidence from inference. -->

| Evidence | Current responsibility or behavior | Relevance |
| --- | --- | --- |
| `[real/path:line or symbol]` | [Verified behavior] | [Why it must change or remain] |

## Technical Context

**Language/Version**: [TypeScript/Node/Worker versions or NEEDS CLARIFICATION]

**Primary Dependencies**: [Existing dependencies; justify any addition]

**Storage**: [Supabase/Postgres/Storage or N/A]

**Testing**: [Existing runner, affected suites, and required new evidence]

**Target Platform**: [Cloudflare Workers/browser or N/A]

**Project Type**: [ParaHoy pnpm/Turborepo web application]

**Performance Goals**: [Measurable goal or N/A with reason]

**Constraints**: [Tenant, security, idempotency, AI, compatibility, and operational constraints]

**Scale/Scope**: [Affected modules, tenants, routes, and user journeys]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Evaluate every applicable constitutional principle plus `AGENTS.md`, `ARCHITECTURE.md`,
`CODESTYLE.md`, and `TESTING.md`. Any exception requires owner, reason, and removal condition in
Complexity Tracking.]

## Target Architecture and Responsibilities *(mandatory)*

### Resulting Flow

```text
[Concrete future control/data flow after implementation]
```

### Responsibility Changes

| Boundary or component | Current owner | Resulting owner | Reason |
| --- | --- | --- | --- |
| [Responsibility] | [Current location] | [Target location] | [Why] |

### Contracts and Data

- **Contracts/APIs/events**: [Added, changed, preserved, or N/A]
- **Prompts/controlled actions**: [Added, changed, preserved, or N/A]
- **Data/migrations**: [Schema, RLS, grants, tenant rollout, rollback, or N/A]
- **Compatibility**: [Backward compatibility and transition strategy]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── spec.md
├── plan.md
├── research.md          # when technical uncertainty requires it
├── data-model.md        # when data changes
├── quickstart.md        # verification and review path
├── contracts/           # when interfaces change
└── tasks.md             # created by $speckit-tasks
```

### Target Source Tree *(mandatory)*

<!-- Show only concrete repository paths. Mark each path as ADD, MODIFY, MOVE, or REMOVE and include
tests beside the behavior they verify. This is the expected repository shape after implementation. -->

```text
[MODIFY] apps/api/src/features/example/example.ts
[ADD]    apps/api/test/example-behavior.test.mjs
[REMOVE] apps/api/src/legacy/example.ts
```

| Path | Change | Resulting responsibility |
| --- | --- | --- |
| `[real/path]` | ADD/MODIFY/MOVE/REMOVE | [Single clear owner] |

## Test Strategy and Traceability *(mandatory)*

| Requirement | Scenario or risk | Test level | Target file/evidence | Expected assertion |
| --- | --- | --- | --- | --- |
| FR-001 | US1.1 | Unit/Integration/UI/E2E | `[real/path]` | [Observable result] |

Describe required fakes, fixtures, regression-first sequence, focused commands, full verification, and
any manual/external checks with owner and environment. Source-inspection tests cannot be the sole
evidence for behavioral requirements.

## Delivery, Observability, and Recovery

- **Rollout**: [Order, tenant exposure, feature flag, or immediate release]
- **Observability**: [Logs, traces, metrics, alerts, and safe diagnostic context]
- **Failure containment**: [How partial mutation or unsafe state is prevented]
- **Rollback**: [Code/data/config rollback and compatibility limits]

## Complexity Tracking

> Fill only when the Constitution Check has a justified violation or the design adds material
> complexity.

| Violation or complexity | Why needed | Simpler alternative rejected because | Owner/removal condition |
| --- | --- | --- | --- |
| [Item] | [Current need] | [Evidence] | [Owner and condition] |
