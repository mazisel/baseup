"use server";

import { createClient } from "@/lib/supabase/server";

export async function signInWithEmail(email: string, name: string, mode: "login" | "register") {
  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: mode === "register",
      emailRedirectTo: siteUrl ? `${siteUrl}/auth/callback` : undefined,
      data: {
        full_name: name,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
