/**
 * A `CareerService` backed by arrays in this tab, for the QA workspace fixture.
 *
 * Every company, role and note below is invented. The rounds are dated relative
 * to the fixture's own "today", so the table shows a late step, a step due this
 * week and applications with nothing scheduled without the dates going stale.
 */
import { addSqlDateDays } from "../features/todos/dateDomain";
import { nextStepOf } from "../features/career/careerOrdering";
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
    stories.push({
      id: id("story"),
      title: "The migration nobody wanted to own",
      body: "Situation, task, action, result.",
      tags: ["ownership", "ambiguity"],
      updatedAt: now,
    });
  }

  const rowsFor = (): CareerApplicationRow[] =>
    applications.map((application) => ({
      ...application,
      nextStep: nextStepOf(steps.filter((step) => step.applicationId === application.id)),
    }));

  const find = (applicationId: string): CareerApplication => {
    const application = applications.find((row) => row.id === applicationId);
    if (!application) throw new Error("That application is no longer here.");
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
      if (!file) throw new Error("That file is still uploading.");
      return file;
    },
    async removeResource(_userId, resource) {
      files.delete(resource.id);
      const index = resources.findIndex((row) => row.id === resource.id);
      if (index >= 0) resources.splice(index, 1);
    },
  };
}
