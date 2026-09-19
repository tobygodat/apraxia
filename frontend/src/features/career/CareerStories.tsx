import { useEffect, useState } from "react";
import { MarkdownField } from "./markdown/MarkdownField";
import { tagsOf } from "./careerPresentation";
import type { CareerService, CareerStory, CareerStoryUse } from "./careerService";
import { useCareerRun } from "./useCareerRun";

/**
 * The behaviourals. A story belongs to the account, not to a company: it is
 * written once and told wherever it fits, so this list is the same on every
 * application and each row says where it has already been used.
 */
export function CareerStories({
  userId,
  applicationId,
  service,
}: {
  userId: string;
  applicationId: string;
  service: CareerService;
}) {
  const [stories, setStories] = useState<CareerStory[]>([]);
  const [uses, setUses] = useState<CareerStoryUse[]>([]);
  const [companies, setCompanies] = useState<ReadonlyMap<string, string>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const { busy, error, run } = useCareerRun("Couldn’t save this story. Try again.");
  useEffect(() => {
    void run("Loading behaviorals…", async (signal) => {
      const [rows, told, applications] = await Promise.all([
        service.listStories(userId, signal),
        service.listStoryUses(userId, signal),
        service.listApplications(userId, signal),
      ]);
      if (!signal.aborted) {
        setStories(rows);
        setUses(told);
        setCompanies(new Map(applications.map((row) => [row.id, row.company])));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, userId]);
  const replace = (story: CareerStory) =>
    setStories((rows) => [...rows.filter((row) => row.id !== story.id), story]);
  const save = (story: Partial<CareerStory> & { title: string; body: string }, label: string) =>
    run(label, async (signal) => {
      const row = await service.saveStory(userId, story, signal);
      if (!signal.aborted) replace(row);
    });

  const tags = tagsOf(stories);
  const shown = (tag ? stories.filter((story) => story.tags.includes(tag)) : stories).sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
  );

  function where(storyId: string): string {
    const told = uses.filter((use) => use.storyId === storyId);
    if (!told.length) return "not used yet";
    const names = told.map((use) => companies.get(use.applicationId)).filter(Boolean);
    return names.length ? `used at ${names.join(", ")}` : `used at ${told.length} companies`;
  }

  return (
    <>
      <div className="career-tab__section-head">
        <h2 className="paper-heading career-tab__heading">behaviorals</h2>
        <span className="career-tab__aside">written once, reused at every company</span>
      </div>
      {tags.length > 0 && (
        <div className="career-app-tags">
          <span className="career-app-tags__label">tags</span>
          <button
            type="button"
            className={`paper-nav__item career-app-tags__tag${
              tag === null ? " paper-nav__item--current" : ""
            }`}
            onClick={() => setTag(null)}
          >
            all
          </button>
          {tags.map((name) => (
            <button
              key={name}
              type="button"
              className={`paper-nav__item career-app-tags__tag${
                tag === name ? " paper-nav__item--current" : ""
              }`}
              onClick={() => setTag(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="career-app-rows">
        {shown.map((story) => {
          const usedHere = uses.some(
            (use) => use.storyId === story.id && use.applicationId === applicationId,
          );
          return (
            <div key={story.id} className="paper-row career-app-row career-app-row--stacked">
              <p className="career-app-row__body paper-measure">{story.title}</p>
              <p className="paper-row__meta career-app-row__tags">
                {[...story.tags, where(story.id)].filter(Boolean).join(" · ")}
                <button
                  type="button"
                  className="paper-action paper-action--quiet career-app-row__toggle"
                  onClick={() => setOpen(open === story.id ? null : story.id)}
                >
                  {open === story.id ? "hide" : "show"}
                </button>
                <button
                  type="button"
                  className="paper-action paper-action--quiet"
                  disabled={!!busy}
                  onClick={() =>
                    void run(usedHere ? "Removing…" : "Marking it told here…", async (signal) => {
                      if (usedHere) {
                        await service.removeStoryUse(userId, story.id, applicationId, signal);
                        if (!signal.aborted)
                          setUses((rows) =>
                            rows.filter(
                              (use) =>
                                use.storyId !== story.id || use.applicationId !== applicationId,
                            ),
                          );
                        return;
                      }
                      const use = await service.recordStoryUse(
                        userId,
                        { storyId: story.id, applicationId, usedOn: null },
                        signal,
                      );
                      if (!signal.aborted) setUses((rows) => [...rows, use]);
                    })
                  }
                >
                  {usedHere ? "not told here" : "told here"}
                </button>
              </p>
              {open === story.id && (
                <div className="career-app-row__answer paper-measure">
                  <MarkdownField
                    value={story.body}
                    label={`the story ${story.title}`}
                    placeholder="situation, what you did, the result"
                    minRows={5}
                    onCommit={(next) =>
                      void save({ id: story.id, title: story.title, body: next }, "Saving…")
                    }
                  />
                  <p className="career-app-row__editor-actions">
                    <button
                      type="button"
                      className="paper-action paper-action--danger"
                      disabled={!!busy}
                      onClick={() =>
                        void run("Removing the story…", async (signal) => {
                          await service.removeStory(userId, story.id, signal);
                          if (!signal.aborted) {
                            setStories((rows) => rows.filter((row) => row.id !== story.id));
                            setUses((rows) => rows.filter((use) => use.storyId !== story.id));
                            setOpen(null);
                          }
                        })
                      }
                    >
                      remove this story
                    </button>
                  </p>
                </div>
              )}
            </div>
          );
        })}
        <div className="paper-row career-app-row career-app-row--add">
          {adding ? (
            <form
              className="career-app-row__add-stack"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim()) return;
                void save(
                  {
                    title,
                    // The story itself is written in the field once the row is
                    // there, so a new one starts with the shape it will take.
                    body: "**situation** · \n\n**what i did** · \n\n**result** · ",
                    tags: tagsText
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                  "Adding the story…",
                ).then(() => {
                  setTitle("");
                  setTagsText("");
                  setAdding(false);
                });
              }}
            >
              <input
                className="paper-field"
                value={title}
                autoFocus
                required
                placeholder="the search rewrite i argued against"
                aria-label="what the story is about"
                onChange={(event) => setTitle(event.target.value)}
              />
              <div className="career-app-row__line">
                <input
                  className="paper-field career-app-row__add-name"
                  value={tagsText}
                  placeholder="conflict, influence"
                  aria-label="tags, separated by commas"
                  onChange={(event) => setTagsText(event.target.value)}
                />
                <button type="submit" className="paper-action" disabled={!!busy}>
                  add
                </button>
                <button
                  type="button"
                  className="paper-action paper-action--quiet"
                  onClick={() => setAdding(false)}
                >
                  cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="paper-action" onClick={() => setAdding(true)}>
              write a behavioral
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
