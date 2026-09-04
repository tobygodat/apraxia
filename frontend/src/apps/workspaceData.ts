import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import type { Profile, ProjectSummary } from "../types/domain";

export interface WorkspaceData {
  profile(signal: AbortSignal): Promise<Profile>;
  projects(signal: AbortSignal): Promise<ProjectSummary[]>;
}

export function createWorkspaceData(client: SupabaseClient<Database>): WorkspaceData {
  return {
    async profile(signal) {
      const { data, error } = await client.from("profiles")
        .select("user_id,timezone,created_at,updated_at")
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)])).single();
      if (error || !data) throw new Error("Couldn’t load your workspace. Try again.");
      return { userId: data.user_id, timezone: data.timezone, createdAt: data.created_at, updatedAt: data.updated_at };
    },
    async projects(signal) {
      const projects: ProjectSummary[] = [];
      let after: string | null = null;
      for (;;) {
        let query = client.from("projects").select("id,title").is("deleted_at", null)
          .order("id").limit(200).abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
        if (after) query = query.gt("id", after);
        const { data, error } = await query;
        if (error || !data) throw new Error("Couldn’t load projects. Try again.");
        projects.push(...data);
        if (data.length < 200) return projects.sort((a, b) => a.title.localeCompare(b.title));
        after = data[data.length - 1].id;
      }
    },
  };
}
