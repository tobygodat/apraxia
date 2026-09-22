import { describe, expect, it } from "vitest";

import type {
  CareerApplication,
  CareerPrepItem,
  CareerQuestion,
  CareerStep,
  CareerStory,
} from "./careerService";
import { buildCareerBrief, CareerPlanImportError, parseCareerPlan } from "./careerPlan";

const application: CareerApplication = {
  id: "application-1",
  company: "Northstar",
  role: "Product engineer",
  appliedOn: null,
  stage: "interview",
  postingUrl: "https://example.com/jobs/1",
  location: null,
  processNotes: "The recruiter emphasized collaboration.",
  updatedAt: "2026-09-22T12:00:00Z",
};

const steps: CareerStep[] = [
  {
    id: "step-1",
    applicationId: application.id,
    name: "Hiring manager",
    scheduledOn: "2026-09-30",
    position: 0,
    doneAt: null,
    notes: null,
  },
  {
    id: "step-2",
    applicationId: application.id,
    name: "Pairing session",
    scheduledOn: null,
    position: 1,
    doneAt: null,
    notes: "TypeScript exercise",
  },
];

const prep: CareerPrepItem[] = [
  {
    id: "prep-1",
    applicationId: application.id,
    body: "Review the product",
    dueOn: null,
    doneAt: null,
    todoId: null,
    position: 0,
  },
];

const questions: CareerQuestion[] = [
  {
    id: "question-1",
    applicationId: application.id,
    body: "Tell me about a difficult tradeoff.",
    answer: null,
    tags: ["tradeoff"],
    askedOn: null,
    createdAt: "2026-09-22T12:00:00Z",
  },
];

const stories: CareerStory[] = [
  {
    id: "story-1",
    title: "Launch decision",
    body: "Reduced scope after testing the risky assumption.",
    tags: ["tradeoff", "leadership"],
    updatedAt: "2026-09-22T12:00:00Z",
  },
];

describe("buildCareerBrief", () => {
  it("labels known records and makes missing dates explicit", () => {
    const brief = buildCareerBrief({
      application,
      steps,
      prep,
      questions,
      stories,
      projects: [{ id: "project-1", title: "Lab scheduler", description: null }],
      today: "2026-09-22",
    });

    expect(brief).toContain('[APPLICATION id="application-1"]');
    expect(brief).toContain('role: "Product engineer"');
    expect(brief).toContain('scheduled_on: "2026-09-30"');
    expect(brief).toContain("scheduled_on: not provided");
    expect(brief).toContain('[PREPARATION ITEM id="prep-1"]');
    expect(brief).toContain('[QUESTION id="question-1"]');
    expect(brief).toContain('[SELECTED STORY id="story-1"]');
    expect(brief).toContain('[SELECTED PROJECT id="project-1"]');
    expect(brief).toContain('"due_date":null');
  });

  it("uses only the selected story and project context supplied by the caller", () => {
    const brief = buildCareerBrief({
      application,
      stories: [stories[0]!],
      projects: [{ id: "project-1", title: "Chosen project", description: "Relevant work" }],
      today: "2026-09-22",
    });

    expect(brief).toContain("Chosen project");
    expect(brief).toContain("Launch decision");
    expect(brief).toContain("None provided.");
    expect(brief).not.toContain("resource");
  });

  it("requires an unambiguous date-only current date", () => {
    expect(() => buildCareerBrief({ application, today: "09/22/2026" })).toThrow(RangeError);
  });

  it("rejects an oversized brief instead of silently dropping selected evidence", () => {
    expect(() =>
      buildCareerBrief({
        application,
        today: "2026-09-22",
        projects: [{ id: "large", title: "Large project", description: "a".repeat(100_000) }],
      }),
    ).toThrow(/Choose fewer stories or projects/);
  });
});

describe("parseCareerPlan JSON", () => {
  it("maps the documented format without changing date-only values", () => {
    expect(
      parseCareerPlan(
        JSON.stringify({
          tasks: [
            { text: "  Draft a STAR answer  ", due_date: "2026-09-27" },
            { text: "Practice aloud", due_date: null },
            { text: "Research the product" },
          ],
        }),
      ),
    ).toEqual([
      { body: "Draft a STAR answer", dueOn: "2026-09-27" },
      { body: "Practice aloud", dueOn: null },
      { body: "Research the product", dueOn: null },
    ]);
  });

  it("accepts JSON in an outer Markdown fence", () => {
    expect(
      parseCareerPlan('```json\n{"tasks":[{"text":"Practice","due_date":null}]}\n```'),
    ).toEqual([{ body: "Practice", dueOn: null }]);
  });

  it("finds the JSON inside a reply that wraps it in prose", () => {
    const expected = [
      { body: "Practice", dueOn: "2026-09-25" },
      { body: "Research", dueOn: null },
    ];
    const json =
      '{"tasks":[{"text":"Practice","due_date":"2026-09-25"},{"text":"Research","due_date":null}]}';
    expect(
      parseCareerPlan(`Here is your plan:\n\n\`\`\`json\n${json}\n\`\`\`\n\nGood luck!`),
    ).toEqual(expected);
    expect(parseCareerPlan(`${json}\nGood luck!`)).toEqual(expected);
    expect(parseCareerPlan(`Plan below.\n${json}\nCheers`)).toEqual(expected);
    expect(() =>
      parseCareerPlan(`\`\`\`json\n${json}\n\`\`\`\nor\n\n\`\`\`json\n${json}\n\`\`\`\nthanks`),
    ).toThrow("more than one JSON block");
    expect(() => parseCareerPlan('Plan:\n```json\n{"tasks": [\n```')).toThrow(
      "This looks like JSON",
    );
  });

  it("rejects malformed JSON, wrong shapes, and invalid calendar dates clearly", () => {
    expect(() => parseCareerPlan('{"tasks":[')).toThrow("This looks like JSON");
    expect(() => parseCareerPlan('[{"text":"Practice"}]')).toThrow(
      "JSON plans need an object with a tasks array.",
    );
    expect(() =>
      parseCareerPlan('{"tasks":[{"text":"Practice","due_date":"2026-02-30"}]}'),
    ).toThrow("Task 1 has an invalid due_date");
    expect(() => parseCareerPlan('{"tasks":[{"due_date":null}]}')).toThrow(
      "Task 1 needs a text value.",
    );
  });
});

describe("parseCareerPlan text", () => {
  it("reads plain and Markdown task lines while ignoring headings and fenced content", () => {
    const plan = [
      "# Interview plan",
      "",
      "- [ ] Draft a STAR answer",
      "* [x] Review the role",
      "1. Practice aloud",
      "Keep the date 2026-09-28 in the wording",
      "",
      "```ts",
      "runUntrustedCode()",
      "```",
      "---",
      "> A note, not a task",
    ].join("\n");

    expect(parseCareerPlan(plan)).toEqual([
      { body: "Draft a STAR answer", dueOn: null },
      { body: "Review the role", dueOn: null },
      { body: "Practice aloud", dueOn: null },
      { body: "Keep the date 2026-09-28 in the wording", dueOn: null },
    ]);
  });

  it("reads a checklist without list markers as tasks, not JSON", () => {
    expect(parseCareerPlan("[ ] Practice the intro\n[x] Review notes")).toEqual([
      { body: "Practice the intro", dueOn: null },
      { body: "Review notes", dueOn: null },
    ]);
  });

  it("does not turn either kind of Markdown heading into a task", () => {
    expect(
      parseCareerPlan("Week one\n========\n- Research the company\n---\n## Practice\nMock answer"),
    ).toEqual([
      { body: "Research the company", dueOn: null },
      { body: "Mock answer", dueOn: null },
    ]);
  });

  it("does not treat a complete fenced block as a task list", () => {
    expect(() => parseCareerPlan("```text\nReview the role\n```")).toThrow(
      "The plan has no task lines.",
    );
  });

  it("rejects empty imports and applies input, count, and service text limits", () => {
    expect(() => parseCareerPlan("\n# Heading\n```\nnot a task\n```\n")).toThrow(
      "The plan has no task lines.",
    );
    expect(() =>
      parseCareerPlan(Array.from({ length: 51 }, (_, i) => `Task ${i}`).join("\n")),
    ).toThrow("Import 50 tasks or fewer at a time.");
    expect(() => parseCareerPlan("x".repeat(2_001))).toThrow(
      "Task 1 is longer than 2,000 characters.",
    );
    expect(() => parseCareerPlan("x".repeat(100_001))).toThrow(
      "Keep the plan to 100,000 characters or fewer.",
    );
  });

  it("uses a distinct error type for import feedback", () => {
    expect(() => parseCareerPlan("")).toThrow(CareerPlanImportError);
  });

  it("keeps HTML-looking input as inert task text", () => {
    expect(parseCareerPlan("- <img src=x onerror=alert(1)>")).toEqual([
      { body: "<img src=x onerror=alert(1)>", dueOn: null },
    ]);
  });
});
