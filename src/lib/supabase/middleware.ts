import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const localeMatch = request.nextUrl.pathname.match(/^\/(en|tr)(\/|$)/);
  if (localeMatch) {
    requestHeaders.set('x-locale', localeMatch[1]);
  }

  let supabaseResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-key",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathnameWithoutLocale = request.nextUrl.pathname.replace(/^\/(en|tr)/, '');

  const isAppRoute = pathnameWithoutLocale.startsWith("/app");
  const isAuthRoute = pathnameWithoutLocale.startsWith("/auth");

  const matchedLocale = requestHeaders.get('x-locale') || 'en';

  if (isAppRoute && !user) {
    const loginUrl = new URL(`/${matchedLocale}/auth/login`, request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL(`/${matchedLocale}/app`, request.url));
  }

  return supabaseResponse;
}
