import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

// Only positively identified paths that cannot change a job's result skip that
// job. Unknown events, missing history, empty diffs, and errors always run it.

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Shared vocabulary. A test file is executed, never imported, so it can only
// reach the suite whose include pattern matches it.
const documentationOrStyle = (file) =>
  /^(AGENTS|README|PRODUCT|DESIGN)\.md$/.test(file) ||
  /^docs\/.+\.md$/.test(file) ||
  /^\.impeccable\//.test(file) ||
  /^frontend\/src\/.+\.css$/.test(file);
const contractSuiteTest = (file) => /^tests\/contract\//.test(file);
const frontendSuiteTest = (file) => /^frontend\/src\/.+\.test\.tsx?$/.test(file);
const localSuiteTest = (file) =>
  /^tests\/local\//.test(file) || /^frontend\/tests\/local\//.test(file);
const qaFixture = (file) => /^frontend\/src\/qa\//.test(file) || /^frontend\/qa\//.test(file);

// The database job executes tests/local and frontend/tests/local only, and the
// static job repeats its typecheck.
const outsideDatabaseJob = (file) =>
  contractSuiteTest(file) || qaFixture(file) || frontendSuiteTest(file);

// The contract job replays supabase/migrations into PGlite and imports the api
// handlers, the server and the frontend service and type modules, so a change
// to any of those runs it. A .ts module can import a .tsx one, so a component
// is inert here only when it is a test file. Nothing in it reads the pgTAP
// suite, which the database job owns.
const outsideContractJob = (file) =>
  frontendSuiteTest(file) ||
  localSuiteTest(file) ||
  qaFixture(file) ||
  /^supabase\/tests\/.+\.sql$/.test(file);

// The frontend job executes frontend/src only. Nothing under it imports the
// api handlers, the standalone suites or supabase (ci-scope.test.ts checks),
// and no test there reads the working tree, so those paths cannot change its
// result. server/ is not among them: the QA calendar fixture imports it.
const outsideFrontendJob = (file) =>
  localSuiteTest(file) || /^tests\//.test(file) || /^api\//.test(file) || /^supabase\//.test(file);

const jobs = {
  database: {
    label: "Database scope",
    // A component reaches the database through a service module (.ts), which
    // always runs the suite. One that names Supabase or the generated types on
    // either side of the diff is data code, not presentation.
    skippable: (file, range) =>
      documentationOrStyle(file) ||
      outsideDatabaseJob(file) ||
      presentationalComponent(file, range),
    skipReason:
      "Documentation, styles, presentational components, or tests outside the database job only: database execution is not required.",
    runReason: "Code, configuration, or an empty diff: run the full database suite.",
  },
  contract: {
    label: "Contract test scope",
    skippable: (file) => documentationOrStyle(file) || outsideContractJob(file),
    skipReason:
      "Documentation, styles, or tests and fixtures outside the contract job only: the contract suite is not required.",
    runReason: "Code, configuration, or an empty diff: run the contract suite.",
  },
  frontend: {
    label: "Frontend test scope",
    skippable: (file) => documentationOrStyle(file) || outsideFrontendJob(file),
    skipReason:
      "Documentation, styles, or code and tests outside frontend/src only: the frontend suite is not required.",
    runReason: "Code, configuration, or an empty diff: run the frontend suite.",
  },
};

function presentationalComponent(file, { start, head }) {
  const contentAt = (revision) =>
    git(["--literal-pathspecs", "ls-tree", "-r", "--name-only", revision, "--", file])
      ? git(["show", `${revision}:${file}`])
      : "";
  return (
    /^frontend\/src\/.+\.tsx$/.test(file) &&
    ![start, head].some((revision) => /supabase|types\/database/i.test(contentAt(revision)))
  );
}

function scope(job) {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request" && eventName !== "push") {
    return { required: true, reason: `Manual or unknown event: run ${job.name}.` };
  }

  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const base = eventName === "pull_request" ? event.pull_request?.base?.sha : event.before;
    const head = process.env.GITHUB_SHA;
    if (![base, head].every((sha) => /^[a-f0-9]{40}$/i.test(sha) && !/^0+$/.test(sha))) {
      throw new Error("Missing comparison commits");
    }
    const start = eventName === "pull_request" ? git(["merge-base", base, head]).trim() : base;
    // Disabling rename detection keeps both old and new paths in the decision.
    const paths = git(["diff", "--name-only", "--no-renames", "-z", start, head, "--"])
      .split("\0")
      .filter(Boolean);
    if (paths.length > 0 && paths.every((file) => job.skippable(file, { start, head }))) {
      return { required: false, reason: job.skipReason };
    }
    return { required: true, reason: job.runReason };
  } catch {
    return { required: true, reason: `Could not establish the changed paths: run ${job.name}.` };
  }
}

const name = process.argv[2];
const job = jobs[name];
if (!job) {
  console.error(`Usage: ci-scope.mjs <${Object.keys(jobs).join("|")}>`);
  process.exit(2);
}
const result = scope({ ...job, name: `the ${name} suite` });
console.log(result.reason);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `required=${result.required}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${job.label}\n\n${result.reason}\n`);
}
