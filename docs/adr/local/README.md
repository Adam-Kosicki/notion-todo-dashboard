# Adam's own words

This folder holds Adam's planning/direction messages verbatim — his own wording, unedited,
not the AI's paraphrase of them. It exists so he can scroll back later and see exactly what
he asked for and how he framed it, without digging through chat history.

Nothing in this folder is tracked by the main project repo or pushed anywhere — see
`.gitignore` (`/docs/adr/local/*`). It's local notes only, never public.

**This folder is its own separate, independent git repository** (`docs/adr/local/.git/`,
`git init`'d directly here, no remote configured — never pushed anywhere). That's deliberate:
plain gitignored files have zero protection against an accidental `git clean -fdx` in the main
repo, or general bit-rot. A real (if tiny) git history means this content can survive that:
`git clean -fd` (the common form, no `-x`) never touches this folder at all; even
`git clean -fdx -ff` (Git's own strongest override) still refuses to remove `.git/` itself —
worst case, the *working copy* of a file here could vanish, but the committed content is safe
in this repo's own history and trivially restorable:
```
cd docs/adr/local && git checkout HEAD -- .
```
**After adding or editing anything here, commit it in this nested repo too**
(`cd docs/adr/local && git add -A && git commit -m "..."`) — an uncommitted change here has
no more protection than a plain gitignored file did before.

## Convention

- One file per topic/thread, e.g. `local/create-task-view.md`, `local/list-type-rework.md`.
- Append new verbatim quotes to the matching file as the topic keeps coming up, newest at
  the bottom, each entry dated.
- Quote Adam directly — do not clean up grammar, do not summarize, do not add AI commentary
  in the same block. If context helps, add it as a separate note clearly marked as such
  (e.g. `> AI note: ...`), never blended into his words.
- These files feed the real ADRs in `docs/adr/*.md` (e.g. `0003-deferred-questions-for-astra.md`)
  — the ADRs are the polished, tracked version; this folder is the raw source material.

## Entry format

```md
## <topic/date>

> "<verbatim quote from Adam>"

(optional) > AI note: <context, not part of the quote>
```
