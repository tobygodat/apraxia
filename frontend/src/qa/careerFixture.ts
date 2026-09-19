/**
 * An in-memory career service for the fixture workspace. Nothing here touches
 * Supabase or storage: rows live for the life of the tab, so the application
 * pages can be looked at, written in and broken without an account.
 *
 * The fictional applications are invented. Real ones belong to the account, and
 * the `personal` snapshot does not carry them.
 */
import { nextStepOf, orderApplications } from "../features/career/careerOrdering";
import type {
  CareerApplication,
  CareerApplicationDraft,
  CareerApplicationRow,
  CareerPrepItem,
  CareerQuestion,
  CareerResource,
  CareerService,
  CareerStep,
  CareerStory,
  CareerStoryUse,
} from "../features/career/careerService";

const PROCESS_NOTES = `## the rounds, as she described them

1. recruiter screen — 30 min, logistics only
2. technical screen — 60 min in their own editor
3. onsite loop — 2 coding, 1 system design, 1 values

they interrupt on purpose. **talk through the tradeoff out loud** before writing
anything, even when the answer is obvious.

- [x] ask about the grad-date cutoff
- [ ] send her the fall transcript

the editor is theirs, not coderpad, and \`ctrl + enter\` runs the tests.

\`\`\`python
key = f"{user}:{invoice}:{attempt}"
charge = charges.get(key) or charges.create(key, cents)
\`\`\`

> she volunteered the whole loop unprompted, which nobody else has done.
`;

const STORY_BODY = `**situation** · two of us wanted a rewrite, the deadline was three weeks out.

**what i did** · measured the slow query first, showed it was one missing index.

**result** · shipped the index in a day, kept the rewrite as a written proposal.
`;

interface Seed {
  applications: CareerApplication[];
  steps: CareerStep[];
  questions: CareerQuestion[];
  prep: CareerPrepItem[];
  stories: CareerStory[];
  uses: CareerStoryUse[];
  resources: CareerResource[];
}

/** `today` shifted by whole days, as a plain date, for a dated fixture row. */
function shift(today: string, days: number): string {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seed(today: string, scenario: string): Seed {
  const now = new Date().toISOString();
  const dense = scenario === "dense" || scenario === "long";
  const applications: CareerApplication[] = [
    {
      id: "app-stripe",
      company: "Stripe",
      role: "software engineer intern · summer 2027",
      appliedOn: shift(today, -15),
      stage: "interview",
      postingUrl: "https://stripe.com/jobs/listing",
      location: "seattle",
      processNotes: PROCESS_NOTES,
      updatedAt: now,
    },
    {
      id: "app-ramp",
      company: "Ramp",
      role: "backend intern",
      appliedOn: shift(today, -28),
      stage: "screen",
      postingUrl: null,
      location: "new york",
      processNotes: "one call so far. **no take-home**, which she said up front.",
      updatedAt: now,
    },
    {
      id: "app-linear",
      company: "Linear",
      role: "product engineer intern",
      appliedOn: null,
      stage: "interested",
      postingUrl: "https://linear.app/careers",
      location: "remote",
      processNotes: "",
      updatedAt: now,
    },
  ];
  const steps: CareerStep[] = [
    {
      id: "step-1",
      applicationId: "app-stripe",
      name: "application sent",
      scheduledOn: shift(today, -15),
      position: 0,
      doneAt: now,
      notes: null,
    },
    {
      id: "step-2",
      applicationId: "app-stripe",
      name: "recruiter screen",
      scheduledOn: shift(today, -8),
      position: 1,
      doneAt: now,
      notes: "30 min · logistics, grad date, why fintech. she volunteered the whole loop.",
    },
    {
      id: "step-3",
      applicationId: "app-stripe",
      name: "technical screen",
      scheduledOn: shift(today, 3),
      position: 2,
      doneAt: null,
      notes: "60 min · two medium questions in a shared editor. no whiteboard algorithms.",
    },
    {
      id: "step-4",
      applicationId: "app-stripe",
      name: "onsite loop",
      scheduledOn: null,
      position: 3,
      doneAt: null,
      notes: "2 coding · 1 system design · 1 values. same week as the MATH3012 midterm.",
    },
    {
      id: "step-5",
      applicationId: "app-stripe",
      name: "team match",
      scheduledOn: null,
      position: 4,
      doneAt: null,
      notes: null,
    },
    {
      id: "step-6",
      applicationId: "app-ramp",
      name: "recruiter call",
      scheduledOn: shift(today, -2),
      position: 0,
      doneAt: null,
      notes: null,
    },
  ];
  const questions: CareerQuestion[] = [
    {
      id: "q-1",
      applicationId: "app-stripe",
      body: "how would you make a payment endpoint safe to retry?",
      answer:
        "- one key per user, invoice and attempt, written before the charge\n- a replay returns the first result, never a second charge\n- 24 hour window, then the key is free again",
      tags: ["technical", "systems"],
      askedOn: null,
      createdAt: now,
    },
    {
      id: "q-2",
      applicationId: "app-stripe",
      body: "walk me through what happens when a webhook arrives twice.",
      answer: "the second one finds the row already written and returns the same response.",
      tags: ["systems"],
      askedOn: shift(today, -8),
      createdAt: now,
    },
    {
      id: "q-3",
      applicationId: "app-stripe",
      body: "what do you want to learn here that you can't learn at school?",
      answer: "how a change reaches real money, and who says no to it.",
      tags: ["culture"],
      askedOn: shift(today, -8),
      createdAt: now,
    },
    {
      id: "q-4",
      applicationId: "app-ramp",
      body: "when did a design of yours turn out wrong?",
      answer: null,
      tags: ["culture", "failure"],
      askedOn: null,
      createdAt: now,
    },
  ];
  const prep: CareerPrepItem[] = [
    {
      id: "p-1",
      applicationId: "app-stripe",
      body: "re-read the payments primer",
      dueOn: shift(today, 1),
      doneAt: now,
      todoId: null,
      position: 0,
    },
    {
      id: "p-2",
      applicationId: "app-stripe",
      body: "idempotency keys, retries, webhook ordering",
      dueOn: shift(today, -3),
      doneAt: null,
      todoId: null,
      position: 1,
    },
    {
      id: "p-3",
      applicationId: "app-stripe",
      body: "two questions to ask them about the payments org",
      dueOn: shift(today, 3),
      doneAt: null,
      todoId: null,
      position: 2,
    },
    {
      id: "p-4",
      applicationId: "app-stripe",
      body: "set up the shared editor and run one test before the call",
      dueOn: shift(today, 3),
      doneAt: null,
      todoId: null,
      position: 3,
    },
  ];
  const stories: CareerStory[] = [
    {
      id: "s-1",
      title: "the search rewrite i argued against",
      body: STORY_BODY,
      tags: ["conflict", "influence"],
      updatedAt: now,
    },
    {
      id: "s-2",
      title: "the migration i shipped alone in a week",
      body: "**situation** · nobody owned it.\n\n**what i did** · wrote it forward-only.\n\n**result** · no rollback needed.",
      tags: ["ownership", "scope"],
      updatedAt: now,
    },
    {
      id: "s-3",
      title: "the class project that missed its deadline",
      body: "**situation** · four of us, no one merging.\n\n**what i did** · cut the scope in half.\n\n**result** · shipped two days late, with tests.",
      tags: ["failure", "recovery"],
      updatedAt: now,
    },
  ];
  const resources: CareerResource[] = [
    {
      id: "r-1",
      applicationId: "app-stripe",
      kind: "file",
      title: "resume — sep 2026.pdf",
      url: null,
      contentType: "application/pdf",
      byteSize: 219_136,
      contentSha256: null,
      objectPath: "fixture/resume.pdf",
      uploadedAt: now,
      createdAt: now,
    },
    {
      id: "r-2",
      applicationId: "app-stripe",
      kind: "file",
      title: "cover letter — Stripe.docx",
      url: null,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      byteSize: 38_912,
      contentSha256: null,
      objectPath: "fixture/cover.docx",
      uploadedAt: now,
      createdAt: now,
    },
    {
      id: "r-3",
      applicationId: "app-stripe",
      kind: "link",
      title: "idempotent requests, in their docs",
      url: "https://docs.stripe.com/api/idempotent_requests",
      contentType: null,
      byteSize: null,
      contentSha256: null,
      objectPath: null,
      uploadedAt: null,
      createdAt: now,
    },
    {
      id: "r-4",
      applicationId: "app-stripe",
      kind: "link",
      title: "how they run the systems round",
      url: "https://blog.pragmaticengineer.com/systems-round",
      contentType: null,
      byteSize: null,
      contentSha256: null,
      objectPath: null,
      uploadedAt: null,
      createdAt: now,
    },
  ];
  if (dense) {
    // Enough rows, and enough words in them, to find where the layout gives up.
    for (let index = 0; index < 18; index += 1) {
      steps.push({
        id: `step-dense-${index}`,
        applicationId: "app-stripe",
        name: `follow-up conversation ${index + 1} with the payments platform team about scheduling`,
        scheduledOn: index % 3 === 0 ? shift(today, index - 6) : null,
        position: 5 + index,
        doneAt: index % 4 === 0 ? now : null,
        notes:
          index % 2 === 0
            ? "a note long enough to wrap onto a second and very probably a third line, which is the point of it"
            : null,
      });
      prep.push({
        id: `p-dense-${index}`,
        applicationId: "app-stripe",
        body: `prepare answer ${index + 1}: a line long enough to push the date and the remove word onto their own row`,
        dueOn: shift(today, index - 4),
        doneAt: index % 5 === 0 ? now : null,
        todoId: null,
        position: 10 + index,
      });
      questions.push({
        id: `q-dense-${index}`,
        applicationId: "app-stripe",
        body: `question ${index + 1}: how would you handle a partial failure halfway through a batch of charges, and what would you tell the customer?`,
        answer: index % 2 === 0 ? "write the ledger first, then charge." : null,
        tags: index % 2 === 0 ? ["technical", "systems", "scale"] : ["culture"],
        askedOn: null,
        createdAt: now,
      });
    }
  }
  return {
    applications,
    steps,
    questions,
    prep,
    stories,
    uses: [
      { storyId: "s-1", applicationId: "app-ramp", usedOn: null },
      { storyId: "s-2", applicationId: "app-linear", usedOn: null },
    ],
    resources,
  };
}

/** A `career_resources` reservation, as the real service would hand one back. */
function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createCareerFixtureService(today: string, scenario: string): CareerService {
  const rows = seed(today, scenario);
  // A file uploaded in the fixture stays in the tab, so `open` can hand back
  // exactly what was chosen instead of reaching for storage that is not there.
  const uploads = new Map<string, File>();
  const empty = scenario === "empty";
  if (empty) {
    rows.steps = [];
    rows.questions = [];
    rows.prep = [];
    rows.stories = [];
    rows.uses = [];
    rows.resources = [];
    rows.applications = rows.applications.slice(0, 1).map((row) => ({
      ...row,
      processNotes: "",
      stage: "interested",
      appliedOn: null,
    }));
  }
  const found = <Row extends { id: string }>(list: Row[], id: string, what: string): Row => {
    const row = list.find((item) => item.id === id);
    if (!row) throw new Error(`Fixture ${what} ${id} is not here.`);
    return row;
  };

  return {
    async listApplications(): Promise<CareerApplicationRow[]> {
      return orderApplications(
        rows.applications.map((application) => ({
          ...application,
          nextStep: nextStepOf(rows.steps.filter((step) => step.applicationId === application.id)),
        })),
      );
    },
    async getApplication(_userId, applicationId) {
      return { ...found(rows.applications, applicationId, "application") };
    },
    async createApplication(_userId, draft: CareerApplicationDraft) {
      const application: CareerApplication = {
        id: newId("app"),
        company: draft.company,
        role: draft.role,
        appliedOn: draft.appliedOn ?? null,
        stage: draft.stage ?? "interested",
        postingUrl: draft.postingUrl ?? null,
        location: draft.location ?? null,
        processNotes: draft.processNotes ?? null,
        updatedAt: new Date().toISOString(),
      };
      rows.applications.push(application);
      return application;
    },
    async updateApplication(_userId, applicationId, changes) {
      const application = found(rows.applications, applicationId, "application");
      Object.assign(application, changes, { updatedAt: new Date().toISOString() });
      return { ...application };
    },
    async deleteApplication(applicationId) {
      rows.applications = rows.applications.filter((row) => row.id !== applicationId);
      return { id: applicationId, deletedAt: new Date().toISOString() };
    },
    async restoreApplication() {
      return true;
    },

    async listSteps(_userId, applicationId) {
      return rows.steps
        .filter((step) => step.applicationId === applicationId)
        .map((step) => ({ ...step }));
    },
    async saveStep(_userId, applicationId, step) {
      if (step.id) {
        const existing = found(rows.steps, step.id, "step");
        Object.assign(existing, step);
        return { ...existing };
      }
      const created: CareerStep = {
        id: newId("step"),
        applicationId,
        name: step.name,
        scheduledOn: step.scheduledOn ?? null,
        position: step.position ?? rows.steps.length,
        doneAt: step.doneAt ?? null,
        notes: step.notes ?? null,
      };
      rows.steps.push(created);
      return created;
    },
    async removeStep(_userId, stepId) {
      rows.steps = rows.steps.filter((step) => step.id !== stepId);
    },

    async listQuestions(_userId, applicationId) {
      return rows.questions
        .filter((question) => question.applicationId === applicationId)
        .map((question) => ({ ...question }));
    },
    async listQuestionsByTag(_userId, tag) {
      return rows.questions
        .filter((question) => question.tags.includes(tag))
        .map((question) => ({ ...question }));
    },
    async saveQuestion(_userId, applicationId, question) {
      const tags = (question.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      if (question.id) {
        const existing = found(rows.questions, question.id, "question");
        Object.assign(existing, question, question.tags ? { tags } : {});
        return { ...existing };
      }
      const created: CareerQuestion = {
        id: newId("q"),
        applicationId,
        body: question.body,
        answer: question.answer ?? null,
        tags: [...new Set(tags)],
        askedOn: question.askedOn ?? null,
        createdAt: new Date().toISOString(),
      };
      rows.questions.push(created);
      return created;
    },
    async removeQuestion(_userId, questionId) {
      rows.questions = rows.questions.filter((question) => question.id !== questionId);
    },

    async listPrep(_userId, applicationId) {
      return rows.prep
        .filter((item) => item.applicationId === applicationId)
        .map((item) => ({ ...item }));
    },
    async savePrep(_userId, applicationId, item) {
      if (item.id) {
        const existing = found(rows.prep, item.id, "prep item");
        Object.assign(existing, item);
        return { ...existing };
      }
      const created: CareerPrepItem = {
        id: newId("p"),
        applicationId,
        body: item.body,
        dueOn: item.dueOn ?? null,
        doneAt: item.doneAt ?? null,
        todoId: item.todoId ?? null,
        position: item.position ?? rows.prep.length,
      };
      rows.prep.push(created);
      return created;
    },
    async removePrep(_userId, itemId) {
      rows.prep = rows.prep.filter((item) => item.id !== itemId);
    },

    async listStories() {
      return rows.stories.map((story) => ({ ...story }));
    },
    async saveStory(_userId, story) {
      const tags = (story.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      if (story.id) {
        const existing = found(rows.stories, story.id, "story");
        Object.assign(existing, story, story.tags ? { tags } : {}, {
          updatedAt: new Date().toISOString(),
        });
        return { ...existing };
      }
      const created: CareerStory = {
        id: newId("s"),
        title: story.title,
        body: story.body,
        tags: [...new Set(tags)],
        updatedAt: new Date().toISOString(),
      };
      rows.stories.push(created);
      return created;
    },
    async removeStory(_userId, storyId) {
      rows.stories = rows.stories.filter((story) => story.id !== storyId);
      rows.uses = rows.uses.filter((use) => use.storyId !== storyId);
    },
    async listStoryUses() {
      return rows.uses.map((use) => ({ ...use }));
    },
    async recordStoryUse(_userId, use) {
      rows.uses = [
        ...rows.uses.filter(
          (row) => row.storyId !== use.storyId || row.applicationId !== use.applicationId,
        ),
        use,
      ];
      return use;
    },
    async removeStoryUse(_userId, storyId, applicationId) {
      rows.uses = rows.uses.filter(
        (use) => use.storyId !== storyId || use.applicationId !== applicationId,
      );
    },

    async listResources(_userId, applicationId) {
      return rows.resources
        .filter((resource) => resource.applicationId === applicationId)
        .map((resource) => ({ ...resource }));
    },
    async addLink(_userId, applicationId, link) {
      const created: CareerResource = {
        id: newId("r"),
        applicationId,
        kind: "link",
        title: link.title,
        url: link.url,
        contentType: null,
        byteSize: null,
        contentSha256: null,
        objectPath: null,
        uploadedAt: null,
        createdAt: new Date().toISOString(),
      };
      rows.resources.push(created);
      return created;
    },
    async reserveFile(_userId, applicationId, draft) {
      const reserved: CareerResource = {
        id: draft.id,
        applicationId,
        kind: "file",
        title: draft.name,
        url: null,
        contentType: draft.contentType,
        byteSize: draft.size,
        contentSha256: draft.sha256,
        objectPath: `fixture/${draft.id}`,
        uploadedAt: null,
        createdAt: new Date().toISOString(),
      };
      rows.resources.push(reserved);
      return reserved;
    },
    async uploadFile(resource, file) {
      uploads.set(resource.id, file);
      const existing = found(rows.resources, resource.id, "resource");
      existing.uploadedAt = new Date().toISOString();
      return { ...existing };
    },
    async downloadFile(resource) {
      const file = uploads.get(resource.id);
      if (file) return file;
      // A seeded row has no bytes behind it; a readable stand-in says so rather
      // than failing, so the open path is still exercisable.
      return new File([`${resource.title}\n\nThis fixture file has no contents.`], resource.title, {
        type: resource.contentType ?? "text/plain",
      });
    },
    async removeResource(_userId, resource) {
      uploads.delete(resource.id);
      rows.resources = rows.resources.filter((row) => row.id !== resource.id);
    },
  };
}
