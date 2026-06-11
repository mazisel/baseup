import { cookies } from "next/headers";
import {
  LOCALE_COOKIE,
  normalizeLocale,
  normalizeTheme,
  THEME_COOKIE
} from "@/lib/preference-shared";

export async function getPreferences() {
  const cookieStore = await cookies();

  return {
    locale: normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value),
    theme: normalizeTheme(cookieStore.get(THEME_COOKIE)?.value)
  };
}
