import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./helpers/ts-loader.mjs", import.meta.url);
const { resolveOwnerId } = await import("@/lib/server/identity-resolver");

function headersFrom(map) {
  return (name) => map[name] ?? null;
}

test("oai-authenticated-user-id wins when present, case preserved", () => {
  const id = resolveOwnerId(headersFrom({
    "oai-authenticated-user-id": "User-123",
    "oai-authenticated-user-email": "someone@example.com",
    "cf-access-authenticated-user-email": "other@example.com",
  }));
  assert.equal(id, "User-123");
});

test("oai-authenticated-user-email is used when no id header, lowercased", () => {
  const id = resolveOwnerId(headersFrom({
    "oai-authenticated-user-email": "Someone@Example.com",
    "cf-access-authenticated-user-email": "other@example.com",
  }));
  assert.equal(id, "someone@example.com");
});

test("cf-access-authenticated-user-email is the last-resort fallback, lowercased", () => {
  const id = resolveOwnerId(headersFrom({ "cf-access-authenticated-user-email": "Owner@Example.com" }));
  assert.equal(id, "owner@example.com");
});

test("returns null, never throws, when no trusted header is present", () => {
  assert.equal(resolveOwnerId(headersFrom({})), null);
  assert.equal(resolveOwnerId(headersFrom({ "x-forwarded-for": "1.2.3.4" })), null);
});

test("a client-supplied header with a different name never substitutes for a trusted one", () => {
  // Guards the actual security property: only these three exact header names are ever trusted.
  const id = resolveOwnerId(headersFrom({ "x-oai-authenticated-user-id": "attacker", "user-id": "attacker" }));
  assert.equal(id, null);
});
