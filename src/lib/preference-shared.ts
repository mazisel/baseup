export type Locale = "tr" | "en";
export type Theme = "light" | "dark";

export const LOCALE_COOKIE = "supaops_locale";
export const THEME_COOKIE = "supaops_theme";

export function normalizeLocale(value?: string | null): Locale {
  return value === "en" ? "en" : "tr";
}

export function normalizeTheme(value?: string | null): Theme {
  return value === "dark" ? "dark" : "light";
}
