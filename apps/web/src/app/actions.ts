"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signInDemo() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.DEMO_ADMIN_EMAIL!,
    password: process.env.DEMO_ADMIN_PASSWORD!,
  });

  if (error) {
    throw new Error(`Demo sign-in failed: ${error.message}`);
  }

  redirect("/dashboard");
}
