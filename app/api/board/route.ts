import {
  connectProvider,
  createItem,
  createList,
  deleteItem,
  deleteList,
  disbandGroup,
  disconnectProvider,
  getBoard,
  getCommandDb,
  mergeItems,
  reorderLists,
  requireOwnerId,
  syncNotion,
  unlinkFromGroup,
  updateBoardItem,
  updateList,
  updateVisibility,
} from "@/lib/server/board-store";
import { applyCommand } from "@/lib/server/commands";
import { ERROR_STATUS, isKnownCommand, type CommandEnvelope } from "@/lib/domain/contracts";
import { getFocusItems, getOrCreateCurrentPlanningPeriod, getOrCreateCurrentPlanningWeek, getPeriodProgress, getWeekProgress } from "@/lib/server/queries";
import type { EditableChanges, EditableList, HomeVisibility } from "@/lib/board-types";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const status = message === "AUTH_REQUIRED" ? 401 : 400;
  return Response.json(
    { error: message === "AUTH_REQUIRED" ? "Sign in to open your board." : message },
    { status },
  );
}

/**
 * Phase 3 slice 2 (+ the Today/Month/Year extension): focus/weekly/period-progress data,
 * additive alongside the legacy `getBoard()` payload - never replacing it (roadmap: "GET
 * /api/board returns the current compatible payload plus ... capability flags").
 * `getOrCreateCurrentPlanningWeek`/`getOrCreateCurrentPlanningPeriod` are GET-triggered writes,
 * same precedent as `getBoard()`'s own lazy backfills (idempotent, additive, not a domain
 * mutation worth gating on POST).
 */
async function getFocusAndWeekProgress(ownerId: string) {
  const db = getCommandDb();
  const [focus, week, today, month, year] = await Promise.all([
    getFocusItems(db, ownerId),
    getOrCreateCurrentPlanningWeek(db, ownerId),
    getOrCreateCurrentPlanningPeriod(db, ownerId, "day"),
    getOrCreateCurrentPlanningPeriod(db, ownerId, "month"),
    getOrCreateCurrentPlanningPeriod(db, ownerId, "year"),
  ]);
  const [weekProgress, todayProgress, monthProgress, yearProgress] = await Promise.all([
    getWeekProgress(db, ownerId, week),
    getPeriodProgress(db, ownerId, today),
    getPeriodProgress(db, ownerId, month),
    getPeriodProgress(db, ownerId, year),
  ]);
  return { focus, weekProgress, todayProgress, monthProgress, yearProgress };
}

export async function GET() {
  try {
    const ownerId = await requireOwnerId();
    const [board, extra] = await Promise.all([getBoard(ownerId), getFocusAndWeekProgress(ownerId)]);
    return Response.json({ ...board, ...extra });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await requireOwnerId();
    const body = await request.json() as {
      action?: string;
      id?: string;
      title?: string;
      name?: string;
      type?: string;
      changes?: EditableChanges;
      listChanges?: EditableList;
      provider?: "notion";
      token?: string;
      targetId?: string;
      orderedIds?: string[];
      pin?: { id: string; pinned: boolean };
      visibility?: Partial<HomeVisibility>;
      // Phase 3 slice 2 (+ Today/Month/Year extension): the new versioned command envelope
      // (roadmap section 7), used so far only for focus.*/week.*/period.* - the commands exempt
      // from the d1_primary gate (see lib/server/commands.ts's requiresD1Primary). items./lists.
      // stay on the legacy actions above until the phase 4 cutover; this isn't a second,
      // competing write path for those.
      apiVersion?: 1;
      requestId?: string;
      expectedBoardRevision?: number;
      payload?: unknown;
    };

    if (body.apiVersion === 1 && typeof body.requestId === "string" && typeof body.action === "string" && isKnownCommand(body.action) && (body.action.startsWith("focus.") || body.action.startsWith("week.") || body.action.startsWith("period."))) {
      const envelope: CommandEnvelope = {
        apiVersion: 1,
        requestId: body.requestId,
        expectedBoardRevision: body.expectedBoardRevision,
        action: body.action,
        payload: body.payload,
      };
      const result = await applyCommand(getCommandDb(), ownerId, envelope);
      if (!result.ok) {
        return Response.json({ error: result.error.message, command: result }, { status: ERROR_STATUS[result.error.code] });
      }
      const extra = await getFocusAndWeekProgress(ownerId);
      return Response.json({ command: result, ...extra });
    }

    if (body.action === "create") {
      return Response.json({ item: await createItem(ownerId, body.title || "") }, { status: 201 });
    }
    if (body.action === "update" && body.id && body.changes) {
      return Response.json(await updateBoardItem(ownerId, body.id, body.changes));
    }
    if (body.action === "delete_item" && body.id) {
      return Response.json(await deleteItem(ownerId, body.id));
    }
    if (body.action === "list_create") {
      return Response.json({ list: await createList(ownerId, { name: body.name || "", type: body.type }) }, { status: 201 });
    }
    if (body.action === "list_update" && body.id && body.listChanges) {
      return Response.json({ list: await updateList(ownerId, body.id, body.listChanges) });
    }
    if (body.action === "list_delete" && body.id) {
      return Response.json(await deleteList(ownerId, body.id));
    }
    if (body.action === "list_reorder" && body.orderedIds) {
      return Response.json(await reorderLists(ownerId, body.orderedIds, body.pin));
    }
    if (body.action === "merge_items" && body.id && body.targetId) {
      return Response.json(await mergeItems(ownerId, body.id, body.targetId));
    }
    if (body.action === "unlink_item" && body.id) {
      return Response.json(await unlinkFromGroup(ownerId, body.id));
    }
    if (body.action === "disband_group" && body.id) {
      return Response.json(await disbandGroup(ownerId, body.id));
    }
    if (body.action === "connect" && body.provider) {
      return Response.json(await connectProvider(ownerId, body.provider, body.token || ""));
    }
    if (body.action === "disconnect" && body.provider) {
      return Response.json(await disconnectProvider(ownerId, body.provider));
    }
    if (body.action === "sync_notion") {
      return Response.json(await syncNotion(ownerId));
    }
    if (body.action === "set_visibility" && body.visibility) {
      return Response.json({ visibility: await updateVisibility(ownerId, body.visibility) });
    }
    return Response.json({ error: "Unknown board action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
