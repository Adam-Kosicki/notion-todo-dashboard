# Organizing preview

This branch adds a focused Organize tab and changes quick capture to save without opening the full editor. The capture confirmation offers Edit details, and the input keeps focus. Concurrent submissions are guarded against duplicates.

Organize defaults to open tasks without a list, with an All open tasks option. Choose a destination, optionally set a due date, then Save & next. Type, tags, and importance are in an expandable section. Skip leaves the task unchanged; Undo last restores the previous organizing fields during the current organizing session. Leaving Organize resets its temporary session history.

Suggestions are deterministic and run in the browser. They use list names, a small keyword vocabulary, and overlapping words in tasks already filed in existing lists. Completed examples are eligible; archived examples are excluded. Related examples can suggest tags, but tags are only applied when selected. Suggestions never create lists, infer importance, or move tasks without a save. No embedding model, LLM, or paid API is used. This is a baseline to evaluate before considering local semantic matching.

Date hints support today, tomorrow, and explicit valid YYYY-MM-DD dates. The original task text is preserved. Hints require a click to apply.

Try sample board appears on an empty board. Its examples and edits exist only in browser memory. Exit sample board reloads the persisted board. Sample mode cannot connect integrations or send changes to providers.

## Planning corrections

- A Task with no list, priority, due date, or scheduled date remains in Inbox, even after adding context or relationships.
- Future dated tasks appear in Longer even without a priority.
- On Sunday, This week ends that day instead of extending through the following Sunday.
- Search also checks tags and context.

## Verification and scope

Run `npm run test:organizing` for the suggestion and visibility regression tests. Run `npm run typecheck` for TypeScript. Cloudflare runtime declarations are generated in worker-configuration.d.ts using Wrangler; regenerate them when the runtime compatibility configuration changes.

This iteration focuses on capture and organization. The existing Notion/Todoist synchronization implementation remains in place. The previously identified full retry/upload gap is still separate work; this branch does not claim to repair it. The Sites preview uses its own database. It can use a server-managed Notion token and data-source ID without sending either value to the browser.

No Obsidian backend or vault access is configured. An Obsidian experiment should evaluate suggestions against manually chosen destinations before introducing another synchronization system.

## Resume checkpoint (2026-09-07)

- Feature branch: `feature/quick-capture-organize`.
- The private preview is deployed at `https://burner-board-organize.ripjaw93.chatgpt.site`.
- The hosted Notion token can read the configured items data source. The temporary connection-check route used for verification was removed before the final deployment.
- The app recognizes the server-managed token as a live connection and accepts the authenticated email header supplied by Sites.
- Open Connections and choose Sync now to import Notion items into the preview's separate database.
- Five organizing regression tests, TypeScript, and the production build pass.
- The previously noted full retry/upload gap remains separate work. No paid AI calls or Obsidian vault access are implemented.
