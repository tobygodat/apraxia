/**
 * The markdown the career pages write in. It parses to a tree, and the renderer
 * turns that tree into elements, so no step of it ever produces HTML: a note
 * that happens to contain a `<script>` is text, not markup, and there is
 * nothing here for a sanitizer to catch.
 *
 * It covers what a person writing notes reaches for — headings, emphasis,
 * lists, task boxes, quotes, rules, links, inline code and fenced blocks — and
 * deliberately stops short of tables, footnotes and reference links, which cost
 * more to parse than they are worth on this surface.
 */

/** A run of text inside a block. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "emphasis"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

/** One item of a list. `task` is null when the item is not a task box. */
export interface ListItem {
  blocks: Block[];
  task: boolean | null;
}

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "code"; language: string | null; text: string }
  | { kind: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;

/** A tab counts as two spaces, which is the indent a nested item needs. */
function indentWidth(prefix: string): number {
  return [...prefix].reduce((width, character) => width + (character === "\t" ? 2 : 1), 0);
}

function listStart(line: string): { indent: number; ordered: boolean; number: number } | null {
  const bullet = BULLET.exec(line);
  if (bullet) return { indent: indentWidth(bullet[1]), ordered: false, number: 1 };
  const ordered = ORDERED.exec(line);
  if (ordered)
    return { indent: indentWidth(ordered[1]), ordered: true, number: Number(ordered[2]) };
  return null;
}

/** Where a block ends: the next line that starts something else, or a blank. */
function startsBlock(line: string): boolean {
  return (
    !line.trim() ||
    FENCE.test(line) ||
    RULE.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    listStart(line) !== null
  );
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (!line.trim()) {
      at += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}`);
      const text: string[] = [];
      at += 1;
      while (at < lines.length && !closing.test(lines[at])) {
        text.push(lines[at]);
        at += 1;
      }
      // An unclosed fence still renders as code: the person is mid-sentence,
      // not asking for the rest of the note to be read as prose.
      if (at < lines.length) at += 1;
      blocks.push({ kind: "code", language: fence[2] || null, text: text.join("\n") });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      at += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      at += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (at < lines.length && (QUOTE.test(lines[at]) || (quoted.length && lines[at].trim()))) {
        quoted.push(lines[at].replace(QUOTE, ""));
        at += 1;
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted) });
      continue;
    }

    const marker = listStart(line);
    if (marker) {
      const list = parseList(lines, at, marker);
      blocks.push(list.block);
      at = list.at;
      continue;
    }

    const paragraph: string[] = [line];
    at += 1;
    while (at < lines.length && !startsBlock(lines[at])) {
      paragraph.push(lines[at]);
      at += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

/**
 * One list, its items and whatever they contain. An item's own lines are
 * everything indented past its marker, so a nested list or a second paragraph
 * comes back through `parseBlocks` rather than being flattened.
 */
function parseList(
  lines: string[],
  from: number,
  first: { indent: number; ordered: boolean; number: number },
): { block: Block; at: number } {
  const items: ListItem[] = [];
  let at = from;
  let loose = false;
  while (at < lines.length) {
    const marker = listStart(lines[at]);
    // A different marker kind, or one indented back out, is a different list.
    if (!marker || marker.ordered !== first.ordered || marker.indent !== first.indent) break;
    const body = lines[at].slice(lines[at].search(/\S/)).replace(/^\S+[ \t]+/, "");
    const task = TASK.exec(body);
    const own: string[] = [task ? task[2] : body];
    at += 1;
    let blanks = 0;
    while (at < lines.length) {
      const next = lines[at];
      if (!next.trim()) {
        blanks += 1;
        own.push("");
        at += 1;
        continue;
      }
      const indented = indentWidth(next.slice(0, next.search(/\S/))) > first.indent;
      // A blank line followed by an unindented line ends the item, and the
      // list with it.
      if (!indented) break;
      if (blanks) loose = true;
      blanks = 0;
      own.push(next.replace(new RegExp(`^[ \\t]{1,${first.indent + 2}}`), ""));
      at += 1;
    }
    while (own.length && !own[own.length - 1].trim()) own.pop();
    items.push({ blocks: parseBlocks(own), task: task ? task[1].toLowerCase() === "x" : null });
  }
  return {
    block: {
      kind: "list",
      ordered: first.ordered,
      start: first.number,
      // A tight item is one paragraph, so the renderer can drop the wrapper and
      // keep the line rhythm of the rows around it.
      tight: !loose && items.every((item) => item.blocks.length <= 1),
      items,
    },
    at,
  };
}

/** Only a link that goes somewhere a browser will follow becomes a link. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  // A bare domain is what people paste; anything else (`javascript:`, `data:`,
  // a relative path into this app) stays text.
  if (/^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/.test(href)) return `https://${href}`;
  return null;
}

const AUTOLINK = /^(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"]/i;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    const character = source[at];

    if (character === "\\" && at + 1 < source.length && /[\\`*_[\]()#>~!-]/.test(source[at + 1])) {
      text += source[at + 1];
      at += 2;
      continue;
    }

    if (character === "`") {
      const ticks = /^`+/.exec(rest)![0];
      const close = source.indexOf(ticks, at + ticks.length);
      if (close > -1) {
        flush();
        // A span written `` `a` `` drops the one padding space each side, so a
        // fragment that itself starts with a backtick still reads as code.
        const inner = source.slice(at + ticks.length, close);
        out.push({ kind: "code", text: inner.replace(/^ (.*) $/s, "$1") });
        at = close + ticks.length;
        continue;
      }
    }

    if (character === "[") {
      const label = matchBracket(source, at);
      if (label !== null && source[label + 1] === "(") {
        const close = matchParen(source, label + 1);
        if (close !== null) {
          const href = safeHref(source.slice(label + 2, close).replace(/\s+["'].*$/s, ""));
          if (href) {
            flush();
            out.push({
              kind: "link",
              href,
              children: parseInline(source.slice(at + 1, label)),
            });
            at = close + 1;
            continue;
          }
        }
      }
    }

    if (character === "*" || character === "_") {
      const run = new RegExp(`^\\${character}{1,2}`).exec(rest)![0];
      // `_` inside a word is part of the word, which is what snake_case needs.
      const wordly = character === "_" && at > 0 && /\w/.test(source[at - 1]);
      const close = wordly ? -1 : findClosing(source, at + run.length, run);
      if (close > -1) {
        flush();
        const children = parseInline(source.slice(at + run.length, close));
        out.push(run.length === 2 ? { kind: "strong", children } : { kind: "emphasis", children });
        at = close + run.length;
        continue;
      }
    }

    const autolink = AUTOLINK.exec(rest);
    if (autolink && (at === 0 || /[\s(]/.test(source[at - 1]))) {
      const href = safeHref(autolink[0]);
      if (href) {
        flush();
        out.push({ kind: "link", href, children: [{ kind: "text", text: autolink[0] }] });
        at += autolink[0].length;
        continue;
      }
    }

    text += character;
    at += 1;
  }
  flush();
  return out;
}

/** The index of the `]` closing the `[` at `from`, or null. */
function matchBracket(source: string, from: number): number | null {
  let depth = 0;
  for (let at = from; at < source.length; at += 1) {
    if (source[at] === "\\") at += 1;
    else if (source[at] === "[") depth += 1;
    else if (source[at] === "]") {
      depth -= 1;
      if (!depth) return at;
    }
  }
  return null;
}

/** The index of the `)` closing the `(` at `from`, or null. */
function matchParen(source: string, from: number): number | null {
  let depth = 0;
  for (let at = from; at < source.length; at += 1) {
    if (source[at] === "\\") at += 1;
    else if (source[at] === "(") depth += 1;
    else if (source[at] === ")") {
      depth -= 1;
      if (!depth) return at;
    }
  }
  return null;
}

/**
 * Where a `*` or `**` run closes. An opener with nothing but space after it is
 * not an opener, so `2 * 3 * 4` keeps its asterisks.
 */
function findClosing(source: string, from: number, run: string): number {
  if (from >= source.length || /\s/.test(source[from])) return -1;
  for (let at = from; at < source.length; at += 1) {
    if (source[at] === "\\") {
      at += 1;
      continue;
    }
    if (source[at] === "`") {
      const ticks = /^`+/.exec(source.slice(at))![0];
      const close = source.indexOf(ticks, at + ticks.length);
      if (close > -1) {
        at = close + ticks.length - 1;
        continue;
      }
    }
    if (
      source.startsWith(run, at) &&
      source[at - 1] !== undefined &&
      !/\s/.test(source[at - 1]) &&
      source[at + run.length] !== run[0]
    )
      return at;
  }
  return -1;
}

/** The plain text of a tree, for a copy that carries no markers. */
export function markdownToText(blocks: Block[]): string {
  const lines: string[] = [];
  write(blocks, "");
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  function write(list: Block[], indent: string) {
    for (const block of list) {
      switch (block.kind) {
        case "heading":
          lines.push("", indent + inlineText(block.children));
          break;
        case "paragraph":
          lines.push("", indent + inlineText(block.children));
          break;
        case "code":
          lines.push("", ...block.text.split("\n").map((line) => indent + line));
          break;
        case "rule":
          lines.push("", indent + "—");
          break;
        case "quote":
          write(block.blocks, `${indent}> `);
          break;
        case "list": {
          lines.push("");
          block.items.forEach((item, index) => {
            const bullet = block.ordered ? `${block.start + index}. ` : "· ";
            const box = item.task === null ? "" : item.task ? "[done] " : "[ ] ";
            const first = item.blocks[0];
            const head = first?.kind === "paragraph" ? inlineText(first.children) : first ? "" : "";
            lines.push(indent + bullet + box + head);
            write(first?.kind === "paragraph" ? item.blocks.slice(1) : item.blocks, `${indent}  `);
          });
          break;
        }
      }
    }
  }
}

export function inlineText(children: readonly Inline[]): string {
  return children
    .map((child) =>
      child.kind === "text" || child.kind === "code" ? child.text : inlineText(child.children),
    )
    .join("");
}

/** The first line of a note, for a row that shows one line of it. */
export function markdownSummary(source: string, limit = 120): string {
  const text = markdownToText(parseMarkdown(source)).split("\n")[0] ?? "";
  return [...text].length > limit ? `${[...text].slice(0, limit - 1).join("")}…` : text;
}
