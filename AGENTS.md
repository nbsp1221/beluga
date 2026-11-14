# Working on Beluga

Beluga is an independent, plugin-composed agent harness inspired by DSH. Keep changes small and preserve approved behavior. Read the relevant documents below before changing their area; do not load every document for every task.

## Read by task

- Product scope or priorities: [product](docs/product.md) and [roadmap](docs/roadmap.md).
- Packages, services, plugin registration or Host transport: [architecture](docs/architecture.md).
- UI, theme, responsive layout or interactions: [design system](docs/design-system.md), including its scoped extension register.
- Changing an architectural choice: the relevant [decision record](docs/decisions/).
- Writing or deleting documentation: [documentation policy](docs/README.md).
- Product setup: [README](README.md). Source builds and checks: [development](docs/development.md). Scripts and manifests are authoritative for executable commands and versions.

## Engineering boundaries

- Apps assemble plugins. Keep feature state and commands out of the shell and shared UI; respect the dependency directions in the architecture document.
- Prefer existing libraries and public APIs. Do not introduce speculative abstractions, external plugin installation or another state/slot framework without a concrete requirement.
- Do not copy DSH, Codex or derivative product implementation/style/assets into Beluga. Their source and rendered behavior are reference evidence. Official shadcn generation is an authorized reuse path; preserve third-party notices.
- Keep sample adapters explicit in code. Do not fabricate model reasoning, tool activity, permission enforcement or persistence.

## UI changes

- Start with the configured official shadcn preset. Check semantic theme values, then public props/composition, before considering an extension. Moving an override does not remove it.
- Do not add tokens, modify primitive internals or introduce style overrides without evidence and user agreement. Existing scoped approvals are in the design system; they do not authorize unrelated changes.
- Before implementing UI/UX for any feature, verify the placement, interaction and relevant states against an established product's rendered UI or source. Record the exact reference and what it supports. A feature match alone does not justify a control or its placement.
- If a UI decision lacks reference evidence, ask the user asynchronously and wait for their answer before implementing that part. For a new exception or visible departure, explain the result, alternatives, scope, maintenance and accessibility costs in plain language and get agreement first. A request to research is not implementation approval.
- Preserve approved design through rendered checks, including light/dark, responsive layouts, keyboard focus and open/close state. Official components or a successful build alone do not establish correct product UX.
- Record each replacement's official component, removed custom behavior and unresolved differences in review evidence. Keep only durable rules in project docs.

## Verification and documentation

- Run checks appropriate to the change. Before heavy verification, check for an existing run and avoid overlapping whole suites. Preserve user servers, tabs and other tasks' resources.
- Refresh Beluga's local development preview after code changes unless the user asks to skip it. Reuse the current preview URL and verify that it serves the updated build. Development preview databases do not require a backup.
- Report what was actually checked and its limits. Do not promote historical test results into current verification or certify physical-device/accessibility behavior from viewport emulation.
- Update the owning document with related code changes. Put current rules, decision rationale and future work in their respective homes; do not append contradictory corrections or task diaries.
- Before deleting untracked material, preserve it outside the repository and verify the copy. Extract decisions, scope and unresolved risks before removing redundant reports.
- Do not stage or commit unless explicitly requested.
