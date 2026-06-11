"use server";

import { createClient } from "@/lib/supabase/server";

export async function signInWithEmail(email: string, name: string) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
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
