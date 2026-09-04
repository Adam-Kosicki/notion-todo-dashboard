import {
  connectProvider,
  createItem,
  createList,
  deleteList,
  disbandGroup,
  disconnectProvider,
  getBoard,
  mergeItems,
  reorderLists,
  requireOwnerId,
  syncNotion,
  unlinkFromGroup,
  updateItem,
  updateList,
} from "@/lib/server/board-store";
import type { EditableChanges, EditableList } from "@/lib/board-types";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const status = message === "AUTH_REQUIRED" ? 401 : 400;
  return Response.json(
    { error: message === "AUTH_REQUIRED" ? "Sign in to open your board." : message },
    { status },
  );
}

export async function GET() {
  try {
    const ownerId = await requireOwnerId();
    return Response.json(await getBoard(ownerId));
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
      provider?: "notion" | "todoist";
      token?: string;
      targetId?: string;
      orderedIds?: string[];
    };

    if (body.action === "create") {
      return Response.json({ item: await createItem(ownerId, body.title || "") }, { status: 201 });
    }
    if (body.action === "update" && body.id && body.changes) {
      return Response.json(await updateItem(ownerId, body.id, body.changes));
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
      return Response.json(await reorderLists(ownerId, body.orderedIds));
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
    return Response.json({ error: "Unknown board action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
