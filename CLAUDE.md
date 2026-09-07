@AGENTS.md

# Claude Code-specific instructions

The shared repository instructions are defined in `AGENTS.md`.
Do not duplicate general repository, Git, privacy, testing, environment, or data-safety rules here.

## Communication

Before sending a final response, use `/unslop` when available.

## Browser access (Claude in Chrome)

Live UI verification against `http://localhost:5174/` requires the session to have been
started with `claude --chrome` (confirmed via `claude --help`: `--chrome` enables the
integration, `--no-chrome` disables it). Started without that flag, the
`mcp__claude-in-chrome__*` tools are simply absent from the tool list for the rest of that
session — there is no way to enable them mid-session.

If a task calls for live browser verification and those tools aren't available, don't assume
browser automation is unsupported in this project: check whether the session was started
without `--chrome`, and if so, tell Adam to relaunch Claude Code with `claude --chrome` from
this directory.

## Burner Board roadmap implementation

When explicitly asked to work from `docs/plans/burner-board-roadmap.md`:

- Read the roadmap and relevant repository documentation before implementing.
- Implement only the currently authorized phase or coherent slice.
- Do not begin later phases merely because they appear in the roadmap.
- Make routine, reversible engineering decisions yourself.
- Resolve questions from repository evidence when possible.
- Continue independent work when one portion is blocked.
- Stop only for material architecture, product, authorization, destructive-operation,
  credential, billing, production-data, or other owner-decision gates.

At each phase or slice handoff, report:

- phase/slice completed
- files changed
- migrations
- verification commands and actual results
- manual verification
- unresolved issues
- rollback implications
- exact next unblocked action

## Claude subagents

Use project subagents only when their specialized role is useful.

`.claude/agents/documentation-agent.md` maintains `docs/ARCHITECTURE.md`
and `CONTEXT.md`.

Do not spawn subagents reflexively for work that can be completed directly.

When using a subagent:

- give it a bounded task;
- avoid duplicating work already being performed by the main session;
- review its result before relying on it;
- keep durable implementation decisions in repository files rather than only in chat history.

## Astra / Claude handoff

Claude Code is normally the implementation agent for the Burner Board roadmap.
GPT-6 Astra may act as architecture/review after a completed phase or coherent slice.

Before handing work back for review:

- leave the repository in a reviewable state;
- preserve existing unrelated work;
- commit implementation in sensible feature/slice commits when practical;
- record actual verification results;
- surface only genuinely unresolved questions or risks.

Do not require Astra to reconstruct implementation details from Claude's chat history.
The repository, roadmap, commits, and handoff summary should contain the durable evidence.