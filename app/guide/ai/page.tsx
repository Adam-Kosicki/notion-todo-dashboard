import Link from "next/link";

export const dynamic = "force-dynamic";

// Phase 2 (docs/plans/burner-board-roadmap.md): a preliminary Guide/AI Setup page explaining
// the COMING connection workflow. Nothing here is interactive or claims a live connection -
// there is no MCP server, no OAuth, no Claude/ChatGPT connector yet (that's phase 4). Showing a
// fake "Connect" button before any of that exists would violate the roadmap's own instruction
// ("clearly label unavailable connection features; do not show fake success states"), so this
// page is deliberately read-only until there's something real to wire up.
export default function AiSetupGuide() {
  return (
    <main className="guide-page">
      <div className="guide-shell">
        <Link href="/" className="guide-back">&larr; Back to your board</Link>
        <header className="guide-header">
          <span className="guide-eyebrow">AI Setup Guide</span>
          <h1>Using Claude or ChatGPT with Burner Board</h1>
          <p>
            This page will become the real setup flow once AI connections exist. Right now it
            explains what&rsquo;s planned, so nothing here is a surprise later and nothing here
            claims to work before it actually does.
          </p>
        </header>

        <section className="guide-status">
          <span className="guide-status-badge">Not available yet</span>
          <p>
            There is no working Claude or ChatGPT connection today &mdash; no server to connect
            to, no button that does anything real. The rest of this page describes what&rsquo;s
            coming, not what you can use right now.
          </p>
        </section>

        <section className="guide-section">
          <h2>What&rsquo;s planned</h2>
          <ul>
            <li>
              <strong>Your subscription, not a paid API.</strong> Claude and ChatGPT will talk
              to Burner Board through a custom MCP server, using your existing ChatGPT Plus or
              Claude subscription &mdash; no separate API billing.
            </li>
            <li>
              <strong>You choose what AI can see.</strong> AI will only work from a batch of
              tasks or goals you explicitly select, never your entire board at once.
            </li>
            <li>
              <strong>AI proposes, you approve.</strong> Suggested changes show up here for
              review before anything is applied &mdash; AI won&rsquo;t silently rewrite your
              tasks.
            </li>
            <li>
              <strong>Switch clients freely.</strong> Start a plan in Claude, continue it in
              ChatGPT (or the other way around) without losing context &mdash; the stored plan
              lives here, not in either client&rsquo;s chat history.
            </li>
          </ul>
        </section>

        <section className="guide-section">
          <h2>Where this is tracked</h2>
          <p>
            The full design is written up in this project&rsquo;s own planning documents:{" "}
            <code>docs/adr/0003-deferred-questions-for-astra.md</code> (topic 10) for the
            product vision, and <code>docs/plans/burner-board-roadmap.md</code> (phase 4) for
            the implementation plan. This page will be rebuilt with real setup steps, a
            connection test, and revoke controls once that phase ships.
          </p>
        </section>
      </div>
    </main>
  );
}
