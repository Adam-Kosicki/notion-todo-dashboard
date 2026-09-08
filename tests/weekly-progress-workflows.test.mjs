// Phase 3 completion batch: real component-interaction coverage for weekly-progress.tsx's two
// new completion-batch behaviors - the optional withdrawal reason (rendered as an explicit
// "Deferred: ..." label) and the prior-weeks history selector. Same jsdom + Vite ssrLoadModule +
// @testing-library/react pattern tests/board-workflows.test.mjs established for bulk-actions.tsx.
import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { installDom } from "./helpers/dom.mjs";

const uninstallDom = installDom();

const { render, screen, cleanup, within } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { default: React } = await import("react");

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
  uninstallDom();
});

afterEach(() => {
  cleanup();
});

async function loadWeeklyProgress() {
  const mod = await vite.ssrLoadModule("/components/board/weekly-progress.tsx");
  return mod.WeeklyProgress;
}

function baseWeekProgress(overrides = {}) {
  return {
    weekId: "week_2026-09-07",
    startDate: "2026-09-07",
    timezone: "America/Chicago",
    status: "open",
    stats: { status: "computed", totalCommitments: 1, taskCommitments: 1, completed: 0, added: 1, withdrawn: 0, lateCompletions: 0, goalMilestonesCompleted: 0, completionRatioLabel: "0/1" },
    commitments: [{ itemId: "zz-item-1", title: "Zz Test task", itemType: "Task", status: "Not started", withdrawnAt: null, withdrawalReason: null }],
    ...overrides,
  };
}

test("a withdrawn commitment with a reason renders as an explicit 'Deferred: ...' label, not a bare 'Withdrawn'", async () => {
  const WeeklyProgress = await loadWeeklyProgress();
  const weekProgress = baseWeekProgress({
    commitments: [{ itemId: "zz-item-1", title: "Zz Test task", itemType: "Task", status: "Not started", withdrawnAt: "2026-09-08T00:00:00.000Z", withdrawalReason: "waiting on a reply" }],
  });

  render(React.createElement(WeeklyProgress, {
    weekProgress,
    items: [],
    onCommit: async () => {},
    onWithdraw: async () => {},
    onClose: async () => {},
  }));

  assert.match(screen.getByText("Deferred: waiting on a reply").textContent, /Deferred: waiting on a reply/);
  assert.equal(screen.queryByText("Withdrawn"), null);
});

test("a withdrawn commitment with NO reason still renders the plain 'Withdrawn' label", async () => {
  const WeeklyProgress = await loadWeeklyProgress();
  const weekProgress = baseWeekProgress({
    commitments: [{ itemId: "zz-item-1", title: "Zz Test task", itemType: "Task", status: "Not started", withdrawnAt: "2026-09-08T00:00:00.000Z", withdrawalReason: null }],
  });

  render(React.createElement(WeeklyProgress, {
    weekProgress,
    items: [],
    onCommit: async () => {},
    onWithdraw: async () => {},
    onClose: async () => {},
  }));

  assert.match(screen.getByText("Withdrawn").textContent, /Withdrawn/);
});

test("clicking withdraw prompts for an optional reason and passes the trimmed text to onWithdraw", async () => {
  const WeeklyProgress = await loadWeeklyProgress();
  const withdrawn = [];
  const user = userEvent.setup();
  const originalPrompt = window.prompt;
  window.prompt = () => "  no longer relevant  ";

  try {
    render(React.createElement(WeeklyProgress, {
      weekProgress: baseWeekProgress(),
      items: [],
      onCommit: async () => {},
      onWithdraw: async (itemId, reason) => { withdrawn.push({ itemId, reason }); },
      onClose: async () => {},
    }));

    await user.click(screen.getByRole("button", { name: "Withdraw Zz Test task from this week" }));
    assert.deepEqual(withdrawn, [{ itemId: "zz-item-1", reason: "no longer relevant" }]);
  } finally {
    window.prompt = originalPrompt;
  }
});

test("cancelling the withdraw-reason prompt (null) aborts the withdrawal entirely - onWithdraw never fires", async () => {
  const WeeklyProgress = await loadWeeklyProgress();
  const withdrawn = [];
  const user = userEvent.setup();
  const originalPrompt = window.prompt;
  window.prompt = () => null;

  try {
    render(React.createElement(WeeklyProgress, {
      weekProgress: baseWeekProgress(),
      items: [],
      onCommit: async () => {},
      onWithdraw: async (itemId, reason) => { withdrawn.push({ itemId, reason }); },
      onClose: async () => {},
    }));

    await user.click(screen.getByRole("button", { name: "Withdraw Zz Test task from this week" }));
    assert.deepEqual(withdrawn, [], "clicking Cancel on the prompt must not withdraw at all");
  } finally {
    window.prompt = originalPrompt;
  }
});

test("an empty (blank OK) reason still withdraws, just with no reason recorded", async () => {
  const WeeklyProgress = await loadWeeklyProgress();
  const withdrawn = [];
  const user = userEvent.setup();
  const originalPrompt = window.prompt;
  window.prompt = () => "";

  try {
    render(React.createElement(WeeklyProgress, {
      weekProgress: baseWeekProgress(),
      items: [],
      onCommit: async () => {},
      onWithdraw: async (itemId, reason) => { withdrawn.push({ itemId, reason }); },
      onClose: async () => {},
    }));

    await user.click(screen.getByRole("button", { name: "Withdraw Zz Test task from this week" }));
    assert.deepEqual(withdrawn, [{ itemId: "zz-item-1", reason: undefined }]);
  } finally {
    window.prompt = originalPrompt;
  }
});

test("the prior-weeks history selector: opening it loads the list, and picking a week calls onSelectWeek with its id", async () => {
  const WeeklyProgress = await loadWeeklyProgress();
  let loadCount = 0;
  const selected = [];
  const user = userEvent.setup();

  const { rerender } = render(React.createElement(WeeklyProgress, {
    weekProgress: baseWeekProgress(),
    items: [],
    onCommit: async () => {},
    onWithdraw: async () => {},
    onClose: async () => {},
    pastWeeks: undefined,
    selectedWeekId: null,
    onSelectWeek: (weekId) => selected.push(weekId),
    onLoadPastWeeks: () => { loadCount++; },
  }));

  await user.click(screen.getByRole("button", { name: /Prior weeks/ }));
  assert.equal(loadCount, 1, "opening the history selector must trigger a (lazy) load");
  assert.match(screen.getByText("Loading...").textContent, /Loading/);

  const pastWeeks = [
    { id: "week_2026-09-07", start_date: "2026-09-07", timezone: "America/Chicago", status: "open" },
    { id: "week_2026-08-31", start_date: "2026-08-31", timezone: "America/Chicago", status: "closed" },
  ];
  rerender(React.createElement(WeeklyProgress, {
    weekProgress: baseWeekProgress(),
    items: [],
    onCommit: async () => {},
    onWithdraw: async () => {},
    onClose: async () => {},
    pastWeeks,
    selectedWeekId: null,
    onSelectWeek: (weekId) => selected.push(weekId),
    onLoadPastWeeks: () => { loadCount++; },
  }));

  const select = screen.getByRole("combobox", { name: "Select a prior week to view" });
  const closedOption = within(select).getByText(/closed/);
  await user.selectOptions(select, closedOption);
  assert.deepEqual(selected, ["week_2026-08-31"]);
});
