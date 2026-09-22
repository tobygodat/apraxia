import { useEffect, useMemo, useRef, useState } from "react";
import { useColdLoad } from "../../apps/coldLoad";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { CAREER_STAGES, countByStage, type CareerStage } from "./careerOrdering";
import type { CareerApplicationRow, CareerService } from "./careerService";
import {
  CAREER_COLUMNS,
  CAREER_FILTERS,
  CLOSED_STAGES,
  careerSummary,
  formatCareerDate,
  matchesStageFilter,
  nextSort,
  nextStepLabel,
  sortApplications,
  type CareerSort,
  type CareerStageFilter,
} from "./careerPresentation";
import "./career.css";
import "./careerPaper.css";
import "./careerCrisp.css";

interface Props {
  service: CareerService;
  userId: string;
  /** Today in the profile's timezone, so "3 days late" means today's three. */
  today: string;
  onOpenApplication(id: string): void;
}

/** What the right-hand line says the table is ordered by. */
const ORDER_LABELS: Record<string, string> = {
  company: "company",
  role: "role",
  applied: "date applied",
  stage: "stage",
  next: "next step",
};

export function CareerPage({ service, userId, today, onOpenApplication }: Props) {
  const [rows, setRows] = useState<CareerApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<CareerStageFilter>("");
  const [sort, setSort] = useState<CareerSort | null>(null);
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const companyRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  useColdLoad(loading);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    service
      .listApplications(userId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted || !mounted.current) return;
        setRows(loaded);
        setError("");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        setError(messageOf(cause, "Couldn’t load your applications. Try again."));
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      });
    return () => controller.abort();
  }, [service, userId, revision]);

  // The line under the heading counts every application, not the filtered ones:
  // it is what the page is about, and it should not move when a filter does.
  const counts = useMemo(() => countByStage(rows), [rows]);
  const visible = useMemo(
    () =>
      sortApplications(
        rows.filter((row) => matchesStageFilter(row.stage, filter)),
        sort,
      ),
    [rows, filter, sort],
  );

  // The add row opens with the cursor in it, and closing it hands focus back to
  // the word that opened it rather than dropping it on the document.
  useEffect(() => {
    if (adding) companyRef.current?.focus();
  }, [adding]);

  async function changeStage(row: CareerApplicationRow, stage: CareerStage) {
    setBusy(true);
    try {
      await service.updateApplication(userId, row.id, { stage }, new AbortController().signal);
      if (mounted.current) {
        setRows((current) => current.map((r) => (r.id === row.id ? { ...r, stage } : r)));
        setError("");
      }
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause, "Couldn’t change the stage. Try again."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function addApplication() {
    const draft = { company: company.trim(), role: role.trim() };
    if (!draft.company || !draft.role) return;
    setBusy(true);
    try {
      const created = await service.createApplication(userId, draft, new AbortController().signal);
      if (mounted.current) {
        setRows((current) => [...current, { ...created, nextStep: null }]);
        setCompany("");
        setRole("");
        setAdding(false);
        setError("");
        // Focus lands back on the word that opened the row, after it re-renders.
        window.requestAnimationFrame(() => addRef.current?.focus());
      }
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause, "Couldn’t add this application. Try again."));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const ordered = sort ? ORDER_LABELS[sort.key] : ORDER_LABELS.next;

  return (
    <section className="career-page">
      <header className="career-heading workspace-page-header">
        <div>
          <h1 tabIndex={-1}>Career</h1>
          <p className="career-summary">{careerSummary(counts)}</p>
        </div>
      </header>

      {error && (
        <div className="workspace-error" role="alert">
          <p>{error}</p>
          <button onClick={() => setRevision((value) => value + 1)}>Retry</button>
        </div>
      )}
      {loading && (
        <p className="cloud-shell__sr-only" role="status" aria-live="polite">
          Loading…
        </p>
      )}

      <div className="career-controls">
        <span className="career-controls__label" id="career-stage-filter-label">
          Stage
        </span>
        <div className="career-filter" role="group" aria-labelledby="career-stage-filter-label">
          {CAREER_FILTERS.map(([value, label]) => {
            const current = filter === value;
            return (
              <button
                key={value || "all"}
                type="button"
                className={`career-filter__word paper-nav__item${
                  current ? " paper-nav__item--current" : ""
                }`}
                aria-pressed={current}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="career-order">
          Sorted by {ordered}
          {sort && (
            <>
              {" · "}
              <button
                type="button"
                className="career-order__reset paper-action paper-action--quiet"
                onClick={() => setSort(null)}
              >
                Reset
              </button>
            </>
          )}
        </p>
      </div>

      <div className="career-scroll">
        <table className="career-table">
          <caption className="cloud-shell__sr-only">
            Applications, sorted by {ordered}. Each column header sorts the table.
          </caption>
          <thead>
            <tr>
              {CAREER_COLUMNS.map((column) => {
                const current = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={`career-column career-column--${column.key}${
                      column.align === "right" ? " career-column--right" : ""
                    }`}
                    aria-sort={
                      current ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <button
                      type="button"
                      className={`career-sort${current ? " career-sort--current" : ""}`}
                      onClick={() => setSort((value) => nextSort(value, column.key))}
                    >
                      <span>{column.label}</span>
                      {current && <WorkspaceIcon name={sort.direction === "asc" ? "up" : "down"} />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const next = nextStepLabel(row.nextStep, today);
              const closed = CLOSED_STAGES.includes(row.stage);
              return (
                <tr key={row.id} className={`career-row${closed ? " career-row--closed" : ""}`}>
                  <td className="career-cell career-cell--company">
                    <button
                      type="button"
                      className="career-open"
                      onClick={() => onOpenApplication(row.id)}
                    >
                      {row.company}
                    </button>
                  </td>
                  <td className="career-cell career-cell--role">{row.role}</td>
                  <td className="career-cell career-cell--applied">
                    {row.appliedOn ? formatCareerDate(row.appliedOn) : ""}
                  </td>
                  <td className="career-cell career-cell--stage">
                    <select
                      className="career-stage"
                      aria-label={`Stage for ${row.company}`}
                      value={row.stage}
                      data-stage={row.stage}
                      disabled={busy}
                      onChange={(event) => void changeStage(row, event.target.value as CareerStage)}
                    >
                      {CAREER_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {stage}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="career-cell career-cell--next">
                    {next && (
                      <>
                        <span className="career-next__name">{next.name}</span>
                        {" · "}
                        <span
                          className={`career-next__when${
                            next.late ? " career-next__when--late" : ""
                          }`}
                        >
                          {next.when}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && !rows.length && (
        <p className="career-empty">Nothing here yet. Add the first company you are applying to.</p>
      )}
      {!loading && rows.length > 0 && !visible.length && (
        <p className="career-empty">No applications at this stage.</p>
      )}

      {adding ? (
        <form
          className="career-add career-add--open"
          onSubmit={(event) => {
            event.preventDefault();
            void addApplication();
          }}
        >
          <input
            ref={companyRef}
            className="career-add__field paper-field"
            aria-label="Company"
            placeholder="Company"
            value={company}
            maxLength={120}
            onChange={(event) => setCompany(event.target.value)}
          />
          <input
            className="career-add__field paper-field"
            aria-label="Role"
            placeholder="Role"
            value={role}
            maxLength={160}
            onChange={(event) => setRole(event.target.value)}
          />
          <button
            type="submit"
            className="paper-button paper-button--primary"
            disabled={busy || !company.trim() || !role.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="paper-action paper-action--quiet"
            disabled={busy}
            onClick={() => {
              setAdding(false);
              setCompany("");
              setRole("");
              addRef.current?.focus();
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="career-add">
          <button
            ref={addRef}
            type="button"
            className="career-add__open paper-button paper-button--primary"
            onClick={() => setAdding(true)}
          >
            <WorkspaceIcon name="plus" />
            Add application
          </button>
        </div>
      )}
    </section>
  );
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default CareerPage;
