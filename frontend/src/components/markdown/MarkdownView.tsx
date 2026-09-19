import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdown";

/**
 * A markdown tree as elements. Nothing here builds a string of HTML, so a note
 * containing markup is a note containing markup: React escapes it on the way
 * out and there is no injection to guard against.
 */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return <div className={className}>{renderBlocks(blocks)}</div>;
}

function renderBlocks(blocks: readonly Block[]): ReactNode {
  return blocks.map((block, index) => <Fragment key={index}>{renderBlock(block)}</Fragment>);
}

function renderBlock(block: Block): ReactNode {
  switch (block.kind) {
    case "heading": {
      // A note's own headings sit inside a page that already has an h1 and an
      // h2, so they start at h3 and never climb above the page's own outline.
      const Tag = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[block.level - 1];
      return (
        <Tag className={`markdown__h markdown__h--${block.level}`}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return <p className="markdown__p">{renderInline(block.children)}</p>;
    case "code":
      return (
        <pre className="markdown__pre">
          <code className="markdown__code">{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr className="markdown__rule" />;
    case "quote":
      return <blockquote className="markdown__quote">{renderBlocks(block.blocks)}</blockquote>;
    case "list":
      return renderList(block);
  }
}

function renderList(block: Block & { kind: "list" }): ReactNode {
  const tasks = block.items.some((item) => item.task !== null);
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag
      className={[
        "markdown__list",
        block.ordered ? "markdown__list--ordered" : "markdown__list--bullet",
        tasks && "markdown__list--tasks",
        block.tight && "markdown__list--tight",
      ]
        .filter(Boolean)
        .join(" ")}
      start={block.ordered && block.start !== 1 ? block.start : undefined}
    >
      {block.items.map((item, index) => {
        const first = item.blocks[0];
        const inline = block.tight && first?.kind === "paragraph";
        return (
          <li
            key={index}
            className={[
              "markdown__item",
              item.task !== null && "markdown__item--task",
              item.task && "markdown__item--done",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {item.task !== null && (
              <input
                className="paper-check markdown__box"
                type="checkbox"
                checked={item.task}
                // The box mirrors the note's own text. Editing the note is how
                // it changes, so it never pretends to be the control.
                readOnly
                tabIndex={-1}
                aria-hidden="true"
              />
            )}
            <span className="markdown__item-body">
              {inline ? renderInline(first.children) : renderBlocks(item.blocks)}
            </span>
          </li>
        );
      })}
    </Tag>
  );
}

function renderInline(children: readonly Inline[]): ReactNode {
  return children.map((child, index) => (
    <Fragment key={index}>{renderInlineChild(child)}</Fragment>
  ));
}

function renderInlineChild(child: Inline): ReactNode {
  switch (child.kind) {
    case "text":
      return child.text;
    case "strong":
      return <strong>{renderInline(child.children)}</strong>;
    case "emphasis":
      return <em>{renderInline(child.children)}</em>;
    case "code":
      return <code className="markdown__inline-code">{child.text}</code>;
    case "link":
      return (
        <a className="markdown__link" href={child.href} target="_blank" rel="noreferrer noopener">
          {renderInline(child.children)}
        </a>
      );
  }
}
