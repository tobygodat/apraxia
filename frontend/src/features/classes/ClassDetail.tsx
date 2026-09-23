import { useState } from "react";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { ClassAssignments } from "./ClassAssignments";
import { ClassNotes } from "./ClassNotes";
import { ClassSummary } from "./ClassSummary";
import { useLocalToday } from "../todos/useLocalToday";
import type { AssignmentService } from "./assignmentService";
import type { ClassOverview } from "./classOverview";
import type { ClassService, Course } from "./classService";

/**
 * One class. Its header totals come from the assignments already on this page,
 * so ticking an assignment off moves the header with the table instead of
 * waiting for a reload. Mount it keyed by class id.
 */
export function ClassDetail({
  userId,
  course,
  classService,
  assignmentService,
  timezone,
  onEdit,
  onSaved,
}: {
  userId: string;
  course: Course;
  classService?: ClassService;
  assignmentService?: AssignmentService;
  timezone?: string;
  onEdit(): void;
  /** The class as saved, so the list behind this page holds the new text. */
  onSaved(course: Course): void;
}) {
  // Sampled so the header re-labels itself at local midnight; the assignment
  // table re-reads its own date on the render that follows.
  const today = useLocalToday(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [overview, setOverview] = useState<ClassOverview | null>(null);
  return (
    <>
      <header className="classes-heading workspace-page-header">
        <div>
          <h1>{course.name ?? "Recovered class"}</h1>
          {overview && <ClassSummary overview={overview} today={today} variant="header" />}
        </div>
        <button className="workspace-page-header__action" onClick={onEdit}>
          <WorkspaceIcon name="edit" />
          Edit class
        </button>
      </header>
      <div className="classes-course-content">
        {course.name === null && (
          <p>
            This class was recovered from its assignments. Edit its name, or open the browser where
            you originally saved it to recover the name.
          </p>
        )}
        {assignmentService && (
          <ClassAssignments
            userId={userId}
            courseId={course.id}
            service={assignmentService}
            timezone={timezone}
            onOverview={setOverview}
          />
        )}
        <h2 className="classes-section-heading">Notes</h2>
        {classService ? (
          <ClassNotes userId={userId} course={course} service={classService} onSaved={onSaved} />
        ) : (
          <p role="alert">Class storage is unavailable. Reload to try again.</p>
        )}
      </div>
    </>
  );
}
