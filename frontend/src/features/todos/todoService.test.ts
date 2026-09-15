import { describe, expectTypeOf, it } from "vitest";
import type { TodoService, UpdateTodoDetailsInput } from "./todoService";

describe("TodoService contract", () => {
  it("keeps the adapter browser-facing and provider-neutral", () => {
    expectTypeOf<TodoService["createTodo"]>().parameter(0).toMatchTypeOf<{
      text: string;
      dueDate?: string | null;
      dueTime?: string | null;
      projectId?: string | null;
    }>();
    expectTypeOf<TodoService["reorderToday"]>().parameter(1).toEqualTypeOf<readonly string[]>();
    expectTypeOf<TodoService["restoreTodo"]>().returns.toEqualTypeOf<Promise<boolean>>();
  });

  it("requires at least one intentional details field", () => {
    expectTypeOf<{ text: string }>().toMatchTypeOf<UpdateTodoDetailsInput>();
    expectTypeOf<{ dueDate: null; dueTime: null }>().toMatchTypeOf<UpdateTodoDetailsInput>();
    expectTypeOf<Record<string, never>>().not.toMatchTypeOf<UpdateTodoDetailsInput>();
    expectTypeOf<{ dueDate: null }>().not.toMatchTypeOf<UpdateTodoDetailsInput>();
    expectTypeOf<{ dueTime: "09:00" }>().not.toMatchTypeOf<UpdateTodoDetailsInput>();
    expectTypeOf<{
      dueDate: "2026-09-02";
      dueTime: "09:00";
    }>().toMatchTypeOf<UpdateTodoDetailsInput>();
  });
});
