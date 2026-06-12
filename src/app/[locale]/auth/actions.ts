"use server";

import { createClient } from "@/lib/supabase/server";
import { getPreferences } from "@/lib/preferences";

type AuthMode = "login" | "register";

export async function authenticateWithPassword(email: string, password: string, name: string, mode: AuthMode) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { locale } = await getPreferences();

  if (password.length < 8) {
    return { error: locale === "tr" ? "Şifre en az 8 karakter olmalı." : "Password must be at least 8 characters." };
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: "Supabase bağlantısı eksik. Localde .env.local içine NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY ekleyin." };
  }

  const supabase = await createClient();

  if (mode === "register") {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: siteUrl ? `${siteUrl}/auth/callback` : undefined,
        data: {
          full_name: name,
        },
      },
    });

    if (error) {
      return { error: translateAuthError(error.message, locale) };
    }

    return { success: true, needsConfirmation: !data.session };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: translateAuthError(error.message, locale) };
  }

  return { success: true, redirectTo: "/app" };
}

// Supabase auth hataları İngilizce döner; arayüz dili Türkçe ise bilinen
// mesajları çevir, bilinmeyenler olduğu gibi gösterilsin.
function translateAuthError(message: string, locale: string) {
  if (locale !== "tr") return message;

  const translations: Array<[RegExp, string]> = [
    [/invalid login credentials/i, "E-posta veya şifre hatalı."],
    [/email not confirmed/i, "E-posta adresiniz henüz doğrulanmamış. Gelen kutunuzu kontrol edin."],
    [/user already registered/i, "Bu e-posta adresiyle zaten bir hesap var. Giriş yapmayı deneyin."],
    [/password should be at least/i, "Şifre en az 8 karakter olmalı."],
    [/(too many requests|rate limit)/i, "Çok fazla deneme yapıldı. Lütfen biraz bekleyip tekrar deneyin."],
    [/signups not allowed/i, "Yeni kayıtlar şu anda kapalı."],
    [/(fetch failed|network)/i, "Kimlik doğrulama sunucusuna ulaşılamadı. Bağlantınızı kontrol edin."],
  ];

  for (const [pattern, translated] of translations) {
    if (pattern.test(message)) return translated;
  }
  return message;
}
