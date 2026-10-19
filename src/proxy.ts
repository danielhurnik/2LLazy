import { auth } from "@/auth";
import { NextResponse } from "next/server";

const LOGIN_PATH = "/login";
const HOME_PATH = "/";
const AUTH_API_PREFIX = "/api/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith(AUTH_API_PREFIX)) return NextResponse.next();

  const isLoggedIn = Boolean(req.auth);
  const isLoginPage = pathname === LOGIN_PATH;

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL(LOGIN_PATH, req.url));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL(HOME_PATH, req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/data|favicon.ico).*)"],
};
