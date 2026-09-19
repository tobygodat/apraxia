import { useEffect, useRef, useState } from "react";
import { resourceMeta } from "./careerPresentation";
import {
  isResourceReady,
  prepareFile,
  type CareerResource,
  type CareerService,
} from "./careerService";
import { useCareerRun } from "./useCareerRun";

/** What a browser will show in a tab; anything else is saved to disk instead. */
const VIEWABLE = ["application/pdf", "text/markdown", "text/plain"];

/**
 * The files sent to this company and the links worth keeping. Files come from
 * this computer only — there is no Drive picker here — and each one is reserved
 * as a row before it is uploaded, so an upload that dies halfway leaves a row
 * that says it did not finish rather than a file nothing points at.
 */
export function CareerResourcesTab({
  userId,
  applicationId,
  service,
}: {
  userId: string;
  applicationId: string;
  service: CareerService;
}) {
  const [resources, setResources] = useState<CareerResource[]>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const chooser = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useCareerRun("Couldn’t save this. Try again.");
  useEffect(() => {
    void run("Loading files and links…", async (signal) => {
      const rows = await service.listResources(userId, applicationId, signal);
      if (!signal.aborted) setResources(rows);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, userId, applicationId]);
  const replace = (resource: CareerResource) =>
    setResources((rows) => [...rows.filter((row) => row.id !== resource.id), resource]);

  function upload(file: File) {
    void run(`Uploading ${file.name}…`, async (signal) => {
      const draft = await prepareFile(file);
      signal.throwIfAborted();
      const reserved = await service.reserveFile(userId, applicationId, draft, signal);
      if (!signal.aborted) replace(reserved);
      const saved = await service.uploadFile(reserved, file, signal);
      if (!signal.aborted) replace(saved);
    });
  }

  function open(resource: CareerResource) {
    if (resource.kind === "link") {
      if (resource.url) window.open(resource.url, "_blank", "noopener,noreferrer");
      return;
    }
    void run(`Opening ${resource.title}…`, async (signal) => {
      const file = await service.downloadFile(resource, signal);
      if (signal.aborted) return;
      const href = URL.createObjectURL(file);
      const viewable = VIEWABLE.includes(resource.contentType ?? "");
      // A tab is nicer for something a browser can render, but a popup blocker
      // can refuse it, so a refused tab falls back to saving the file.
      if (!viewable || !window.open(href, "_blank", "noopener,noreferrer")) {
        const link = document.createElement("a");
        link.href = href;
        link.download = resource.title;
        link.click();
      }
      // Given to the tab or the download already; the object stays alive until
      // this document goes away, which is when the last reader is done with it.
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    });
  }

  const files = resources.filter((resource) => resource.kind === "file");
  const links = resources.filter((resource) => resource.kind === "link");

  return (
    <div className="career-tab">
      <input
        ref={chooser}
        className="cloud-shell__sr-only"
        type="file"
        accept=".pdf,.docx,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
        tabIndex={-1}
        aria-label="Choose a file to upload"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload(file);
        }}
      />
      <h2 className="paper-heading career-tab__heading">files</h2>
      <div className="career-rows">
        {files.map((resource) => (
          <ResourceRow
            key={resource.id}
            resource={resource}
            busy={!!busy}
            onOpen={() => open(resource)}
            onRemove={() =>
              void run(`Removing ${resource.title}…`, async (signal) => {
                await service.removeResource(userId, resource, signal);
                if (!signal.aborted)
                  setResources((rows) => rows.filter((row) => row.id !== resource.id));
              })
            }
          />
        ))}
        <div className="paper-row career-row career-row--add">
          <div className="career-row__line">
            <button
              type="button"
              className="paper-action"
              disabled={!!busy}
              onClick={() => {
                setError("");
                chooser.current?.click();
              }}
            >
              upload a file
            </button>
            <span className="paper-row__meta">
              from this computer · pdf, docx, md, txt · 25 MB each
            </span>
          </div>
        </div>
      </div>

      <h2 className="paper-heading career-tab__heading career-tab__heading--spaced">links</h2>
      <div className="career-rows">
        {links.map((resource) => (
          <ResourceRow
            key={resource.id}
            resource={resource}
            busy={!!busy}
            onOpen={() => open(resource)}
            onRemove={() =>
              void run(`Removing ${resource.title}…`, async (signal) => {
                await service.removeResource(userId, resource, signal);
                if (!signal.aborted)
                  setResources((rows) => rows.filter((row) => row.id !== resource.id));
              })
            }
          />
        ))}
        <div className="paper-row career-row career-row--add">
          {addingLink ? (
            <form
              className="career-row__add-stack"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim() || !url.trim()) return;
                void run("Saving the link…", async (signal) => {
                  const row = await service.addLink(userId, applicationId, { title, url }, signal);
                  if (!signal.aborted) {
                    replace(row);
                    setTitle("");
                    setUrl("");
                    setAddingLink(false);
                  }
                });
              }}
            >
              <input
                className="paper-field"
                value={title}
                autoFocus
                required
                placeholder="idempotent requests, in their docs"
                aria-label="what the link is"
                onChange={(event) => setTitle(event.target.value)}
              />
              <div className="career-row__line">
                <input
                  className="paper-field career-row__add-name"
                  type="url"
                  inputMode="url"
                  value={url}
                  required
                  placeholder="https://"
                  aria-label="link"
                  onChange={(event) => setUrl(event.target.value)}
                />
                <button type="submit" className="paper-action" disabled={!!busy}>
                  add
                </button>
                <button
                  type="button"
                  className="paper-action paper-action--quiet"
                  onClick={() => setAddingLink(false)}
                >
                  cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="paper-action" onClick={() => setAddingLink(true)}>
              add a link
            </button>
          )}
        </div>
      </div>
      {busy && (
        <p className="career-tab__aside" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ResourceRow({
  resource,
  busy,
  onOpen,
  onRemove,
}: {
  resource: CareerResource;
  busy: boolean;
  onOpen(): void;
  onRemove(): void;
}) {
  const ready = isResourceReady(resource);
  const viewable = resource.kind === "link" || VIEWABLE.includes(resource.contentType ?? "");
  return (
    <div className="paper-row career-row">
      <div className="career-row__line">
        <span className="career-row__name">{resource.title}</span>
        <span className="paper-row__meta career-row__meta-wide">{resourceMeta(resource)}</span>
        <button type="button" className="paper-action" disabled={busy || !ready} onClick={onOpen}>
          {viewable ? "open" : "download"}
        </button>
        <button
          type="button"
          className="paper-action paper-action--quiet career-row__remove"
          disabled={busy}
          onClick={onRemove}
        >
          remove
        </button>
      </div>
    </div>
  );
}
