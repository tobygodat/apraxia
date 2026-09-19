import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { ServiceError } from "../../lib/serviceError";

export interface HomeAppearance {
  title: string;
}
export const EMPTY_APPEARANCE: HomeAppearance = { title: "" };
export interface HomeAppearanceService {
  load(userId: string, signal: AbortSignal): Promise<HomeAppearance>;
  save(userId: string, value: HomeAppearance, signal: AbortSignal): Promise<HomeAppearance>;
}
export function validateAppearance(value: HomeAppearance): HomeAppearance {
  if (typeof value.title !== "string" || value.title.length > 100)
    throw new ServiceError("invalid_input", "Use a page name of 100 characters or fewer.");
  return { title: value.title.trim() };
}
export function createHomeAppearanceService(
  client: SupabaseClient<Database>,
): HomeAppearanceService {
  return {
    async load(userId, signal) {
      const { data, error } = await client
        .from("home_appearance")
        .select("user_id,title")
        .eq("user_id", userId)
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
        .maybeSingle();
      if (error)
        throw new ServiceError("unavailable", "Couldn’t load your page appearance. Try again.");
      if (!data) return { ...EMPTY_APPEARANCE };
      if (data.user_id !== userId)
        throw new ServiceError("unavailable", "Couldn’t load your page appearance.");
      return validateAppearance({ title: data.title });
    },
    async save(userId, value, signal) {
      const valid = validateAppearance(value);
      const { data, error } = await client
        .from("home_appearance")
        .upsert({ user_id: userId, title: valid.title })
        .select("user_id,title")
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
        .single();
      if (error || !data || data.user_id !== userId)
        throw new ServiceError(
          "unavailable",
          "Couldn’t confirm the save. Your draft is still here; try again.",
        );
      return validateAppearance({ title: data.title });
    },
  };
}
