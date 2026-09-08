import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";

export interface HomeAppearance { title: string; coverImage: string | null; coverPositionX?: number; coverPositionY?: number }
export const EMPTY_APPEARANCE: HomeAppearance = { title: "", coverImage: null };
export interface HomeAppearanceService {
  load(userId: string, signal: AbortSignal): Promise<HomeAppearance>;
  save(userId: string, value: HomeAppearance, signal: AbortSignal): Promise<HomeAppearance>;
}
export function validateAppearance(value: HomeAppearance): HomeAppearance {
  if (typeof value.title !== "string" || value.title.length > 100) throw new Error("Use a page name of 100 characters or fewer.");
  if (value.coverImage !== null && (typeof value.coverImage !== "string" || value.coverImage.length > 350000 || !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.coverImage))) {
    throw new Error("Choose a smaller JPG, PNG, or WebP image.");
  }
  const coverPositionX = value.coverPositionX ?? 50;
  const coverPositionY = value.coverPositionY ?? 50;
  if (![coverPositionX, coverPositionY].every(position => Number.isInteger(position) && position >= 0 && position <= 100)) throw new Error("Choose a cover position between 0 and 100.");
  return { title: value.title.trim(), coverImage: value.coverImage, coverPositionX, coverPositionY };
}
export function createHomeAppearanceService(client: SupabaseClient<Database>): HomeAppearanceService {
  return {
    async load(userId, signal) {
      const { data, error } = await client.from("home_appearance").select("user_id,title,cover_image,cover_position_x,cover_position_y").eq("user_id", userId)
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)])).maybeSingle();
      if (error) throw new Error("Couldn’t load your page appearance. Try again.");
      if (!data) return { ...EMPTY_APPEARANCE };
      if (data.user_id !== userId) throw new Error("Couldn’t load your page appearance.");
      return validateAppearance({ title: data.title, coverImage: data.cover_image, coverPositionX: data.cover_position_x, coverPositionY: data.cover_position_y });
    },
    async save(userId, value, signal) {
      const valid = validateAppearance(value);
      const { data, error } = await client.from("home_appearance").upsert({ user_id: userId, title: valid.title, cover_image: valid.coverImage, cover_position_x: valid.coverPositionX, cover_position_y: valid.coverPositionY })
        .select("user_id,title,cover_image,cover_position_x,cover_position_y").abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)])).single();
      if (error || !data || data.user_id !== userId) throw new Error("Couldn’t confirm the save. Your draft is still here; try again.");
      return validateAppearance({ title: data.title, coverImage: data.cover_image, coverPositionX: data.cover_position_x, coverPositionY: data.cover_position_y });
    },
  };
}

/** Keep a single small cover in the account; never store the original upload. */
export async function prepareCover(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a JPG, PNG, or WebP image under 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1440 / bitmap.width, 800 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn’t read this image. Try another file.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.82, .65, .45]) {
      const image = canvas.toDataURL("image/webp", quality);
      if (image.length <= 350000) return validateAppearance({ title: "", coverImage: image }).coverImage!;
    }
    throw new Error("This image is too detailed. Choose a smaller image.");
  } finally { bitmap.close(); }
}
