import { useEffect, useState } from "react";
import { CareerStories } from "./CareerStories";
import { MarkdownField } from "./markdown/MarkdownField";
import { dateTiming, orderPrep, tagsOf, type Timing } from "./careerPresentation";
import type { CareerPrepItem, CareerQuestion, CareerService } from "./careerService";
import { useCareerRun } from "./useCareerRun";

/**
 * What there is to do before the next round, the questions this company asks,
 * and the behavioural stories. A question's tags are what make it findable at
 * the next company, so the tag row doubles as a filter here and a search across
 * every application.
 */
export function CareerPrepTab({
  userId,
  applicationId,
  service,
  today,
}: {
  userId: string;
  applicationId: string;
  service: CareerService;
  today: string;
}) {
  return (
    <div className="career-tab">
      <PrepList userId={userId} applicationId={applicationId} service={service} today={today} />
      <Questions userId={userId} applicationId={applicationId} service={service} />
      <CareerStories userId={userId} applicationId={applicationId} service={service} />
    </div>
  );
}

function PrepList({
  userId,
  applicationId,
  service,
  today,
}: {
  userId: string;
  applicationId: string;
  service: CareerService;
  today: string;
}) {
  const [items, setItems] = useState<CareerPrepItem[]>([]);
  const [body, setBody] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [adding, setAdding] = useState(false);
  const { busy, error, run } = useCareerRun("Couldn’t save this prep item. Try again.");
  useEffect(() => {
    void run("Loading prep…", async (signal) => {
      const rows = await service.listPrep(userId, applicationId, signal);
      if (!signal.aborted) setItems(rows);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, userId, applicationId]);
  const replace = (item: CareerPrepItem) =>
    setItems((rows) => [...rows.filter((row) => row.id !== item.id), item]);
  const save = (item: Partial<CareerPrepItem> & { body: string }, label: string) =>
    run(label, async (signal) => {
      const row = await service.savePrep(userId, applicationId, item, signal);
      if (!signal.aborted) replace(row);
    });

  return (
    <>
      <h2 className="paper-heading career-tab__heading">prep</h2>
      <div className="career-app-rows">
        {orderPrep(items).map((item) => {
          const timing = dateTiming(item.dueOn, today, "");
          return (
            <div
              key={item.id}
              className={`paper-row career-app-row${item.doneAt ? " career-app-row--done" : ""}`}
            >
              <div className="career-app-row__line">
                <input
                  className="paper-check"
                  type="checkbox"
                  checked={!!item.doneAt}
                  aria-label={`${item.body} done`}
                  disabled={!!busy}
                  onChange={(event) =>
                    void save(
                      {
                        id: item.id,
                        body: item.body,
                        doneAt: event.target.checked ? new Date().toISOString() : null,
                      },
                      event.target.checked ? "Ticking off…" : "Reopening…",
                    )
                  }
                />
                <span className="career-app-row__name">{item.body}</span>
                <DueCell
                  label={item.body}
                  value={item.dueOn}
                  timing={timing}
                  done={!!item.doneAt}
                  onChange={(next) =>
                    void save({ id: item.id, body: item.body, dueOn: next }, "Saving the date…")
                  }
                />
                <button
                  type="button"
                  className="paper-action paper-action--quiet career-app-row__remove"
                  disabled={!!busy}
                  onClick={() =>
                    void run("Removing…", async (signal) => {
                      await service.removePrep(userId, item.id, signal);
                      if (!signal.aborted)
                        setItems((rows) => rows.filter((row) => row.id !== item.id));
                    })
                  }
                >
                  remove
                </button>
              </div>
            </div>
          );
        })}
        <div className="paper-row career-app-row career-app-row--add">
          {adding ? (
            <form
              className="career-app-row__line career-app-row__add-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!body.trim()) return;
                void save(
                  {
                    body,
                    dueOn: dueOn || null,
                    position: items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0,
                  },
                  "Adding…",
                ).then(() => {
                  setBody("");
                  setDueOn("");
                });
              }}
            >
              <input
                className="paper-field career-app-row__add-name"
                value={body}
                autoFocus
                required
                placeholder="re-read the payments primer"
                aria-label="prep item"
                onChange={(event) => setBody(event.target.value)}
              />
              <input
                className="paper-field"
                type="date"
                value={dueOn}
                aria-label="prep item due"
                onChange={(event) => setDueOn(event.target.value)}
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
            </form>
          ) : (
            <button type="button" className="paper-action" onClick={() => setAdding(true)}>
              add prep item
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

function Questions({
  userId,
  applicationId,
  service,
}: {
  userId: string;
  applicationId: string;
  service: CareerService;
}) {
  const [questions, setQuestions] = useState<CareerQuestion[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  /** Rows from every application carrying the chosen tag, once asked for. */
  const [across, setAcross] = useState<CareerQuestion[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [tagsText, setTagsText] = useState("");
  const { busy, error, run } = useCareerRun("Couldn’t save this question. Try again.");
  useEffect(() => {
    void run("Loading questions…", async (signal) => {
      const rows = await service.listQuestions(userId, applicationId, signal);
      if (!signal.aborted) setQuestions(rows);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, userId, applicationId]);
  const replace = (question: CareerQuestion) =>
    setQuestions((rows) => [...rows.filter((row) => row.id !== question.id), question]);
  const save = (question: Partial<CareerQuestion> & { body: string }, label: string) =>
    run(label, async (signal) => {
      const row = await service.saveQuestion(userId, applicationId, question, signal);
      if (!signal.aborted) replace(row);
    });

  const tags = tagsOf(questions);
  const mine = tag ? questions.filter((row) => row.tags.includes(tag)) : questions;
  const shown = across ?? mine;
  const elsewhere = across?.filter((row) => row.applicationId !== applicationId).length ?? 0;

  return (
    <>
      <h2 className="paper-heading career-tab__heading">questions</h2>
      {(tags.length > 0 || across) && (
        <div className="career-app-tags">
          <span className="career-app-tags__label">tags</span>
          <button
            type="button"
            className={`paper-nav__item career-app-tags__tag${
              tag === null ? " paper-nav__item--current" : ""
            }`}
            onClick={() => {
              setTag(null);
              setAcross(null);
            }}
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
              onClick={() => {
                setTag(name);
                setAcross(null);
              }}
            >
              {name}
            </button>
          ))}
          <span className="career-app-tags__spacer" />
          {tag && (
            <button
              type="button"
              className="paper-action paper-action--quiet"
              disabled={!!busy}
              onClick={() => {
                if (across) {
                  setAcross(null);
                  return;
                }
                void run("Searching every application…", async (signal) => {
                  const rows = await service.listQuestionsByTag(userId, tag, signal);
                  if (!signal.aborted) setAcross(rows);
                });
              }}
            >
              {across ? "this company only" : "across all companies"}
            </button>
          )}
        </div>
      )}
      {across && (
        <p className="career-tab__aside" role="status">
          {elsewhere
            ? `${elsewhere} more tagged ${tag} at other companies`
            : `nothing else tagged ${tag} yet`}
        </p>
      )}
      <div className="career-app-rows">
        {shown.map((question) => (
          <div key={question.id} className="paper-row career-app-row career-app-row--stacked">
            <p className="career-app-row__body paper-measure">{question.body}</p>
            <p className="paper-row__meta career-app-row__tags">
              {[
                ...question.tags,
                question.answer ? "answered" : "to prepare",
                across && question.applicationId !== applicationId ? "another company" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              <button
                type="button"
                className="paper-action paper-action--quiet career-app-row__toggle"
                onClick={() => setOpen(open === question.id ? null : question.id)}
              >
                {open === question.id ? "hide answer" : question.answer ? "show answer" : "answer"}
              </button>
              {question.applicationId === applicationId && (
                <button
                  type="button"
                  className="paper-action paper-action--quiet career-app-row__remove"
                  disabled={!!busy}
                  onClick={() =>
                    void run("Removing…", async (signal) => {
                      await service.removeQuestion(userId, question.id, signal);
                      if (!signal.aborted) {
                        setQuestions((rows) => rows.filter((row) => row.id !== question.id));
                        setAcross((rows) =>
                          rows ? rows.filter((row) => row.id !== question.id) : rows,
                        );
                      }
                    })
                  }
                >
                  remove
                </button>
              )}
            </p>
            {open === question.id && (
              <div className="career-app-row__answer paper-measure">
                <MarkdownField
                  value={question.answer ?? ""}
                  label={`answer to ${question.body}`}
                  placeholder="write the answer"
                  minRows={4}
                  disabled={question.applicationId !== applicationId}
                  onCommit={(next) =>
                    void save(
                      { id: question.id, body: question.body, answer: next || null },
                      "Saving the answer…",
                    )
                  }
                />
              </div>
            )}
          </div>
        ))}
        <div className="paper-row career-app-row career-app-row--add">
          {adding ? (
            <form
              className="career-app-row__add-stack"
              onSubmit={(event) => {
                event.preventDefault();
                if (!body.trim()) return;
                void save(
                  {
                    body,
                    tags: tagsText
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                  "Adding the question…",
                ).then(() => {
                  setBody("");
                  setTagsText("");
                });
              }}
            >
              <input
                className="paper-field"
                value={body}
                autoFocus
                required
                placeholder="how would you make a payment endpoint safe to retry?"
                aria-label="question"
                onChange={(event) => setBody(event.target.value)}
              />
              <div className="career-app-row__line">
                <input
                  className="paper-field career-app-row__add-name"
                  value={tagsText}
                  placeholder="technical, systems"
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
              add question
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

/**
 * A row's due date: the date as it reads, until you reach for it. A native date
 * field shows `09/16/2026` and its own picker button, which would put a second
 * date on a row that already says "sep 16 · 3 days late", so the field is only
 * there while it is being set.
 */
function DueCell({
  label,
  value,
  timing,
  done,
  onChange,
}: {
  label: string;
  value: string | null;
  timing: Timing;
  done: boolean;
  onChange(next: string | null): void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <label className="career-app-row__due">
        <span className="cloud-shell__sr-only">{`${label} due`}</span>
        <input
          className="paper-field career-app-row__due-field"
          type="date"
          autoFocus
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") setEditing(false);
          }}
        />
      </label>
    );
  return (
    <button
      type="button"
      className={`paper-action paper-action--quiet paper-row__meta career-app-row__when${
        timing.late && !done ? " paper-row__meta--late" : ""
      }`}
      onClick={() => setEditing(true)}
    >
      {timing.label || "no date"}
    </button>
  );
}
