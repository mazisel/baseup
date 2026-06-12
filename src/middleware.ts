import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const locales = ['en', 'tr'];
const defaultLocale = 'en';
const cookieName = 'supaops_locale';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const pathnameHasLocaleMatch = pathname.match(/^\/(en|tr)(\/|$)/);

  if (!pathnameHasLocaleMatch) {
    const cookieLocale = request.cookies.get(cookieName)?.value;
    const locale = (cookieLocale && locales.includes(cookieLocale)) ? cookieLocale : defaultLocale;
    request.nextUrl.pathname = `/${locale}${pathname}`;
    return NextResponse.redirect(request.nextUrl);
  }

  // Locale is valid in URL, proceed with Supabase auth logic
  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api).*)',
  ],
};
