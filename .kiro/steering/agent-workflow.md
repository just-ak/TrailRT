# Agent workflow

This repository is worked on by both Kiro and Claude Code. They share one set of
rules and one set of specs, and neither tool keeps private instructions.

## Single source of truth

| What | Where | Read by |
| --- | --- | --- |
| Always-applied rules | `.kiro/steering/*.md` | Kiro directly; Claude via `@` imports in `CLAUDE.md` |
| Phase specs | `.kiro/specs/<phase>/` | Both |
| Decisions | `docs/adr/` | Both |
| Progress | `docs/progress-mindmap.svg` | Both |

To add or change a rule, edit or add a file in `.kiro/steering/`. Do not put
project rules in `CLAUDE.md`, because Kiro never reads it. If you add a new
steering file, also add an `@` import for it in `CLAUDE.md`, or Claude will not
see it.

## Spec-driven development

Each phase lives in `.kiro/specs/phase-N-<slug>/` and moves through three
documents, in order:

1. `requirements.md` — numbered requirements (`1.1`, `1.2`, …) with acceptance
   criteria.
2. `design.md` — how the requirements are met, written against the code as it
   actually is.
3. `tasks.md` — an ordered checklist that implements the design.

Do not write a phase's design or tasks until the previous phase is built and
tested (see `.kiro/specs/README.md`). Phases with requirements only are
deliberately unplanned.

## Task format

Keep `tasks.md` in the format Kiro parses, so either tool can pick up where the
other left off:

```markdown
- [ ] 3. Short task title
  - Concrete sub-step naming the file or module
  - Unit tests: what they prove
  - _Requirements: 1.2, 4.1_
```

- `- [ ]` not started, `- [x]` done. Number tasks sequentially and do not
  renumber completed ones.
- Every task ends with a `_Requirements: …_` line that traces back to
  `requirements.md`.
- Tick a task only once it is verified, meaning `npm run verify` passes or the
  behaviour is confirmed. Written code alone is not verified. In the same
  change, update `docs/progress-mindmap.svg` (see `progress-tracking.md`).
- Work on one task at a time and in order, unless the tasks file says
  otherwise.

## Verification

```sh
npm run lint && npm run typecheck && npm test   # fast loop
npm run verify                                  # full gate incl. build + e2e
```
