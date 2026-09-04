// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionPage } from "./CollectionPage";
import type { CollectionService } from "./collectionService";
import type { TodoService } from "../todos/todoService";
afterEach(cleanup);
describe("Collection pages", () => {
    it("keeps Undo explicitly attached to deletion after a later record save", async () => {
        const project = { id: "p", title: "Home", description: "Make space", status: "active", createdAt: "", updatedAt: "" };
        const service = { listProjects: vi.fn().mockResolvedValue([project]), softDelete: vi.fn().mockResolvedValue("exact-token"), saveProject: vi.fn().mockResolvedValue(project) } as unknown as CollectionService;
        render(<CollectionPage kind="project" service={service} todoService={{} as TodoService} projects={[]} onChanged={vi.fn()}/>);
        fireEvent.click(await screen.findByRole("button", { name: "Delete Home" }));
        await screen.findByRole("button", { name: "Undo deletion" });
        fireEvent.click(screen.getByRole("button", { name: /Home Make space active/ }));
        fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
        await screen.findByText("Saved.");
        expect(screen.getByRole("button", { name: "Undo deletion" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });
    it("hides an unavailable project badge without losing the idea and restores it with the project", async () => {
        const listIdeas = vi.fn().mockResolvedValue([{ id: "idea", title: "Keep this thought", body: "Details", projectId: "project", createdAt: "", updatedAt: "" }]);
        const service = { listIdeas } as unknown as CollectionService;
        const props = { kind: "idea" as const, service, todoService: {} as TodoService, onChanged: vi.fn() };
        const view = render(<CollectionPage {...props} projects={[{ id: "project", title: "Garden" }]}/>);
        await screen.findByText("Garden");
        view.rerender(<CollectionPage {...props} projects={[]}/>);
        expect(screen.queryByText("Garden")).toBeNull();
        expect(screen.getByText("Keep this thought")).toBeTruthy();
        view.rerender(<CollectionPage {...props} projects={[{ id: "project", title: "Garden" }]}/>);
        expect(screen.getByText("Garden")).toBeTruthy();
    });
    it("loads another 50-record page without dropping the first page or duplicating rows", async () => {
        const records = Array.from({ length: 51 }, (_, index) => ({ id: `idea-${index}`, title: `Thought ${index}`, body: "Notes", projectId: null, createdAt: "", updatedAt: "" }));
        const listIdeas = vi.fn((options: { offset: number }) => Promise.resolve(records.slice(options.offset, options.offset + 50)));
        render(<CollectionPage kind="idea" service={{ listIdeas } as unknown as CollectionService} todoService={{} as TodoService} projects={[]} onChanged={vi.fn()}/>);
        fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
        await screen.findByText("Thought 50");
        expect(screen.getAllByRole("listitem")).toHaveLength(51);
        expect(screen.getAllByText("Thought 0")).toHaveLength(1);
        expect(listIdeas).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }));
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });
    it("keeps Media filters independent and passes them to the list service", async () => {
        const listMedia = vi.fn().mockResolvedValue([]);
        render(<CollectionPage kind="media" service={{ listMedia } as unknown as CollectionService} todoService={{} as TodoService} projects={[]} onChanged={vi.fn()}/>);
        await screen.findByText("No books or movies in this view.");
        fireEvent.change(screen.getByLabelText("Type"), { target: { value: "movie" } });
        fireEvent.change(screen.getByLabelText("Status"), { target: { value: "finished" } });
        await waitFor(() => expect(listMedia).toHaveBeenLastCalledWith(expect.objectContaining({ mediaType: "movie", status: "finished", offset: 0 })));
    });
    it("shows project tasks and ideas and deletes only the selected project with Undo", async () => {
        const project = { id: "p", title: "Home", description: "Make space", status: "active", createdAt: "", updatedAt: "" };
        const listProjects = vi.fn().mockResolvedValue([project]);
        const softDelete = vi.fn().mockResolvedValue("exact-token");
        const restore = vi.fn().mockResolvedValue(true);
        const onChanged = vi.fn();
        render(<CollectionPage kind="project" service={{ listProjects, softDelete, restore } as unknown as CollectionService} todoService={{} as TodoService} projects={[]} onChanged={onChanged}/>);
        fireEvent.click(await screen.findByRole("button", { name: "Delete Home" }));
        fireEvent.click(await screen.findByRole("button", { name: "Undo deletion" }));
        await waitFor(() => expect(restore).toHaveBeenCalledWith("project", "p", "exact-token"));
        expect(softDelete).toHaveBeenCalledWith("project", "p");
        expect(onChanged).toHaveBeenCalledTimes(2);
    });
    it("uses project context when creating an idea and presents completed tasks separately", async () => {
        const getProject = vi.fn().mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
        const projectTodos = vi.fn().mockResolvedValue([{ id: "t", text: "Finished action", completed: true, dueDate: null }]);
        const listIdeas = vi.fn().mockResolvedValue([]);
        render(<CollectionPage kind="project" recordId="p" service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService} todoService={{} as TodoService} projects={[{ id: "p", title: "Home" }]} onChanged={vi.fn()}/>);
        await screen.findByText("Completed tasks (1)");
        fireEvent.click(screen.getByRole("button", { name: "Add idea" }));
        expect((screen.getByLabelText("Project (optional)") as HTMLSelectElement).value).toBe("p");
    });
});
