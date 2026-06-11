"use client";

import { Languages, Moon, Sun } from "lucide-react";
import type { Locale, Theme } from "@/lib/preference-shared";
import { LOCALE_COOKIE, THEME_COOKIE } from "@/lib/preference-shared";

type PreferenceCopy = {
  language: string;
  theme: string;
  light: string;
  dark: string;
  turkish: string;
  english: string;
};

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function PreferenceControls({
  locale,
  theme,
  copy
}: {
  locale: Locale;
  theme: Theme;
  copy: PreferenceCopy;
}) {
  function setCookie(name: string, value: string) {
    document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }

  function changeLocale(nextLocale: Locale) {
    setCookie(LOCALE_COOKIE, nextLocale);
    window.location.reload();
  }

  function changeTheme(nextTheme: Theme) {
    setCookie(THEME_COOKIE, nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }

  return (
    <div className="preference-controls" aria-label={`${copy.language} / ${copy.theme}`}>
      <div className="segmented" aria-label={copy.language}>
        <Languages size={15} />
        <button
          aria-pressed={locale === "tr"}
          className={locale === "tr" ? "active" : ""}
          onClick={() => changeLocale("tr")}
          type="button"
        >
          {copy.turkish}
        </button>
        <button
          aria-pressed={locale === "en"}
          className={locale === "en" ? "active" : ""}
          onClick={() => changeLocale("en")}
          type="button"
        >
          {copy.english}
        </button>
      </div>
      <div className="segmented" aria-label={copy.theme}>
        <button
          aria-label={copy.light}
          aria-pressed={theme === "light"}
          className={theme === "light" ? "active icon-only" : "icon-only"}
          onClick={() => changeTheme("light")}
          type="button"
        >
          <Sun size={15} />
        </button>
        <button
          aria-label={copy.dark}
          aria-pressed={theme === "dark"}
          className={theme === "dark" ? "active icon-only" : "icon-only"}
          onClick={() => changeTheme("dark")}
          type="button"
        >
          <Moon size={15} />
        </button>
      </div>
    </div>
  );
}
