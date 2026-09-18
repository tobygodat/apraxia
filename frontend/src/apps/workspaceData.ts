import { createClassService, type ClassService } from "../features/classes/classService";
import { createNoteService, type NoteService } from "../features/classes/noteService";
import {
  createClassOverviewService,
  type ClassOverviewService,
} from "../features/classes/classOverviewService";
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

/** Postgres check_violation, raised by the profile timezone trigger. */
const CHECK_VIOLATION = "23514";
const UNKNOWN_TIMEZONE_COPY = "That timezone isn’t recognised. Pick another one.";

export interface WorkspaceData {
  classes?: ClassService;
  notes?: NoteService;
  classOverview?: ClassOverviewService;
  assignments?: AssignmentService;
  homeAppearance?: HomeAppearanceService;
  profile(signal: AbortSignal): Promise<Profile>;
  projects(signal: AbortSignal): Promise<ProjectSummary[]>;
  /** Save the profile timezone. Rejects names Postgres does not recognise. */
  setTimezone(userId: string, timezone: string, signal?: AbortSignal): Promise<Profile>;
}

export function createWorkspaceData(client: SupabaseClient<Database>): WorkspaceData {
  return {
    classes: createClassService(client),
    notes: createNoteService(client),
    classOverview: createClassOverviewService(client),
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
    async setTimezone(userId, timezone, signal) {
      const value = timezone.trim();
      if (!value) throw new ServiceError("invalid_input", UNKNOWN_TIMEZONE_COPY);
      const timeout = AbortSignal.timeout(20_000);
      const { data, error } = await client
        .from("profiles")
        .update({ timezone: value })
        .eq("user_id", userId)
        .select("user_id,timezone,created_at,updated_at")
        .abortSignal(signal ? AbortSignal.any([signal, timeout]) : timeout)
        .single();
      // The profiles_timezone_valid trigger raises a check violation for any
      // name Postgres does not know; everything else is a transport failure.
      if (error?.code === CHECK_VIOLATION)
        throw new ServiceError("invalid_input", UNKNOWN_TIMEZONE_COPY);
      if (error || !data || data.user_id !== userId)
        throw new ServiceError("unavailable", "Your timezone wasn’t saved. Try again.");
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
