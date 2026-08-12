---

description: "Dependency-ordered ParaHoy feature implementation tasks"
---

# Tasks: [FEATURE NAME]

**Input**: Approved artifacts from `/specs/[###-feature-name]/`

**Prerequisites**: `spec.md`, `plan.md`, reviewed requirements checklist, and any applicable
`research.md`, `data-model.md`, `contracts/`, or `quickstart.md`

**Tests**: Tests are MANDATORY. Every functional requirement and regression must map to an executable
test or an explicitly approved manual/external verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: safe to run in parallel because files and dependencies do not conflict
- **[Story]**: owning user story (`US1`, `US2`, etc.); setup/final tasks omit it
- Every task names exact repository paths, dependencies when non-obvious, and an observable result
- Each requirement ID appears in its test and implementation tasks for traceability

## Phase 1: Setup and Characterization

**Purpose**: Confirm the baseline and prepare the smallest safe implementation surface.

- [ ] T001 Verify current behavior and referenced paths from `plan.md`
- [ ] T002 Add or identify regression/characterization evidence required before implementation
- [ ] T003 Prepare fixtures, fakes, contracts, or migration prerequisites without changing behavior

**Verification**: [Focused baseline command and expected result]

**Checkpoint**: Baseline evidence and prerequisites are reviewable; create a focused Conventional
Commit if this phase changed versioned files.

---

## Phase 2: Foundational Changes

**Purpose**: Implement blocking contracts, domain rules, migrations, or shared infrastructure.

- [ ] T004 [P] Implement [foundation] in `[exact/path]` for [requirement IDs]
- [ ] T005 [P] Add behavioral tests in `[exact/test/path]` for [requirement IDs]
- [ ] T006 Run focused tests, typecheck, and affected build; record results

**Checkpoint**: Foundational behavior is verified and committed before user-story phases begin.

---

## Phase 3: User Story 1 - [Title] (Priority: P1)

**Goal**: [Observable value delivered]

**Independent Test**: [How the story is proven independently]

### Tests for User Story 1

> Add behavioral tests before or alongside implementation and confirm regression tests fail for the
> expected reason before the fix when reasonably possible.

- [ ] T007 [P] [US1] Add [test level] coverage in `[exact/test/path]` for [FR/NFR IDs]
- [ ] T008 [P] [US1] Add boundary/failure coverage in `[exact/test/path]` for [EC/NFR IDs]

### Implementation for User Story 1

- [ ] T009 [US1] Implement [behavior] in `[exact/source/path]` for [FR IDs]
- [ ] T010 [US1] Update contracts/data/observability in `[exact/path]` for [FR/NFR IDs]
- [ ] T011 [US1] Run focused tests, typecheck, and affected build; record results
- [ ] T012 [US1] Update affected durable documentation in `[exact/doc/path]`

**Checkpoint**: User Story 1 is independently functional, verified, documented, and committed with a
focused Conventional Commit.

---

[Add one equivalent phase per additional user story in priority and dependency order. Do not retain
sample tasks or invent stories that are absent from the approved specification.]

---

## Final Phase: Cross-Cutting Verification and Convergence Readiness

- [ ] TXXX Validate requirement-to-test traceability against `spec.md` and `plan.md`
- [ ] TXXX Run `pnpm test` from the repository root
- [ ] TXXX Run `pnpm typecheck` from the repository root
- [ ] TXXX Run `pnpm build` from the repository root
- [ ] TXXX Execute required manual/external smoke checks from `quickstart.md` with dated evidence
- [ ] TXXX Update `docs/current-status.md` and other durable documentation for shipped behavior
- [ ] TXXX Review changed code against `CODESTYLE.md` and document any scoped exception
- [ ] TXXX Review the complete diff for secrets, tenant isolation, compatibility, and unrelated changes
- [ ] TXXX Create the final focused Conventional Commit for verified cross-cutting work

**Checkpoint**: All tasks and checks are complete; proceed to `$speckit-converge` and implement any
tasks it appends before declaring the feature done.

## Dependencies and Execution Order

- Setup/characterization precedes behavior changes.
- Foundational work blocks every story that consumes it.
- A user-story phase begins only when its dependencies pass verification.
- Tests belong to and complete with their owning phase, not a postponed test phase.
- Tasks marked `[P]` may run concurrently only when they do not edit the same files or depend on
  unfinished outputs.
- Each phase ends with verification before its commit and before the next dependent phase.

## Completion Rules

- Do not mark a task complete without its required file change or verification evidence.
- Do not mark blocked or skipped checks as passing.
- If implementation changes intended behavior, update and reapprove `spec.md`, then align `plan.md`
  and regenerate or revise this file before continuing.
- Keep commits phase-focused and Conventional; never commit failing or incomplete phases.
- Implementation is not complete until `$speckit-converge` reports no remaining gap.
