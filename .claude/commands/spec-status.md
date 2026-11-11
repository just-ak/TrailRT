---
description: Summarise progress across all Kiro specs in .kiro/specs
allowed-tools: Read, Bash(grep:*), Bash(ls:*)
---

Report the implementation status of every phase in `.kiro/specs/`.

For each `phase-*` directory:

- list which of `requirements.md`, `design.md` and `tasks.md` exist
- if `tasks.md` exists, count `- [x]` against total top-level tasks and name the
  next unchecked task

Then compare the result with the status table in `.kiro/specs/README.md` and the
`data-status` attributes in `docs/progress-mindmap.svg`, and flag any place
where they disagree. Do not edit anything. This command only reports.
