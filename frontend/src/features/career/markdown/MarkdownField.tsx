import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MarkdownView } from "./MarkdownView";
import { copyMarkdown } from "./markdownClipboard";

/**
 * A markdown field that shows its result rather than its source. At rest it is
 * the rendered note; click into it, or reach its `write` word, and the same
 * space becomes the source; leave it and it renders again. One field is one
 * document, so selecting and copying all of it works the way it does anywhere
 * else, and `copy` puts formatted text on the clipboard so a note pasted into
 * an email arrives with its headings instead of its asterisks.
 */
export function MarkdownField({
  value,
  label,
  placeholder,
  minRows = 3,
  status,
  disabled,
  onCommit,
}: {
  value: string;
  /** Names the field for a screen reader; the visible heading is the caller's. */
  label: string;
  placeholder: string;
  minRows?: number;
  /** What the caller wants said under the field: "saved", "saving…", "". */
  status?: string;
  disabled?: boolean;
  onCommit(next: string): void;
}) {
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState(value);
  const [copied, setCopied] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  // A save that lands while the field is at rest brings the new text in; one
  // that lands mid-sentence leaves what is being typed alone.
  useEffect(() => {
    if (!writing) setDraft(value);
  }, [value, writing]);
  // The box is as tall as what it holds, so nothing scrolls inside a note.
  useLayoutEffect(() => {
    const node = area.current;
    if (!writing || !node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [writing, draft]);

  function write() {
    if (disabled) return;
    setWriting(true);
    // Focus and caret land after the state change paints the textarea.
    requestAnimationFrame(() => {
      const node = area.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    });
  }

  function commit() {
    setWriting(false);
    if (draft !== value) onCommit(draft);
  }

  async function copy() {
    setCopied((await copyMarkdown(value)) ? "copied" : "nothing to copy");
  }

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 4000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (writing)
    return (
      <div className="career-field career-field--writing">
        <textarea
          ref={area}
          id={id}
          className="paper-field career-field__source"
          aria-label={label}
          value={draft}
          rows={minRows}
          placeholder={placeholder}
          spellCheck
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(value);
              setWriting(false);
            }
          }}
          onBlur={commit}
        />
        <p className="career-field__foot">
          <button type="button" className="paper-action" onClick={commit}>
            done
          </button>
          <span className="career-field__hint">
            markdown · # heading, **bold**, - list, - [ ] task, ```code```
          </span>
        </p>
      </div>
    );

  return (
    <div className="career-field">
      {value.trim() ? (
        <>
          {/* Clicking the note is the shortcut; `write` below is the control,
              so the field is reachable without a pointer. */}
          <div className="career-field__rendered" onClick={write}>
            <MarkdownView source={value} className="career-md" />
          </div>
          <p className="career-field__foot">
            <button
              type="button"
              className="paper-action paper-action--quiet"
              onClick={write}
              disabled={disabled}
            >
              write
            </button>
            <button type="button" className="paper-action paper-action--quiet" onClick={copy}>
              copy
            </button>
            {(copied || status) && <span className="career-field__hint">{copied || status}</span>}
          </p>
        </>
      ) : (
        <p className="career-field__foot">
          <button type="button" className="paper-action" onClick={write} disabled={disabled}>
            {placeholder}
          </button>
          {status && <span className="career-field__hint">{status}</span>}
        </p>
      )}
    </div>
  );
}
