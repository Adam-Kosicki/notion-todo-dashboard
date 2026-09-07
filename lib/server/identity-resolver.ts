// Pure decision logic, split out of identity.ts so it's importable under plain `node --test`
// without pulling in "server-only"/"next/headers" (framework-only, unresolvable outside
// Next/vinext - the same class of problem repository.ts's file comment describes for
// "cloudflare:workers"). Zero imports, by design.

/** Given a header lookup, return the owner id, or null if none of the trusted headers are present. Never throws - callers decide what "no owner" means for their context. */
export function resolveOwnerId(getHeader: (name: string) => string | null): string | null {
  const oaiId = getHeader("oai-authenticated-user-id");
  if (oaiId) return oaiId;
  const oaiEmail = getHeader("oai-authenticated-user-email");
  if (oaiEmail) return oaiEmail.toLowerCase();
  // Cloudflare Access strips any client-supplied Cf-Access-* header at the edge and
  // only sets this one itself after a successful login to an Access-protected
  // hostname, so it's safe to trust directly at the origin without JWT verification.
  const accessEmail = getHeader("cf-access-authenticated-user-email");
  if (accessEmail) return accessEmail.toLowerCase();
  return null;
}
