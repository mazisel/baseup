"use server";

import { createClient } from "@/lib/supabase/server";

type AuthMode = "login" | "register";

export async function authenticateWithPassword(email: string, password: string, name: string, mode: AuthMode) {
  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (password.length < 8) {
    return { error: "Şifre en az 8 karakter olmalı." };
  }

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
      return { error: error.message };
    }

    return { success: true, needsConfirmation: !data.session };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true, redirectTo: "/app" };
}
