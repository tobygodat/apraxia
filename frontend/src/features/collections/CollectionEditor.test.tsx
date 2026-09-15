// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Idea, MediaItem, Project } from "../../types/domain";
import { CollectionEditor } from "./CollectionEditor";
import { ideaTitle, type CollectionService } from "./collectionService";
afterEach(cleanup);
const idea: Idea = {
  id: "idea",
  title: null,
  body: "First thought\nMore details",
  projectId: "deleted-project",
  createdAt: "",
  updatedAt: "",
};
describe("Collection editor", () => {
  it.each(["active", "someday", "completed", "archived"] as const)(
    "keeps a saved %s project intact while editing without a classification field",
    async (status) => {
      const record: Project = {
        id: "p",
        title: "Home",
        description: "Make space",
        status,
        createdAt: "",
        updatedAt: "",
      };
      const saveProject = vi.fn().mockResolvedValue(record);
      render(
        <CollectionEditor
          kind="project"
          record={record}
          projects={[]}
          service={{ saveProject } as unknown as CollectionService}
          onSaved={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.queryByLabelText("Status")).toBeNull();
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Reading room" } });
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(saveProject).toHaveBeenCalledWith(
          { title: "Reading room", description: "Make space", status },
          "p",
        ),
      );
    },
  );
  it("creates a project from title and description alone", async () => {
    const saveProject = vi.fn().mockResolvedValue({ id: "p" });
    render(
      <CollectionEditor
        kind="project"
        projects={[]}
        service={{ saveProject } as unknown as CollectionService}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Status")).toBeNull();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Reading room" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "Make space" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() =>
      expect(saveProject).toHaveBeenCalledWith(
        { title: "Reading room", description: "Make space", status: "active" },
        undefined,
      ),
    );
  });
  it("preserves titleless ideas and unavailable project associations on an unrelated edit", async () => {
    const saveIdea = vi.fn().mockResolvedValue(idea);
    const onSaved = vi.fn();
    render(
      <CollectionEditor
        kind="idea"
        record={idea}
        projects={[]}
        service={{ saveIdea } as unknown as CollectionService}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Idea"));
    expect(ideaTitle(idea)).toBe("First thought");
    fireEvent.change(screen.getByLabelText("Idea"), { target: { value: "Changed thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(idea));
    expect(saveIdea).toHaveBeenCalledWith(
      { title: "", body: "Changed thought", projectId: "deleted-project" },
      "idea",
    );
  });
  it("retains entered text after a failed save and allows retry", async () => {
    const saveIdea = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue(idea);
    const onSaved = vi.fn();
    render(
      <CollectionEditor
        kind="idea"
        projects={[]}
        service={{ saveIdea } as unknown as CollectionService}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Idea"), { target: { value: "Remember this" } });
    fireEvent.click(screen.getByRole("button", { name: "Add idea" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Idea") as HTMLTextAreaElement).value).toBe("Remember this");
    fireEvent.click(screen.getByRole("button", { name: "Add idea" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
  it("preserves a previously stored rating outside the new whole-star choices", async () => {
    const item: MediaItem = {
      id: "film",
      title: "Film",
      mediaType: "movie",
      creator: null,
      releaseYear: null,
      status: "saved",
      rating: 8.5,
      notes: null,
      createdAt: "",
      updatedAt: "",
    };
    const saveMedia = vi.fn().mockResolvedValue(item);
    render(
      <CollectionEditor
        kind="media"
        record={item}
        projects={[]}
        service={{ saveMedia } as unknown as CollectionService}
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A film" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(saveMedia).toHaveBeenCalledWith(
        expect.objectContaining({ rating: 8.5, title: "A film" }),
        "film",
      ),
    );
  });
  it("does not notify a removed editor when a pending write finishes", async () => {
    let resolve!: (value: Idea) => void;
    const saveIdea = vi.fn(
      () =>
        new Promise<Idea>((done) => {
          resolve = done;
        }),
    );
    const onSaved = vi.fn();
    const view = render(
      <CollectionEditor
        kind="idea"
        record={idea}
        projects={[]}
        service={{ saveIdea } as unknown as CollectionService}
        onSaved={onSaved}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    view.unmount();
    resolve(idea);
    await Promise.resolve();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
