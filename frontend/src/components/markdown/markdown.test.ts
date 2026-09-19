import { describe, expect, it } from "vitest";
import { inlineText, markdownToText, markdownSummary, parseMarkdown } from "./markdown";
import type { Block, Inline, ListItem } from "./markdown";
import { markdownToHtml } from "./markdownClipboard";

/** The shape of a note, without asserting on the element tree that renders it. */
function kinds(source: string) {
  return parseMarkdown(source).map((block) => block.kind);
}

/** The runs of the first block, which every inline case here is written in. */
function runs(source: string): Inline[] {
  const block: Block = parseMarkdown(source)[0];
  if (block.kind !== "paragraph" && block.kind !== "heading")
    throw new Error(`Expected text, read a ${block.kind}.`);
  return block.children;
}

function items(source: string): ListItem[] {
  const block: Block = parseMarkdown(source)[0];
  if (block.kind !== "list") throw new Error(`Expected a list, read a ${block.kind}.`);
  return block.items;
}

describe("blocks", () => {
  it("reads a heading by its level and leaves the hashes out", () => {
    expect(parseMarkdown("## what she said")[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(inlineText(runs("## what she said"))).toBe("what she said");
  });

  it("does not make a heading out of a hash with no space after it", () => {
    expect(kinds("#tag not a heading")).toEqual(["paragraph"]);
  });

  it("keeps consecutive lines in one paragraph and splits on a blank line", () => {
    expect(kinds("one\ntwo\n\nthree")).toEqual(["paragraph", "paragraph"]);
  });

  it("reads a fenced block as code, with its language", () => {
    const [code] = parseMarkdown("```python\nkey = 1\n\nprint(key)\n```");
    expect(code).toEqual({ kind: "code", language: "python", text: "key = 1\n\nprint(key)" });
  });

  it("reads an unclosed fence as code to the end rather than as prose", () => {
    expect(parseMarkdown("```\nhalf written")).toEqual([
      { kind: "code", language: null, text: "half written" },
    ]);
  });

  it("does not read markdown inside a fenced block", () => {
    const [code] = parseMarkdown("```\n# not a heading\n- not a list\n```");
    expect(code).toMatchObject({ kind: "code", text: "# not a heading\n- not a list" });
  });

  it("reads a rule, and does not mistake a list dash for one", () => {
    expect(kinds("---")).toEqual(["rule"]);
    expect(kinds("- one")).toEqual(["list"]);
  });

  it("reads a quote and parses what is inside it", () => {
    const quote: Block = parseMarkdown("> **talk** through it\n> out loud")[0];
    expect(quote.kind).toBe("quote");
    if (quote.kind !== "quote") return;
    expect(quote.blocks.map((block) => block.kind)).toEqual(["paragraph"]);
  });
});

describe("lists", () => {
  it("numbers an ordered list from where it starts", () => {
    expect(parseMarkdown("2. screen\n3. loop")[0]).toMatchObject({
      kind: "list",
      ordered: true,
      start: 2,
      tight: true,
    });
  });

  it("reads a task box, ticked and not", () => {
    const rows = items("- [x] ask about the cutoff\n- [ ] send the transcript");
    expect(rows.map((item) => item.task)).toEqual([true, false]);
  });

  it("leaves a plain item's task null so it draws no box", () => {
    expect(items("- two coding rounds")[0].task).toBeNull();
  });

  it("nests an indented list inside its item", () => {
    const rows = items("- loop\n  - coding\n  - design\n- team match");
    expect(rows).toHaveLength(2);
    expect(rows[0].blocks.map((block) => block.kind)).toEqual(["paragraph", "list"]);
  });

  it("ends a list at an unindented line", () => {
    expect(kinds("- one\n\nafter")).toEqual(["list", "paragraph"]);
  });

  it("does not run a bullet list into a numbered one", () => {
    expect(kinds("- one\n1. two")).toEqual(["list", "list"]);
  });
});

describe("inline", () => {
  const first = runs;

  it("reads bold and italic", () => {
    expect(first("**a** and *b*").map((child) => child.kind)).toEqual([
      "strong",
      "text",
      "emphasis",
    ]);
  });

  it("leaves arithmetic asterisks alone", () => {
    expect(inlineText(first("2 * 3 * 4"))).toBe("2 * 3 * 4");
  });

  it("leaves an underscore inside a word alone", () => {
    expect(first("read done_at now").map((child) => child.kind)).toEqual(["text"]);
  });

  it("reads inline code and does not read markdown inside it", () => {
    expect(first("press `ctrl + **enter**`").at(-1)).toEqual({
      kind: "code",
      text: "ctrl + **enter**",
    });
  });

  it("does not let emphasis close inside a code span", () => {
    expect(inlineText(first("*a `b* c` d*"))).toBe("a b* c d");
  });

  it("reads a link and its label", () => {
    expect(first("see [their docs](https://docs.stripe.com/x)").at(-1)).toMatchObject({
      kind: "link",
      href: "https://docs.stripe.com/x",
    });
  });

  it("links a bare url and a bare domain", () => {
    expect(first("at https://stripe.com/jobs today").at(1)).toMatchObject({
      kind: "link",
      href: "https://stripe.com/jobs",
    });
    expect(first("[the posting](stripe.com/jobs)")[0]).toMatchObject({
      href: "https://stripe.com/jobs",
    });
  });

  it("refuses a link that does not go to a page", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<script>", "/settings"])
      expect(first(`[x](${href})`).map((child) => child.kind)).toEqual(["text"]);
  });

  it("keeps an escaped marker as the character it escapes", () => {
    expect(inlineText(first("a \\*literal\\* star"))).toBe("a *literal* star");
  });
});

describe("copying out", () => {
  const note = [
    "# the rounds",
    "",
    "they interrupt **on purpose**.",
    "",
    "1. screen",
    "2. loop",
    "",
    "- [x] ask about the cutoff",
    "- [ ] send the transcript",
    "",
    "```",
    "key = 1",
    "```",
  ].join("\n");

  it("drops the markers from the plain text", () => {
    const text = markdownToText(parseMarkdown(note));
    expect(text).not.toMatch(/[*#`]/);
    expect(text).toContain("on purpose");
    expect(text).toContain("1. screen");
    expect(text).toContain("[done] ask about the cutoff");
  });

  it("writes formatting the other side will read", () => {
    const html = markdownToHtml(note);
    expect(html).toContain("<h1>the rounds</h1>");
    expect(html).toContain("<strong>on purpose</strong>");
    expect(html).toContain("<ol><li>screen</li><li>loop</li></ol>");
    expect(html).toContain("<pre><code>key = 1</code></pre>");
  });

  it("escapes what it copies, so markup in a note stays text", () => {
    expect(markdownToHtml("a <script>alert(1)</script> b")).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(markdownToHtml('[x](https://a.test/?q=")')).not.toContain('?q="');
  });

  it("summarises a note as its first line", () => {
    expect(markdownSummary(note)).toBe("the rounds");
    expect(markdownSummary("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
  });
});
