/**
 * Copying a note out of apraxia. Pasting markdown source into an email leaves
 * the reader with the asterisks, so the clipboard carries two flavours: the
 * plain text of the note, and an HTML version that Gmail, Docs and Slack read
 * as real formatting.
 *
 * This is the one place a string of HTML is built, and it never comes back into
 * this app: it is written to the clipboard and nothing here parses it.
 */
import { inlineText, markdownToText, parseMarkdown, type Block, type Inline } from "./markdown";

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineHtml(children: readonly Inline[]): string {
  return children
    .map((child) => {
      switch (child.kind) {
        case "text":
          return escape(child.text).replace(/\n/g, "<br>");
        case "strong":
          return `<strong>${inlineHtml(child.children)}</strong>`;
        case "emphasis":
          return `<em>${inlineHtml(child.children)}</em>`;
        case "code":
          return `<code>${escape(child.text)}</code>`;
        case "link":
          return `<a href="${escape(child.href)}">${inlineHtml(child.children)}</a>`;
      }
    })
    .join("");
}

function blockHtml(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "heading":
          return `<h${block.level}>${inlineHtml(block.children)}</h${block.level}>`;
        case "paragraph":
          return `<p>${inlineHtml(block.children)}</p>`;
        case "code":
          return `<pre><code>${escape(block.text)}</code></pre>`;
        case "rule":
          return "<hr>";
        case "quote":
          return `<blockquote>${blockHtml(block.blocks)}</blockquote>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
          const items = block.items
            .map((item) => {
              // A task box pastes as a character, because a checkbox pasted
              // into an email arrives as an empty square or nothing at all.
              const box = item.task === null ? "" : item.task ? "✓ " : "☐ ";
              const first = item.blocks[0];
              const body =
                first?.kind === "paragraph" && item.blocks.length === 1
                  ? inlineHtml(first.children)
                  : blockHtml(item.blocks);
              return `<li>${box}${body}</li>`;
            })
            .join("");
          return `<${tag}${start}>${items}</${tag}>`;
        }
      }
    })
    .join("");
}

export function markdownToHtml(source: string): string {
  return blockHtml(parseMarkdown(source));
}

/**
 * Put a note on the clipboard as formatted text with a plain-text twin. Falls
 * back to the plain text alone where `ClipboardItem` is missing, and reports
 * whether anything was written so the caller can say so.
 */
export async function copyMarkdown(source: string): Promise<boolean> {
  const text = markdownToText(parseMarkdown(source));
  if (!text) return false;
  const html = markdownToHtml(source);
  try {
    if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export { inlineText };
