export type Locale = "tr" | "en";
export type Theme = "light" | "dark";

export const LOCALE_COOKIE = "supaops_locale";
export const THEME_COOKIE = "supaops_theme";

export function normalizeLocale(value?: string | null): Locale {
  return value === "tr" ? "tr" : "en";
}

export function normalizeTheme(value?: string | null): Theme {
  return value === "dark" ? "dark" : "light";
}

// Tarayıcıda (ör. error boundary gibi prop alamayan client bileşenlerde)
// dil tercihini cookie'den okur; sunucuda çağrılırsa varsayılana düşer.
export function getClientLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  return normalizeLocale(match ? decodeURIComponent(match[1]) : null);
}
