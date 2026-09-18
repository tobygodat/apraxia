import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useColdLoad } from "../../apps/coldLoad";
import { ArrowIcon } from "../../components/icons";
import type { Profile } from "../../types/domain";
import { shiftWeekMonday, startOfWeekMonday, type SqlDate } from "../todos/dateDomain";
import { formatTaskDate, formatTaskTime } from "../todos/taskFormatting";
import type { TodoService } from "../todos/todoService";
import { useTodoController } from "../todos/todoController";
import { todoLoadErrorCopy } from "../todos/todoUiState";
import { useLocalToday } from "../todos/useLocalToday";
import {
  buildWeeklyReviewModel,
  type WeeklyReviewEntry,
  type WeeklyReviewSection,
  type WeeklyReviewSectionKey,
} from "./weeklyReviewModel";
import "./weeklyReview.css";

const RANGE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const ENTRY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

const SECTION_HEADINGS: Record<WeeklyReviewSectionKey, string> = {
  finished: "Finished",
  slipped: "Slipped",
  next: "Next",
};

/** Shown on the ruled ground when a section holds nothing. */
const SECTION_EMPTY_COPY: Record<WeeklyReviewSectionKey, string> = {
  finished: "Nothing was finished in this week.",
  slipped: "Nothing slipped. Everything due by now is done.",
  next: "Nothing is due in this stretch.",
};

/** One page instance per app, so the band anchors can be stable ids. */
function bandId(key: WeeklyReviewSectionKey): string {
  return `weekly-review-${key}`;
}

function formatRange(from: string, to: string): string {
  return `${formatTaskDate(from, RANGE_FORMAT)} – ${formatTaskDate(to, RANGE_FORMAT)}`;
}

function sectionCaption(section: WeeklyReviewSection): string {
  const count = `${section.total} ${section.total === 1 ? "task" : "tasks"}`;
  if (section.key === "slipped") {
    return section.to === null
      ? count
      : `${count}, due on or before ${formatTaskDate(section.to, RANGE_FORMAT)}`;
  }
  if (section.from === null || section.to === null) return count;
  return `${count}, ${formatRange(section.from, section.to)}`;
}

function EntryRow({
  entry,
  section,
}: {
  entry: WeeklyReviewEntry;
  section: WeeklyReviewSectionKey;
}) {
  const { todo } = entry;
  const metadata: { key: string; text: string; late?: boolean }[] = [];

  if (section === "finished" && entry.completedOn !== null) {
    metadata.push({ key: "completed", text: formatTaskDate(entry.completedOn, ENTRY_DATE_FORMAT) });
  }
  if (section !== "finished" && todo.dueDate !== null) {
    metadata.push({
      key: "due",
      text: formatTaskDate(todo.dueDate, ENTRY_DATE_FORMAT),
      late: entry.daysLate !== null,
    });
    if (todo.dueTime !== null) metadata.push({ key: "time", text: formatTaskTime(todo.dueTime) });
  }
  if (entry.daysLate !== null) {
    metadata.push({
      key: "late",
      text: `${entry.daysLate} ${entry.daysLate === 1 ? "day" : "days"} late`,
      late: true,
    });
  }
  if (todo.assignmentType) metadata.push({ key: "type", text: todo.assignmentType });

  return (
    <li className="weekly-review__entry">
      <p className="weekly-review__entry-text">{todo.text}</p>
      {metadata.length > 0 ? (
        <p className="weekly-review__entry-meta">
          {metadata.map((item) => (
            <span key={item.key} className={item.late ? "weekly-review__entry-late" : undefined}>
              {item.text}
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

function Band({ section, headingId }: { section: WeeklyReviewSection; headingId: string }) {
  return (
    <section
      className="weekly-review__band"
      id={`${headingId}-band`}
      aria-labelledby={headingId}
      tabIndex={-1}
    >
      <div className="weekly-review__band-head">
        <h2 id={headingId}>{SECTION_HEADINGS[section.key]}</h2>
        <p className="weekly-review__band-caption">{sectionCaption(section)}</p>
      </div>
      <div
        className={
          section.groups.length === 0
            ? "weekly-review__groups weekly-review__groups--empty"
            : "weekly-review__groups"
        }
      >
        {section.groups.length === 0 ? (
          <p className="weekly-review__empty">{SECTION_EMPTY_COPY[section.key]}</p>
        ) : (
          section.groups.map((group) => (
            <div className="weekly-review__group" key={group.key}>
              <h3 className="weekly-review__group-head">
                <span className="weekly-review__group-name">
                  {group.href ? <Link to={group.href}>{group.label}</Link> : group.label}
                </span>
                <span className="weekly-review__group-count">{group.entries.length}</span>
              </h3>
              <ul className="weekly-review__entries">
                {group.entries.map((entry) => (
                  <EntryRow key={entry.todo.id} entry={entry} section={section.key} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ReviewPlaceholder({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  useColdLoad(!failed);
  return (
    <section className="weekly-review" aria-labelledby="weekly-review-loading-heading">
      <header className="weekly-review__toolbar">
        <h1 id="weekly-review-loading-heading">Weekly review</h1>
      </header>
      {failed ? (
        <div className="weekly-review__error" role="alert">
          <p>{todoLoadErrorCopy("Tasks")}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <p className="cloud-shell__sr-only" role="status">
          Loading your week…
        </p>
      )}
    </section>
  );
}

export interface WeeklyReviewPageProps {
  readonly service: TodoService;
  readonly profile: Profile;
  /** Authenticated client-state lifetime, never a provider ownership argument. */
  readonly workspaceSessionKey: string;
}

/**
 * The read-only close of a week: what was finished in it, what slipped, and
 * what the stretch ahead holds, each grouped by project and class. Every row
 * comes from the workspace snapshot the rest of the app already loads, so this
 * page adds no request and writes nothing.
 */
export function WeeklyReviewPage({ service, profile, workspaceSessionKey }: WeeklyReviewPageProps) {
  const { state, controller } = useTodoController(service, workspaceSessionKey, {
    workspace: true,
  });
  const today = useLocalToday(profile.timezone);
  const currentMonday = startOfWeekMonday(today);
  // null follows the current week across local midnight; an explicit choice
  // stays on its Monday until the user asks for this week again.
  const [selectedMonday, setSelectedMonday] = useState<SqlDate | null>(null);
  const weekMonday = selectedMonday ?? currentMonday;

  const model = useMemo(
    () =>
      buildWeeklyReviewModel({
        todos: state.todos,
        projects: state.projects,
        classes: state.classes,
        timezone: profile.timezone,
        today,
        weekMonday,
      }),
    [state.todos, state.projects, state.classes, profile.timezone, today, weekMonday],
  );

  if (!state.workspaceLoaded) {
    return (
      <ReviewPlaceholder
        failed={state.workspaceStatus === "error"}
        onRetry={() => {
          void controller.loadWorkspace();
        }}
      />
    );
  }

  return (
    <section className="weekly-review" aria-labelledby="weekly-review-title">
      <header className="weekly-review__toolbar">
        <div className="weekly-review__title">
          <h1 id="weekly-review-title">Weekly review</h1>
          <p className="weekly-review__range">
            {formatRange(model.weekMonday, model.weekSunday)}
            {model.isCurrentWeek ? " · This week" : ""}
          </p>
        </div>
        <nav className="weekly-review__nav" aria-label="Review week navigation">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setSelectedMonday(shiftWeekMonday(weekMonday, -1))}
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            type="button"
            disabled={model.isCurrentWeek}
            onClick={() => setSelectedMonday(null)}
          >
            This week
          </button>
          <button
            type="button"
            aria-label="Next week"
            // A week that has not happened yet has nothing to review.
            disabled={model.isCurrentWeek}
            onClick={() => setSelectedMonday(shiftWeekMonday(weekMonday, 1))}
          >
            <ArrowIcon direction="right" />
          </button>
        </nav>
      </header>

      {state.workspaceStatus === "error" ? (
        <div className="weekly-review__error" role="alert">
          <p>{todoLoadErrorCopy("Tasks")}</p>
          <button
            type="button"
            onClick={() => {
              void controller.loadWorkspace();
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {/* Keyed on the week so a week change replays the sheet's one entrance. */}
      <div className="weekly-review__sheet" key={model.weekMonday}>
        <nav className="weekly-review__standing" aria-label="Review sections">
          <ul>
            {model.sections.map((section) => (
              <li key={section.key}>
                <a href={`#${bandId(section.key)}-band`}>
                  <span>{SECTION_HEADINGS[section.key]}</span>
                  <span className="weekly-review__standing-count">{section.total}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="weekly-review__bands">
          {model.sections.map((section) => (
            <Band key={section.key} section={section} headingId={bandId(section.key)} />
          ))}
        </div>
      </div>
    </section>
  );
}
