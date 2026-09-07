// Phase 1 (docs/plans/burner-board-roadmap.md): the validated principal -> existing owner
// mapping. For now this is exactly board-store.ts's prior requireOwnerId() logic, moved here
// so a future MCP-authenticated principal (phase 4) has one place to converge with the browser
// path, rather than a second copy of this logic. See docs/operations/data-recovery.md's
// "Identity and request authentication" section for what is and isn't verified about the edge
// that's supposed to sit in front of this.
//
// The actual header-precedence decision lives in identity-resolver.ts (zero imports, testable
// under plain `node --test` - see tests/identity.test.mjs). This file is just the thin
// framework-calling wrapper around it.
import "server-only";
import { headers } from "next/headers";
import { resolveOwnerId } from "@/lib/server/identity-resolver";

export { resolveOwnerId };

export async function requireOwnerId(): Promise<string> {
  const requestHeaders = await headers();
  const ownerId = resolveOwnerId((name) => requestHeaders.get(name));
  if (!ownerId) throw new Error("AUTH_REQUIRED");
  return ownerId;
}
