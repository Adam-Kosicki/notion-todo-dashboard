// Phase 1 (docs/plans/burner-board-roadmap.md): read paths for the new d1_primary tables.
// Deliberately minimal this phase - History, cursor pagination, and scoped-context queries
// belong to phases 2-4 as their UI/MCP consumers land. Same runtime-agnostic Database
// dependency-injection pattern as repository.ts/commands.ts - see repository.ts's file comment.
import { getBoardState, type Database, type ItemRow, type ListRow } from "@/lib/server/repository";

export type BoardSnapshot = {
  revision: number;
  storageMode: string;
  items: ItemRow[];
  lists: ListRow[];
};

/** Full current-state snapshot for a d1_primary owner. Not paginated - fine for tests and small synthetic boards; a real cursor-paginated version arrives in phase 2 alongside History. */
export async function getBoardSnapshot(db: Database, ownerId: string): Promise<BoardSnapshot> {
  const state = await getBoardState(db, ownerId);
  const items = await db
    .prepare("SELECT * FROM items WHERE owner_id = ? AND deleted_at IS NULL ORDER BY recorded_at")
    .bind(ownerId)
    .all<ItemRow>();
  const lists = await db
    .prepare("SELECT owner_id, id, name FROM lists WHERE owner_id = ? ORDER BY name COLLATE NOCASE")
    .bind(ownerId)
    .all<ListRow>();
  return { revision: state.revision, storageMode: state.storageMode, items: items.results, lists: lists.results };
}
