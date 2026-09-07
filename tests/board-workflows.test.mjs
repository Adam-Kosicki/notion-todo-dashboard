// Phase 2 follow-up: real component-interaction tests, filling the gap flagged in the Phase 2
// handoff (no jsdom/testing-library existed, so bulk-action behavior could only be verified
// manually). Reuses the Vite SSR pipeline already established by tests/ui-components.test.mjs
// (ssrLoadModule handles .tsx, JSX, and the "@/" alias exactly like the real dev server), adding
// only a jsdom global environment on top so the components can actually mount and receive real
// user-event clicks/selections instead of just producing static markup.
import assert from "node:assert/strict";
import test, { after, afterEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { installDom } from "./helpers/dom.mjs";

const uninstallDom = installDom();

const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
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

async function loadBulkActionBar() {
  const mod = await vite.ssrLoadModule("/components/board/bulk-actions.tsx");
  return mod.BulkActionBar;
}

test("BulkActionBar: move action previews and applies with the chosen list, then clears selection", async () => {
  const BulkActionBar = await loadBulkActionBar();
  const applied = [];
  let cleared = false;
  const user = userEvent.setup();

  render(
    React.createElement(BulkActionBar, {
      count: 2,
      collections: ["Groceries", "Wish List"],
      onApply: async (changes) => {
        applied.push(changes);
        return { applied: 2, failed: 0 };
      },
      onClear: () => {
        cleared = true;
      },
    }),
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Choose bulk action" }), "move");
  await user.selectOptions(screen.getByRole("combobox", { name: "Target list" }), "Groceries");

  assert.match(screen.getByText(/Move 2 items to Groceries/).textContent, /Move 2 items to Groceries/);

  await user.click(screen.getByRole("button", { name: "Apply" }));

  assert.deepEqual(applied, [{ collection: "Groceries" }]);
  assert.equal(cleared, true, "onClear should fire once every selected item succeeds");
  assert.match(screen.getByText(/Applied to all 2\./).textContent, /Applied to all 2\./);
});

test("BulkActionBar: type action forces priority 0 for non-Task types", async () => {
  const BulkActionBar = await loadBulkActionBar();
  const applied = [];
  const user = userEvent.setup();

  render(
    React.createElement(BulkActionBar, {
      count: 3,
      collections: [],
      onApply: async (changes) => {
        applied.push(changes);
        return { applied: 3, failed: 0 };
      },
      onClear: () => {},
    }),
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Choose bulk action" }), "type");
  await user.selectOptions(screen.getByRole("combobox", { name: "Target item type" }), "Goal");
  await user.click(screen.getByRole("button", { name: "Apply" }));

  assert.deepEqual(applied, [{ itemType: "Goal", priority: 0 }]);
});

test("BulkActionBar: a partial failure keeps the selection and reports the split instead of clearing", async () => {
  const BulkActionBar = await loadBulkActionBar();
  let cleared = false;
  const user = userEvent.setup();

  render(
    React.createElement(BulkActionBar, {
      count: 2,
      collections: [],
      onApply: async () => ({ applied: 1, failed: 1 }),
      onClear: () => {
        cleared = true;
      },
    }),
  );

  await user.selectOptions(screen.getByRole("combobox", { name: "Choose bulk action" }), "priority");
  fireEvent.change(screen.getByRole("slider", { name: "Target importance" }), { target: { value: "8" } });
  await user.click(screen.getByRole("button", { name: "Apply" }));

  assert.equal(cleared, false, "a partial failure must not clear the selection - the user needs to retry");
  assert.match(
    screen.getByText(/Applied to 1, 1 failed/).textContent,
    /Applied to 1, 1 failed - selection kept so you can retry\./,
  );
  assert.equal(screen.getByRole("combobox", { name: "Choose bulk action" }).value, "priority", "action stays selected so Apply can be retried");
});
