// Phase 1 (docs/plans/burner-board-roadmap.md): names the transitional boundary between the
// existing Notion-connected code and the new d1_primary command layer. Deliberately thin right
// now - the roadmap's target architecture calls for board-store.ts's Notion-specific functions
// (notionRequest, notionProperties, patchNotionItem, syncNotion, connectProvider, ...) to move
// here eventually, but "keep board-store.ts temporarily as a compatibility facade... do not
// split every function before delivering UI improvements" argues against doing that wholesale
// in this foundation phase, before any UI actually depends on the split. This file exists so
// the boundary has a name and a place to grow into, not as a completed extraction.
//
// The one thing this phase does need from here: a way to say "Notion access is categorically
// unavailable for this owner" once they've cut over, so a later phase can gate board-store.ts's
// legacy sync functions on it without duplicating the storage-mode check everywhere.
import type { StorageMode } from "@/lib/domain/contracts";

export function notionAccessAllowed(storageMode: StorageMode): boolean {
  return storageMode === "legacy_notion";
}
