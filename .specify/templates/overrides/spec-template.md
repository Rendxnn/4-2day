# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[###-feature-name]`

**Created**: [DATE]

**Status**: Draft

**Input**: User description: "$ARGUMENTS"

## Context and Current Evidence *(mandatory)*

<!-- Describe the verified current behavior. Cite real repository files, tests, migrations, or dated
external evidence. Separate implemented behavior from assumptions and desired behavior. -->

- **Problem**: [What is wrong, missing, or newly required]
- **Current behavior**: [What the system demonstrably does today]
- **Evidence**: [Repository paths, tests, migrations, logs, or dated external verification]
- **Desired outcome**: [User-visible or operational result, without choosing implementation]

## Scope *(mandatory)*

### In Scope

- [Behavior or outcome included in this feature]

### Out of Scope

- [Related behavior explicitly excluded]

### Dependencies

- [Existing capability, external service, decision, or prerequisite]

## User Scenarios & Testing *(mandatory)*

<!-- Prioritize user journeys. Every story must be independently testable and must include happy,
boundary, and relevant failure scenarios. Add or remove stories as needed. -->

### User Story 1 - [Brief Title] (Priority: P1)

[Describe this user journey in plain language]

**Why this priority**: [Explain its value and priority]

**Independent Test**: [How this outcome can be verified independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [observable outcome]
2. **Given** [boundary or failure state], **When** [action], **Then** [safe outcome]

---

### User Story 2 - [Brief Title] (Priority: P2)

[Describe this user journey in plain language]

**Why this priority**: [Explain its value and priority]

**Independent Test**: [How this outcome can be verified independently]

**Acceptance Scenarios**:

1. **Given** [initial state], **When** [action], **Then** [observable outcome]

---

[Add only the stories needed by this feature]

### Edge Cases and Failure Behavior

- **EC-001**: [Boundary, malformed input, stale state, or unavailable dependency and expected result]
- **EC-002**: [Authorization, tenant, concurrency, retry, or recovery case when applicable]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST [specific, testable behavior]
- **FR-002**: System MUST [specific, testable behavior]
- **FR-003**: System MUST NOT [explicit prohibited behavior]

Unresolved requirements use `[NEEDS CLARIFICATION: precise question]` and block planning when material.

### Non-Functional Requirements

- **NFR-001**: System MUST [security, tenant isolation, observability, reliability, or performance
  requirement that is measurable or verifiable]

### Key Entities *(include when data is involved)*

- **[Entity]**: [Meaning, lifecycle, and relationship without prescribing storage implementation]

## Verification Traceability *(mandatory)*

<!-- Define required evidence without choosing exact implementation paths; the plan will assign files. -->

| Requirement | Acceptance scenarios | Required evidence |
| --- | --- | --- |
| FR-001 | US1.1 | [Behavioral unit, integration, UI, E2E, or manual evidence] |
| NFR-001 | [Scenario] | [Security, isolation, observability, or performance evidence] |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: [Technology-agnostic and measurable outcome]
- **SC-002**: [Observable quality or business outcome]

## Assumptions

- [Assumption that does not silently decide material product scope]

## Open Questions

- [Question and owner, or `None — critical ambiguities resolved on YYYY-MM-DD`]
