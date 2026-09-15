import { createClassService, type ClassService } from "../features/classes/classService";
import { createNoteService, type NoteService } from "../features/classes/noteService";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import type { Profile, ProjectSummary } from "../types/domain";
import {
  createHomeAppearanceService,
  type HomeAppearanceService,
} from "../features/calendar/homeAppearance";
import { collectRows, PAGE_SIZE, requestSignal } from "../features/todos/supabaseTodoService";

import {
  createAssignmentService,
  type AssignmentService,
} from "../features/classes/assignmentService";
import { ServiceError } from "../lib/serviceError";

export interface WorkspaceData {
  classes?: ClassService;
  notes?: NoteService;
  assignments?: AssignmentService;
  homeAppearance?: HomeAppearanceService;
  profile(signal: AbortSignal): Promise<Profile>;
  projects(signal: AbortSignal): Promise<ProjectSummary[]>;
}

export function createWorkspaceData(client: SupabaseClient<Database>): WorkspaceData {
  return {
    classes: createClassService(client),
    notes: createNoteService(client),
    assignments: createAssignmentService(client),
    homeAppearance: createHomeAppearanceService(client),
    async profile(signal) {
      const { data, error } = await client
        .from("profiles")
        .select("user_id,timezone,created_at,updated_at")
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(20_000)]))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t load your workspace. Try again.");
      return {
        userId: data.user_id,
        timezone: data.timezone,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },
    async projects(signal) {
      const options = { signal };
      const requestSignalValue = requestSignal(options);
      const projects: ProjectSummary[] = await collectRows((afterId) => {
        const query = client
          .from("projects")
          .select("id,title", { count: "exact" })
          .is("deleted_at", null)
          .order("id")
          .limit(PAGE_SIZE)
          .abortSignal(requestSignalValue);
        return afterId === null ? query : query.gt("id", afterId);
      }, options);
      return projects.sort((a, b) => a.title.localeCompare(b.title));
    },
  };
}
