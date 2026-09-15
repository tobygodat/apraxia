import { useMemo } from "react";
import { ClassAssignments } from "../features/classes/ClassAssignments";
import type { Assignment, AssignmentService } from "../features/classes/assignmentService";
import { addSqlDateDays, localToday } from "../features/todos/dateDomain";

export function createFixtureAssignments(empty = false): AssignmentService {
  const today = localToday("America/New_York");
  const samples: Assignment[] = [
    {
      id: "1",
      title: "Problem set 3",
      type: "Homework",
      due: addSqlDateDays(today, -2),
      done: false,
    },
    {
      id: "2",
      title: "Problem set 4",
      type: "Homework",
      due: addSqlDateDays(today, 1),
      done: false,
    },
    {
      id: "3",
      title: "Counting principles",
      type: "Quiz",
      due: addSqlDateDays(today, 5),
      done: false,
    },
    {
      id: "4",
      title: "Midterm review problems",
      type: "Other",
      due: addSqlDateDays(today, 10),
      done: false,
    },
    { id: "5", title: "Read chapter 5", type: "Reading", due: "", done: false },
    {
      id: "6",
      title: "Problem set 2",
      type: "Homework",
      due: addSqlDateDays(today, -9),
      done: true,
    },
  ];
  const courses = new Map<string, Assignment[]>();
  function rows(userId: string, courseId: string) {
    const key = `${userId}:${courseId}`;
    if (!courses.has(key))
      courses.set(
        key,
        !empty && courseId === "math3012" ? samples.map((item) => ({ ...item })) : [],
      );
    return courses.get(key)!;
  }
  return {
    async list(userId, courseId) {
      return rows(userId, courseId).map((item) => ({ ...item }));
    },
    async create(userId, courseId, item) {
      const items = rows(userId, courseId);
      const existing = items.find((row) => row.id === item.id);
      if (existing) return { ...existing };
      items.push({ ...item });
      return { ...item };
    },
    async update(userId, courseId, id, patch) {
      const item = rows(userId, courseId).find((row) => row.id === id);
      if (!item) throw new Error("Assignment not found.");
      Object.assign(item, patch);
      return { ...item };
    },
  };
}
/** Fictional service, shared production UI. Data resets on fixture reload. */
export function ClassAssignmentsMock({ empty = false }: { empty?: boolean }) {
  const service = useMemo(() => createFixtureAssignments(empty), [empty]);
  return (
    <ClassAssignments
      userId="qa"
      courseId="math3012"
      service={service}
      timezone="America/New_York"
    />
  );
}
