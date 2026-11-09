---
description: Write design.md and tasks.md for a Kiro spec that has requirements only
argument-hint: <phase-dir-or-number>
---

Plan a phase in the Kiro spec format. Arguments: `$ARGUMENTS`

1. Resolve the phase directory under `.kiro/specs/`. Confirm that every earlier
   phase is marked complete in `.kiro/specs/README.md`. If one is not, stop:
   the specs forbid designing ahead of what has been built.
2. Read the phase's `requirements.md` (and `investigation.md` if present), the
   relevant ADRs in `docs/adr/`, and the code those requirements touch. The
   design must describe the code as it is, not as the requirements assume.
3. Write `design.md` in the style of the completed phases, for example
   `.kiro/specs/phase-5-object-point-management/design.md`. Lead with the
   invariants the work collides with and how each collision is resolved.
4. Write `tasks.md` in the format given in `.kiro/steering/agent-workflow.md`:
   numbered `- [ ]` tasks, pure and offline-testable work first, each with test
   expectations and a `_Requirements:_` line. Every requirement must be
   covered by at least one task.
5. If a decision is architectural, draft an ADR in `docs/adr/` using the next
   number, and add it to the decision index in `.kiro/specs/README.md`.
6. Add the phase's tasks to `docs/progress-mindmap.svg` as `todo`.
7. Stop after planning. Do not start implementing.
