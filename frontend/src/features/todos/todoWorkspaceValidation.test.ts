import { describe, expect, it } from "vitest";
import type { Todo } from "../../types/domain";
import {
  canonicalLocalTime,
  isDeleteUndoToken,
  readTodoResponse,
  readTodoWorkspaceSnapshot,
  todoMatchesDetails,
} from "./todoWorkspaceValidation";

const TODO: Todo = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "Prepare review",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: null,
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.123456Z",
  updatedAt: "2026-09-01T10:00:00.123456-04:00",
};
const SNAPSHOT = {
  profile: {
    userId: "11111111-1111-4111-8111-111111111111",
    timezone: "America/New_York",
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00+00:00",
  },
  projects: [{ id: "33333333-3333-4333-8333-333333333333", title: "Launch" }],
  todos: [TODO],
};

describe("Todo workspace response validation", () => {
  it("projects independent browser-safe copies without rewriting stored timestamps", () => {
    const response = {
      ...SNAPSHOT,
      providerMetadata: "not part of the domain",
      profile: { ...SNAPSHOT.profile, providerMetadata: "not part of the domain" },
      projects: SNAPSHOT.projects.map((project) => ({ ...project, providerMetadata: "hidden" })),
      todos: [{ ...TODO, providerMetadata: "hidden" }],
    };
    const parsed = readTodoWorkspaceSnapshot(response);
    expect(parsed).toEqual(SNAPSHOT);
    expect(parsed?.todos[0]).not.toBe(response.todos[0]);
    expect(parsed?.profile).not.toBe(response.profile);
    expect(parsed?.projects[0]).not.toBe(response.projects[0]);
    response.todos[0]!.text = "Mutated by the provider later";
    expect(parsed?.todos[0]?.text).toBe(TODO.text);
  });

  it.each([
    ["missing object", null],
    ["invalid ID", { ...TODO, id: "todo-2" }],
    ["missing text", { ...TODO, text: undefined }],
    ["blank text", { ...TODO, text: " \n" }],
    ["non-boolean completion", { ...TODO, completed: "false" }],
    ["missing completion timestamp", { ...TODO, completed: true }],
    ["unexpected completion timestamp", { ...TODO, completedAt: TODO.createdAt }],
    ["invalid date", { ...TODO, dueDate: "2026-02-30" }],
    ["date with trailing newline", { ...TODO, dueDate: "2026-09-02\n" }],
    ["missing due date", { ...TODO, dueDate: undefined }],
    ["invalid time", { ...TODO, dueTime: "25:00" }],
    ["missing due time", { ...TODO, dueTime: undefined }],
    ["time without date", { ...TODO, dueDate: null, dueTime: "09:00" }],
    ["invalid project ID", { ...TODO, projectId: "project-1" }],
    ["missing project ID", { ...TODO, projectId: undefined }],
    ["non-finite rank", { ...TODO, todayRank: Infinity }],
    ["fractional rank", { ...TODO, todayRank: 1.5 }],
    ["unsafe rank", { ...TODO, todayRank: Number.MAX_SAFE_INTEGER + 1 }],
    ["zero rank", { ...TODO, todayRank: 0 }],
    ["missing rank", { ...TODO, todayRank: undefined }],
    ["invalid created-at", { ...TODO, createdAt: "2026-02-30T12:00:00Z" }],
    ["missing updated-at", { ...TODO, updatedAt: undefined }],
  ])("rejects a Todo with %s", (_label, value) => {
    expect(readTodoResponse(value)).toBeNull();
  });

  it.each([
    ["missing profile", { ...SNAPSHOT, profile: null }],
    ["invalid profile owner", { ...SNAPSHOT, profile: { ...SNAPSHOT.profile, userId: "user-1" } }],
    ["invalid timezone", { ...SNAPSHOT, profile: { ...SNAPSHOT.profile, timezone: "Not/A_Zone" } }],
    ["offset instead of IANA timezone", { ...SNAPSHOT, profile: { ...SNAPSHOT.profile, timezone: "+01:00" } }],
    ["whitespace timezone", { ...SNAPSHOT, profile: { ...SNAPSHOT.profile, timezone: "UTC\n" } }],
    ["invalid profile timestamp", { ...SNAPSHOT, profile: { ...SNAPSHOT.profile, updatedAt: "yesterday" } }],
    ["invalid project shape", { ...SNAPSHOT, projects: [{ ...SNAPSHOT.projects[0], title: null }] }],
    ["duplicate projects", { ...SNAPSHOT, projects: [...SNAPSHOT.projects, ...SNAPSHOT.projects] }],
    ["duplicate todos", { ...SNAPSHOT, todos: [TODO, TODO] }],
    ["non-array rows", { ...SNAPSHOT, todos: {} }],
    ["sparse rows", { ...SNAPSHOT, todos: new Array(1) }],
  ])("rejects a workspace with %s", (_label, value) => {
    expect(readTodoWorkspaceSnapshot(value)).toBeNull();
  });
});

describe("exact Todo temporal values", () => {
  it.each([
    ["09:00", "09:00:00.000000"],
    ["09:00:00", "09:00:00.000000"],
    ["09:00:00.1", "09:00:00.100000"],
    ["09:00:00.000001", "09:00:00.000001"],
    ["23:59:59.999999", "23:59:59.999999"],
  ])("canonicalizes %s without losing microseconds", (value, expected) => {
    expect(canonicalLocalTime(value)).toBe(expected);
  });

  it.each([null, undefined, "9:00", "24:00", "09:60", "09:00.1", "09:00:00.1234567", "09:00\n"])(
    "rejects invalid local time %j",
    (value) => expect(canonicalLocalTime(value)).toBeNull(),
  );

  it("compares equivalent SQL time forms but distinguishes microseconds", () => {
    const todo = { ...TODO, dueTime: "09:00:00.100000" };
    expect(todoMatchesDetails(todo, { dueDate: TODO.dueDate!, dueTime: "09:00:00.1" })).toBe(true);
    expect(todoMatchesDetails(todo, { dueDate: TODO.dueDate!, dueTime: "09:00:00.100001" })).toBe(false);
    expect(todoMatchesDetails(todo, { dueTime: null })).toBe(false);
  });

  it.each([
    "2026-09-02T13:00:00Z",
    "2026-09-02T13:00:00.123456Z",
    "2026-09-02T09:00:00.000001-04:00",
    "2024-02-29T23:59:59.9+05:30",
  ])("accepts an exact valid Undo timestamp %s", (value) => {
    expect(isDeleteUndoToken(value)).toBe(true);
  });

  it.each([null, undefined, "", "not-a-timestamp", "2026-02-30T12:00:00Z", "2026-09-02T24:00:00Z", "2026-09-02T13:00:00.1234567Z", "2026-09-02T13:00:00Z\n", new Date()])(
    "rejects an invalid Undo timestamp %j",
    (value) => expect(isDeleteUndoToken(value)).toBe(false),
  );
});
