import { NextResponse, type NextRequest } from "next/server";

// Local-dev only: the real oai-authenticated-user-* headers are injected by
// OpenAI's Sites dispatch layer in production. Fake them here so the board
// is usable when running `npm run dev` without that layer in front of it.
const LOCAL_DEV_USER_ID = "local-dev-user";
const LOCAL_DEV_USER_EMAIL = "local-dev@example.test";

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return NextResponse.next();
  if (request.headers.get("oai-authenticated-user-id")) return NextResponse.next();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("oai-authenticated-user-id", LOCAL_DEV_USER_ID);
  requestHeaders.set("oai-authenticated-user-email", LOCAL_DEV_USER_EMAIL);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
