import { getCommandDb, requireOwnerId } from "@/lib/server/board-store";
import { getPlanningWeekProgressById, listRecentPlanningWeeks } from "@/lib/server/queries";

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
 * Phase 3 completion gap: GET /api/board only ever resolves the CURRENT planning week (see
 * app/api/board/route.ts's getFocusAndWeekProgress). A prior week's frozen report survives in
 * planning_weeks but became unreachable in the browser after rollover. This sibling route is the
 * bounded, owner-scoped read path for it - `?weekId=` returns one week's full progress (live or
 * frozen), and no query returns a bounded most-recent-first list of every week for a history
 * selector to populate. Read-only: week.commit/withdraw/close on a selected week still go through
 * the existing POST /api/board versioned-command envelope, unchanged - this route only fixes what
 * the owner can SEE.
 */
export async function GET(request: Request) {
  try {
    const ownerId = await requireOwnerId();
    const db = getCommandDb();
    const weekId = new URL(request.url).searchParams.get("weekId");
    if (weekId) {
      const week = await getPlanningWeekProgressById(db, ownerId, weekId);
      if (!week) return Response.json({ error: "That planning week could not be found." }, { status: 404 });
      return Response.json({ week });
    }
    const weeks = await listRecentPlanningWeeks(db, ownerId);
    return Response.json({ weeks });
  } catch (error) {
    return errorResponse(error);
  }
}
