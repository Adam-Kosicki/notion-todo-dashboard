# Adam's own words

This folder holds Adam's planning/direction messages verbatim — his own wording, unedited,
not the AI's paraphrase of them. It exists so he can scroll back later and see exactly what
he asked for and how he framed it, without digging through chat history.

Nothing in this folder (besides this README) is tracked by git or pushed anywhere — see
`.gitignore` (`/docs/adr/local/*`). It's local notes only.

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
