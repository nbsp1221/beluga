---
name: frontend-ui-workflow
description: Build or review frontend UI and interactions by studying a reference product, mapping its details to the project's design system, and comparing the rendered result.
---

# Frontend UI workflow

Read the project's UI guidance and the design system for the affected surface. Use the reference the user names. Otherwise choose one established product with a comparable user task and surface. Use another reference only for a specific gap and record what it supports.

1. **Observe.** Perform the task in the reference when accessible. Record the version, screen, input state, and interaction path. Capture component roles, placement, visibility before and after interaction, dimensions, spacing, alignment, typography, and color roles. Use source to confirm details. Mark anything unverified.
2. **Map and set acceptance criteria.** For each material decision, link the observation to the local component or token, any visible difference, and a pass/fail check. State where content appears, when it appears, what must stay absent, and what the interaction opens. Preserve information hierarchy and component semantics, including text selection for readable content. Small fixes can use a few lines in the existing task notes. If evidence is missing or a departure or exception is needed, explain the trade-off, ask asynchronously, and wait before editing that part.
3. **Implement and verify.** Before editing, confirm the criteria can be met with the available data and components. Return changed criteria to step 2. Implement with local components, tokens, and architecture. Use reference code, styles, and assets as evidence. Run the agreed checks in the browser with comparable content and states, including affected neighboring interactions, viewport sizes, themes, and keyboard paths. For reported regressions, confirm the check detects the old failure where reproducible. Record pass, fail, or unverified with evidence for each material criterion. Keep visual and interaction checks distinct from build and unit checks.
