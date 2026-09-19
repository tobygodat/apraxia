/**
 * A `CareerService` backed by arrays in this tab, for the QA workspace fixture.
 *
 * Every company, role and note below is invented. The rounds are dated relative
 * to the fixture's own "today", so the table shows a late step, a step due this
 * week and applications with nothing scheduled without the dates going stale.
 *
 * The first application carries the rest of it — notes on its rounds, prep,
 * tagged questions, behaviourals and resources — so one application's own three
 * tabs have something to show. The others stay thin, which is what the table
 * needs and what a new application looks like.
 */
import { addSqlDateDays } from "../features/todos/dateDomain";
import { nextStepOf } from "../features/career/careerOrdering";
import { ServiceError } from "../lib/serviceError";
import type {
  CareerApplication,
  CareerApplicationRow,
  CareerDeletion,
  CareerPrepItem,
  CareerQuestion,
  CareerResource,
  CareerService,
  CareerStep,
  CareerStory,
  CareerStoryUse,
} from "../features/career/careerService";

interface Seed {
  company: string;
  role: string;
  /** Days before today, or null for an application not sent yet. */
  applied: number | null;
  stage: CareerApplication["stage"];
  location?: string;
  /** Rounds as `[name, days from today or null]`. */
  steps?: readonly (readonly [string, number | null])[];
}

const SEEDS: readonly Seed[] = [
  {
    company: "Northwind Systems",
    role: "software engineer intern",
    applied: 15,
    stage: "interview",
    location: "Seattle, WA",
    steps: [
      ["recruiter call", -9],
      ["technical screen", 3],
      ["onsite", null],
    ],
  },
  {
    company: "Halden Pay",
    role: "product engineer intern",
    applied: 15,
    stage: "screen",
    location: "New York, NY",
    steps: [["recruiter call", 0]],
  },
  {
    company: "Meridian Labs",
    role: "product engineer intern",
    applied: 22,
    stage: "offer",
    location: "remote",
    steps: [["decide by", 6]],
  },
  {
    company: "Corvid Cloud",
    role: "frontend engineer intern",
    applied: 24,
    stage: "interview",
    location: "Austin, TX",
    steps: [["take-home", -3]],
  },
  {
    company: "Quillwork",
    role: "design engineer intern",
    applied: 28,
    stage: "applied",
    location: "San Francisco, CA",
  },
  {
    company: "Baseline Data",
    role: "systems engineer intern",
    applied: 31,
    stage: "applied",
  },
  {
    company: "Trellis Analytics",
    role: "software engineer intern",
    applied: 36,
    stage: "rejected",
  },
  {
    company: "Ironvale",
    role: "software engineer intern",
    applied: 39,
    stage: "withdrawn",
  },
  {
    company: "Pike & Ferrier",
    role: "software developer intern",
    applied: null,
    stage: "interested",
    steps: [["deadline", 12]],
  },
  {
    company: "Fernbrook Energy",
    role: "full stack engineer intern",
    applied: null,
    stage: "interested",
    steps: [["opens", 17]],
  },
];

/** The dense scenario adds rows that try to break the column widths. */
const DENSE: readonly Seed[] = [
  {
    company: "Consolidated Interplanetary Logistics and Freight Corporation",
    role: "associate software engineering intern, platform infrastructure and reliability",
    applied: 4,
    stage: "screen",
    steps: [["introductory conversation with the hiring manager and two engineers", 1]],
  },
  {
    company: "Æther",
    role: "swe",
    applied: 90,
    stage: "interview",
    steps: [["panel", -41]],
  },
];

/** One note with every shape the markdown field draws, to look at it whole. */
const PROCESS_NOTES = `## The rounds, as she described them

1. recruiter call — 30 min, logistics only
2. technical screen — 60 min in their own editor
3. onsite — 2 coding, 1 system design, 1 values

They interrupt on purpose. **Talk through the tradeoff out loud** before writing
anything, even when the answer is obvious.

- [x] Ask about the graduation-date cutoff
- [ ] Send the fall transcript

The editor is theirs, not a shared pad, and \`ctrl + enter\` runs the tests.

\`\`\`python
key = f"{user}:{invoice}:{attempt}"
charge = charges.get(key) or charges.create(key, cents)
\`\`\`

> She volunteered the whole loop unprompted, which nobody else has done.
`;

const STORY_BODY = `**Situation** · two of us wanted a rewrite, the deadline was three weeks out.

**What I did** · measured the slow query first, showed it was one missing index.

**Result** · shipped the index in a day, kept the rewrite as a written proposal.
`;

let sequence = 0;
const id = (prefix: string) => `${prefix}-${(sequence += 1)}`;

export function createFixtureCareer({
  scenario,
  today,
}: {
  scenario: string;
  today: string;
}): CareerService {
  const applications: CareerApplication[] = [];
  const steps: CareerStep[] = [];
  const questions: CareerQuestion[] = [];
  const prep: CareerPrepItem[] = [];
  const stories: CareerStory[] = [];
  const storyUses: CareerStoryUse[] = [];
  const resources: CareerResource[] = [];
  const files = new Map<string, File>();
  const now = new Date().toISOString();

  if (scenario !== "empty") {
    const seeds = scenario === "dense" || scenario === "long" ? [...SEEDS, ...DENSE] : SEEDS;
    for (const seed of seeds) {
      const applicationId = id("application");
      applications.push({
        id: applicationId,
        company: seed.company,
        role: seed.role,
        appliedOn: seed.applied === null ? null : addSqlDateDays(today, -seed.applied),
        stage: seed.stage,
        postingUrl: null,
        location: seed.location ?? null,
        processNotes: null,
        updatedAt: now,
      });
      (seed.steps ?? []).forEach(([name, offset], position) => {
        steps.push({
          id: id("step"),
          applicationId,
          name,
          scheduledOn: offset === null ? null : addSqlDateDays(today, offset),
          position,
          // A round in the past that is not the one the table should show is
          // already done; a late one is not.
          doneAt: offset !== null && offset < -5 ? now : null,
          notes: null,
        });
      });
    }
    stories.push(
      {
        id: id("story"),
        title: "The migration nobody wanted to own",
        body: "**Situation** · nobody owned it.\n\n**What I did** · wrote it forward-only.\n\n**Result** · no rollback needed.",
        tags: ["ownership", "ambiguity"],
        updatedAt: now,
      },
      {
        id: id("story"),
        title: "The search rewrite I argued against",
        body: STORY_BODY,
        tags: ["conflict", "influence"],
        updatedAt: now,
      },
      {
        id: id("story"),
        title: "The class project that missed its deadline",
        body: "**Situation** · four of us, nobody merging.\n\n**What I did** · cut the scope in half.\n\n**Result** · shipped two days late, with tests.",
        tags: ["failure", "recovery"],
        updatedAt: now,
      },
    );
    seedOneApplication(applications[0].id);
  }

  /**
   * Everything the three tabs of one application read. Only the first gets it:
   * a page with one of everything is what there is to look at, and the rest of
   * the table stays as thin as a new application really is.
   */
  function seedOneApplication(applicationId: string) {
    const round = steps.find((step) => step.applicationId === applicationId && !step.doneAt);
    const done = steps.find((step) => step.applicationId === applicationId && step.doneAt);
    applications[0].processNotes = PROCESS_NOTES;
    applications[0].postingUrl = "https://example.invalid/jobs/12481";
    if (done) done.notes = "30 min · logistics, grad date, why the payments team.";
    if (round) round.notes = "60 min · two medium questions in their own editor. No whiteboard.";
    questions.push(
      {
        id: id("question"),
        applicationId,
        body: "How would you make a payment endpoint safe to retry?",
        answer:
          "- one key per user, invoice and attempt, written before the charge\n- a replay returns the first result, never a second charge\n- 24 hour window, then the key is free again",
        tags: ["technical", "systems"],
        askedOn: null,
        createdAt: now,
      },
      {
        id: id("question"),
        applicationId,
        body: "Walk me through what happens when a webhook arrives twice.",
        answer: "The second one finds the row already written and returns the same response.",
        tags: ["systems"],
        askedOn: addSqlDateDays(today, -9),
        createdAt: now,
      },
      {
        id: id("question"),
        applicationId,
        body: "What do you want to learn here that you can't learn at school?",
        answer: null,
        tags: ["culture"],
        askedOn: null,
        createdAt: now,
      },
    );
    prep.push(
      {
        id: id("prep"),
        applicationId,
        body: "Re-read the payments primer",
        dueOn: addSqlDateDays(today, 1),
        doneAt: now,
        todoId: null,
        position: 0,
      },
      {
        id: id("prep"),
        applicationId,
        body: "Idempotency keys, retries, webhook ordering",
        dueOn: addSqlDateDays(today, -3),
        doneAt: null,
        todoId: null,
        position: 1,
      },
      {
        id: id("prep"),
        applicationId,
        body: "Two questions to ask them about the payments team",
        dueOn: addSqlDateDays(today, 3),
        doneAt: null,
        todoId: null,
        position: 2,
      },
      {
        id: id("prep"),
        applicationId,
        body: "Set up the shared editor and run one test before the call",
        dueOn: null,
        doneAt: null,
        todoId: null,
        position: 3,
      },
    );
    storyUses.push({ storyId: stories[0].id, applicationId, usedOn: null });
    resources.push(
      {
        id: id("resource"),
        applicationId,
        kind: "file",
        title: "resume — september.pdf",
        url: null,
        contentType: "application/pdf",
        byteSize: 219_136,
        contentSha256: null,
        objectPath: "fixture/resume.pdf",
        uploadedAt: now,
        createdAt: now,
      },
      {
        id: id("resource"),
        applicationId,
        kind: "file",
        title: "cover letter.docx",
        url: null,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: 38_912,
        contentSha256: null,
        objectPath: "fixture/cover.docx",
        uploadedAt: now,
        createdAt: now,
      },
      {
        id: id("resource"),
        applicationId,
        kind: "link",
        title: "Idempotent requests, in their docs",
        url: "https://docs.example.invalid/api/idempotent-requests",
        contentType: null,
        byteSize: null,
        contentSha256: null,
        objectPath: null,
        uploadedAt: null,
        createdAt: now,
      },
      {
        id: id("resource"),
        applicationId,
        kind: "link",
        title: "How they run the systems round",
        url: "https://writing.example.invalid/systems-round",
        contentType: null,
        byteSize: null,
        contentSha256: null,
        objectPath: null,
        uploadedAt: null,
        createdAt: now,
      },
    );
  }

  const rowsFor = (): CareerApplicationRow[] =>
    applications.map((application) => ({
      ...application,
      nextStep: nextStepOf(steps.filter((step) => step.applicationId === application.id)),
    }));

  const find = (applicationId: string): CareerApplication => {
    const application = applications.find((row) => row.id === applicationId);
    // The hosted service reports a row that is not there with this code, and
    // the page reads the code rather than the copy, so the fixture uses it too.
    if (!application) throw new ServiceError("not_found", "Couldn’t load this application.");
    return application;
  };

  return {
    async listApplications() {
      return rowsFor();
    },
    async getApplication(_userId, applicationId) {
      return { ...find(applicationId) };
    },
    async createApplication(_userId, draft) {
      const created: CareerApplication = {
        id: id("application"),
        company: draft.company,
        role: draft.role,
        appliedOn: draft.appliedOn ?? null,
        stage: draft.stage ?? "interested",
        postingUrl: draft.postingUrl ?? null,
        location: draft.location ?? null,
        processNotes: draft.processNotes ?? null,
        updatedAt: new Date().toISOString(),
      };
      applications.push(created);
      return { ...created };
    },
    async updateApplication(_userId, applicationId, changes) {
      const application = find(applicationId);
      Object.assign(application, changes, { updatedAt: new Date().toISOString() });
      return { ...application };
    },
    async deleteApplication(applicationId) {
      const index = applications.findIndex((row) => row.id === applicationId);
      if (index >= 0) applications.splice(index, 1);
      return { id: applicationId, deletedAt: new Date().toISOString() };
    },
    async restoreApplication(_deletion: CareerDeletion) {
      return true;
    },

    async listSteps(_userId, applicationId) {
      return steps
        .filter((step) => step.applicationId === applicationId)
        .map((step) => ({ ...step }));
    },
    async saveStep(_userId, applicationId, step) {
      const existing = step.id && steps.find((row) => row.id === step.id);
      if (existing) {
        Object.assign(existing, step);
        return { ...existing };
      }
      const created: CareerStep = {
        id: id("step"),
        applicationId,
        name: step.name,
        scheduledOn: step.scheduledOn ?? null,
        position: step.position ?? steps.filter((r) => r.applicationId === applicationId).length,
        doneAt: step.doneAt ?? null,
        notes: step.notes ?? null,
      };
      steps.push(created);
      return { ...created };
    },
    async removeStep(_userId, stepId) {
      const index = steps.findIndex((row) => row.id === stepId);
      if (index >= 0) steps.splice(index, 1);
    },

    async listQuestions(_userId, applicationId) {
      return questions
        .filter((row) => row.applicationId === applicationId)
        .map((row) => ({ ...row }));
    },
    async listQuestionsByTag(_userId, tag) {
      return questions.filter((row) => row.tags.includes(tag)).map((row) => ({ ...row }));
    },
    async saveQuestion(_userId, applicationId, question) {
      const existing = question.id && questions.find((row) => row.id === question.id);
      if (existing) {
        Object.assign(existing, question);
        return { ...existing };
      }
      const created: CareerQuestion = {
        id: id("question"),
        applicationId,
        body: question.body,
        answer: question.answer ?? null,
        tags: (question.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        askedOn: question.askedOn ?? null,
        createdAt: new Date().toISOString(),
      };
      questions.push(created);
      return { ...created };
    },
    async removeQuestion(_userId, questionId) {
      const index = questions.findIndex((row) => row.id === questionId);
      if (index >= 0) questions.splice(index, 1);
    },

    async listPrep(_userId, applicationId) {
      return prep.filter((row) => row.applicationId === applicationId).map((row) => ({ ...row }));
    },
    async savePrep(_userId, applicationId, item) {
      const existing = item.id && prep.find((row) => row.id === item.id);
      if (existing) {
        Object.assign(existing, item);
        return { ...existing };
      }
      const created: CareerPrepItem = {
        id: id("prep"),
        applicationId,
        body: item.body,
        dueOn: item.dueOn ?? null,
        doneAt: item.doneAt ?? null,
        todoId: item.todoId ?? null,
        position: item.position ?? prep.filter((r) => r.applicationId === applicationId).length,
      };
      prep.push(created);
      return { ...created };
    },
    async removePrep(_userId, itemId) {
      const index = prep.findIndex((row) => row.id === itemId);
      if (index >= 0) prep.splice(index, 1);
    },

    async listStories() {
      return stories.map((row) => ({ ...row }));
    },
    async saveStory(_userId, story) {
      const existing = story.id && stories.find((row) => row.id === story.id);
      if (existing) {
        Object.assign(existing, story, { updatedAt: new Date().toISOString() });
        return { ...existing };
      }
      const created: CareerStory = {
        id: id("story"),
        title: story.title,
        body: story.body,
        tags: (story.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        updatedAt: new Date().toISOString(),
      };
      stories.push(created);
      return { ...created };
    },
    async removeStory(_userId, storyId) {
      const index = stories.findIndex((row) => row.id === storyId);
      if (index >= 0) stories.splice(index, 1);
    },
    async listStoryUses() {
      return storyUses.map((row) => ({ ...row }));
    },
    async recordStoryUse(_userId, use) {
      storyUses.push({ ...use });
      return { ...use };
    },
    async removeStoryUse(_userId, storyId, applicationId) {
      const index = storyUses.findIndex(
        (row) => row.storyId === storyId && row.applicationId === applicationId,
      );
      if (index >= 0) storyUses.splice(index, 1);
    },

    async listResources(_userId, applicationId) {
      return resources
        .filter((row) => row.applicationId === applicationId)
        .map((row) => ({ ...row }));
    },
    async addLink(_userId, applicationId, link) {
      const created: CareerResource = {
        id: id("resource"),
        applicationId,
        kind: "link",
        title: link.title,
        url: link.url,
        contentType: null,
        byteSize: null,
        contentSha256: null,
        objectPath: null,
        uploadedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      resources.push(created);
      return { ...created };
    },
    async reserveFile(_userId, applicationId, draft) {
      const created: CareerResource = {
        id: draft.id,
        applicationId,
        kind: "file",
        title: draft.name,
        url: null,
        contentType: draft.contentType,
        byteSize: draft.size,
        contentSha256: draft.sha256,
        objectPath: `fixture/${draft.id}`,
        // Null until the bytes land: a reservation is a row before it is a file.
        uploadedAt: null,
        createdAt: new Date().toISOString(),
      };
      resources.push(created);
      return { ...created };
    },
    async uploadFile(resource, file) {
      files.set(resource.id, file);
      const stored = resources.find((row) => row.id === resource.id);
      if (stored) stored.uploadedAt = new Date().toISOString();
      return { ...(stored ?? resource), uploadedAt: new Date().toISOString() };
    },
    async downloadFile(resource) {
      const file = files.get(resource.id);
      if (file) return file;
      // A seeded row has no bytes behind it, so opening one hands back a
      // readable stand-in rather than failing: the path is still exercisable.
      if (resource.uploadedAt)
        return new File(
          [`${resource.title}\n\nThis fixture file has no contents.`],
          resource.title,
          {
            type: resource.contentType ?? "text/plain",
          },
        );
      throw new Error("That file is still uploading.");
    },
    async removeResource(_userId, resource) {
      files.delete(resource.id);
      const index = resources.findIndex((row) => row.id === resource.id);
      if (index >= 0) resources.splice(index, 1);
    },
  };
}
