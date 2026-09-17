import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { ServiceError, type ServiceErrorCode } from "../../lib/serviceError";

export interface DriveFile {
  id: string;
  name: string;
  folder: boolean;
  modifiedTime: string | null;
  size: string | null;
}
interface DrivePage {
  files: DriveFile[];
  nextPage: string | null;
}
export interface DriveService {
  status(signal?: AbortSignal): Promise<{ connectionState: string } | null>;
  connect(signal?: AbortSignal): Promise<string>;
  disconnect(signal?: AbortSignal): Promise<void>;
  files(folder: string, page?: string, signal?: AbortSignal): Promise<DrivePage>;
  pickPdf(signal?: AbortSignal, parent?: string): Promise<DriveFile | null>;
  pdf(file: DriveFile, signal?: AbortSignal): Promise<File>;
}
export function createDriveService(client: SupabaseClient<Database>): DriveService {
  async function request(path: string, method = "GET", signal?: AbortSignal) {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session)
      throw new ServiceError("unauthorized", "Sign in again to use Google Drive.");
    const response = await fetch(`/api/drive/${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(path.startsWith("pdf?") ? 120_000 : 30_000),
      ]),
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const failures: Record<string, { code: ServiceErrorCode; message: string }> = {
        reconnect_required: {
          code: "reconnect_required",
          message: "Reconnect Google Drive to continue.",
        },
        not_configured: { code: "unavailable", message: "Google Drive setup is not finished yet." },
        file_unavailable: {
          code: "not_found",
          message: "This file or folder is unavailable. Check its permissions in Google Drive.",
        },
      };
      const failure = failures[body?.error?.code] ?? {
        code: "unavailable" as const,
        message: "Google Drive could not load. Try again.",
      };
      throw new ServiceError(failure.code, failure.message);
    }
    return response;
  }
  return {
    status: async (signal) => (await request("status", "GET", signal)).json(),
    connect: async (signal) =>
      (await (await request("connect", "POST", signal)).json()).authorizationUrl,
    disconnect: async (signal) => {
      await request("disconnect", "POST", signal);
    },
    files: async (folder, page, signal) =>
      (
        await request(
          `files?${new URLSearchParams({ folder, ...(page ? { page } : {}) })}`,
          "GET",
          signal,
        )
      ).json(),
    pickPdf: async (signal, parent) => {
      const { pickGooglePdf } = await import("./googlePicker");
      const grant = await (await request("picker", "POST", signal)).json();
      if (
        typeof grant.accessToken !== "string" ||
        typeof grant.developerKey !== "string" ||
        typeof grant.appId !== "string"
      ) {
        throw new ServiceError("unavailable", "Google’s file picker is not configured yet.");
      }
      return pickGooglePdf(grant, signal, parent);
    },
    pdf: async (file, signal) => {
      const response = await request(`pdf?id=${encodeURIComponent(file.id)}`, "GET", signal);
      let name = file.name;
      try {
        name = decodeURIComponent(response.headers.get("X-Apraxia-File-Name") ?? "") || name;
      } catch {
        /* Preserve the saved display name if the header is invalid. */
      }
      return new File([await response.blob()], name, { type: "application/pdf" });
    },
  };
}
