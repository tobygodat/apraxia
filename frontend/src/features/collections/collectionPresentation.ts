import type { Idea } from "../../types/domain";
import { ideaTitle } from "./collectionService";

export function ideaPreview(idea: Pick<Idea, "title" | "body">): string {
  const lines = idea.body.trim().split(/\r?\n/);
  if (lines[0]?.trim() === ideaTitle(idea)) lines.shift();
  return lines.join("\n").trim();
}
