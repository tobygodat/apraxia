import type { Idea, ProjectSummary } from "../../types/domain";
import { ideaTitle } from "./collectionService";

export interface IdeaProjectGroup {
  key: string;
  title: string;
  projectId: string | null;
  projectAvailable: boolean;
  ideas: Idea[];
}

export function ideaPreview(idea: Pick<Idea, "title" | "body">): string {
  const lines = idea.body.trim().split(/\r?\n/);
  if (lines[0]?.trim() === ideaTitle(idea)) lines.shift();
  return lines.join("\n").trim();
}

/** Keeps the ideas page project-first without losing unassigned or orphaned ideas. */
export function groupIdeasByProject(
  ideas: readonly Idea[],
  projects: readonly ProjectSummary[],
): IdeaProjectGroup[] {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const groups = new Map<string, IdeaProjectGroup>();

  for (const idea of ideas) {
    const project = idea.projectId ? projectsById.get(idea.projectId) : undefined;
    const key = idea.projectId ? `project:${idea.projectId}` : "unassigned";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: project?.title.trim() || (idea.projectId ? "Unavailable project" : "Unassigned"),
        projectId: idea.projectId,
        projectAvailable: Boolean(project),
        ideas: [],
      };
      groups.set(key, group);
    }
    group.ideas.push(idea);
  }

  const rank = (group: IdeaProjectGroup) =>
    group.projectAvailable ? 0 : group.projectId === null ? 2 : 1;
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
  );
}
