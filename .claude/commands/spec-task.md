---
description: Implement the next (or a named) task from a Kiro spec's tasks.md
argument-hint: <phase-dir-or-number> [task-number]
---

Implement one task from a Kiro spec. Arguments: `$ARGUMENTS`

1. Resolve the phase: the first argument is a directory under `.kiro/specs/`
   or a phase number (`6` → `phase-6-*`).
2. Read the phase's `requirements.md`, `design.md` and `tasks.md`. If
   `design.md` or `tasks.md` is missing, stop and suggest `/spec-plan`.
3. Pick the task: the number given, or otherwise the first `- [ ]` task.
   Re-read the requirement IDs on its `_Requirements:_` line.
4. Implement exactly that task, following `.kiro/steering/`. Stay inside its
   scope. If the design turns out to be wrong for the code as it is, say so
   and propose an amendment to `design.md` instead of silently diverging.
5. Verify with `npm run lint && npm run typecheck && npm test`, or with
   `npm run verify` when the task touches the build, e2e flows or native
   modules.
6. Only once verification passes: tick the task (`- [x]`) in `tasks.md` and
   update `docs/progress-mindmap.svg` per `progress-tracking.md`. If the phase
   is now complete, update its row in `.kiro/specs/README.md`.
7. Report what changed, the verification output and the next task. Do not
   commit unless asked.
