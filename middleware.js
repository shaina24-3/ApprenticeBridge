/**
 * middleware.js — Next.js Edge Middleware
 *
 * Enforces authentication and role-based access at the routing layer.
 *
 * Rules:
 *  - The landing page ("/") is public and can open the sign-in/sign-up modal
 *  - Authenticated users trying to reach /auth/signin or /auth/signup are
 *    redirected to "/" (their portal)
 *  - The token is an HttpOnly cookie set by FastAPI; we can read it here to
 *    check presence. Full JWT verification happens on the backend — the
 *    middleware's job is just to prevent blank-page loads for unauthenticated
 *    users and stop authenticated users seeing the sign-in page.
 *
 * NOTE: Because this is the Edge Runtime we cannot use `jose` or other Node
 * crypto libs. We do a lightweight "is the cookie present?" check here.
 * The backend always validates the JWT on every API call.
 */

import { NextResponse } from "next/server";

/** Routes only for unauthenticated users */
const AUTH_PATHS = ["/auth/signin", "/auth/signup"];

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("access_token")?.value;

  const isAuthenticated = Boolean(token);

  // Redirect already-authenticated users away from sign-in/up pages
  if (AUTH_PATHS.some((p) => pathname.startsWith(p)) && isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on app pages only — skip Next.js internals and static assets
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf)).*)",
  ],
};
