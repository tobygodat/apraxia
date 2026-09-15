export type UUID = string;
export type LocalDate = string;
export type LocalTime = string;
type Timestamp = string;

export type ProjectStatus = "active" | "someday" | "completed" | "archived";
export type MediaType = "book" | "movie";
export type MediaStatus = "saved" | "in_progress" | "finished";
type OrbitRecordType = "todo" | "idea" | "media" | "project";
type GoogleCalendarConnectionState = "connected" | "reconnect_required" | "disconnected";

/** Browser-safe calendar colors. No Google event body or credential data belongs here. */
export interface CalendarColor {
  background: string | null;
  foreground: string | null;
}

/** Display metadata persisted for a calendar discovered through Google Calendar. */
interface CalendarMetadata {
  calendarId: string;
  displayName: string;
  color: CalendarColor;
}

/** The browser-visible calendar preference row. */
export interface CalendarPreference extends CalendarMetadata {
  canEdit?: boolean;
  id: UUID;
  isVisible: boolean;
  lastSeenAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Calendar metadata included in a week response after visibility filtering. */
export interface VisibleCalendarMetadata extends CalendarMetadata {
  isVisible: true;
}

/**
 * Browser-safe Google connection status. Tokens and private credential metadata
 * are deliberately absent from this contract.
 */
export interface GoogleCalendarConnectionStatus {
  id: UUID;
  googleAccountId: string | null;
  displayEmail: string | null;
  connectionState: GoogleCalendarConnectionState;
  grantedScopes: readonly string[];
  lastSuccessfulRefreshAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface CalendarEventBase {
  eventId: string;
  calendarId: string;
  title: string;
  location?: string;
  calendarColor: CalendarColor;
  googleEventUrl: string;
}

/**
 * All-day boundaries are local calendar dates. Google's end date is exclusive
 * and must never be converted through JavaScript Date.
 */
export interface AllDayCalendarEvent extends CalendarEventBase {
  kind: "all_day";
  startDate: LocalDate;
  endDateExclusive: LocalDate;
  startAt?: never;
  endAt?: never;
  startTimeZone?: never;
  endTimeZone?: never;
}

/**
 * Timed boundaries are RFC 3339 timestamps. Explicit Google timezones are kept
 * when present; the timestamps still retain their numeric offsets when absent.
 */
export interface TimedCalendarEvent extends CalendarEventBase {
  kind: "timed";
  startAt: Timestamp;
  endAt: Timestamp;
  startTimeZone: string | null;
  endTimeZone: string | null;
  startDate?: never;
  endDateExclusive?: never;
}

export type CalendarEvent = AllDayCalendarEvent | TimedCalendarEvent;

/** Sanitized error information for one calendar; never an upstream response. */
export interface CalendarPartialError {
  calendarId: string;
  calendarDisplayName: string;
  code: string;
  userMessage: string;
  retryable: boolean;
}

/** A complete, inclusive Sunday-through-Saturday date range. */
export interface CalendarWeekRange {
  sunday: LocalDate;
  saturday: LocalDate;
}

/** The single browser contract returned by the read-only week endpoint. */
export interface WeekViewModel {
  range: CalendarWeekRange;
  timezone: string;
  events: readonly CalendarEvent[];
  visibleCalendars: readonly VisibleCalendarMetadata[];
  partialErrors: readonly CalendarPartialError[];
}

export interface Profile {
  userId: UUID;
  timezone: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Project {
  id: UUID;
  title: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectSummary {
  id: UUID;
  title: string;
}

export interface Todo {
  id: UUID;
  text: string;
  completed: boolean;
  completedAt: Timestamp | null;
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;
  projectId: UUID | null;
  todayRank: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Idea {
  id: UUID;
  title: string | null;
  body: string;
  projectId: UUID | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MediaItem {
  id: UUID;
  mediaType: MediaType;
  title: string;
  creator: string | null;
  releaseYear: number | null;
  status: MediaStatus;
  rating: number | null;
  notes: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface NewProjectInput {
  title: string;
  description?: string | null;
  status?: ProjectStatus;
}

interface NewTodoInputBase {
  text: string;
  projectId?: UUID | null;
}

/** A due time can enter the service boundary only together with a due date. */
export type NewTodoInput = NewTodoInputBase &
  ({ dueDate?: null; dueTime?: null } | { dueDate: LocalDate; dueTime?: LocalTime | null });

export interface NewIdeaInput {
  title?: string | null;
  body: string;
  projectId?: UUID | null;
}

export interface NewMediaInput {
  mediaType: MediaType;
  title: string;
  creator?: string | null;
  releaseYear?: number | null;
  status?: MediaStatus;
  rating?: number | null;
  notes?: string | null;
}

export interface TodayTodo {
  id: UUID;
  text: string;
  /** Today only contains incomplete todos. */
  completed: false;
  completedAt: null;
  dueDate: LocalDate;
  dueTime: LocalTime | null;
  projectId: UUID | null;
  projectTitle: string | null;
  todayRank: number | null;
  isOverdue: boolean;
  isManuallyOrdered: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SearchResult {
  recordType: OrbitRecordType;
  recordId: UUID;
  title: string;
  snippet: string;
  updatedAt: Timestamp;
  relevance: number;
  totalCount: number;
}

declare const deleteUndoTokenBrand: unique symbol;

/** Keep this exact database string; never round-trip it through Date. */
export type DeleteUndoToken = Timestamp & {
  readonly [deleteUndoTokenBrand]: "DeleteUndoToken";
};
