# CLAUDE.md

This project is shared with Kiro. **`.kiro/` is the source of truth.** This file
only imports it, so keep project rules in `.kiro/steering/`, not here.

## Steering (always applied)

@.kiro/steering/agent-workflow.md
@.kiro/steering/architecture.md
@.kiro/steering/toolchain.md
@.kiro/steering/licensing.md
@.kiro/steering/progress-tracking.md

## Specs

@.kiro/specs/README.md

Load a phase's `requirements.md`, `design.md` and `tasks.md` from
`.kiro/specs/<phase>/` when working on that phase. They are not imported here
because they are large and only one phase is active at a time.

Slash commands that follow the Kiro spec workflow:

- `/spec-status` — progress across every phase
- `/spec-task <phase> [task-number]` — implement the next (or a named) task
- `/spec-plan <phase>` — write `design.md` and `tasks.md` for a phase that has
  requirements only
