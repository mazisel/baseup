import { cookies } from "next/headers";
import {
  LOCALE_COOKIE,
  normalizeLocale,
  normalizeTheme,
  THEME_COOKIE
} from "@/lib/preference-shared";

import { headers } from "next/headers";

export async function getPreferences() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  
  const headerLocale = headerStore.get("x-locale");
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  return {
    locale: normalizeLocale(headerLocale || cookieLocale),
    theme: normalizeTheme(cookieStore.get(THEME_COOKIE)?.value)
  };
}
