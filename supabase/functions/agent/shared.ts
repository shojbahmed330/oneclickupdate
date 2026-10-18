// Shared types + env constants for the agent edge function.
import type { createClient } from "npm:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
export const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
export const DAYTONA_SNAPSHOT = Deno.env.get("DAYTONA_SNAPSHOT") || "";

export type ToolCtx = {
  supabase: ReturnType<typeof createClient>;
  projectId: string;
  userId: string;
  userToken: string;
};
