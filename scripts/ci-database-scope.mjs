import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

// Only positively identified paths that cannot change a database result skip it.
// Unknown events, missing history, empty diffs, and errors always run the suite.
function databaseScope() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName !== "pull_request" && eventName !== "push") {
    return { required: true, reason: "Manual or unknown event: run the full database suite." };
  }

  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const base = eventName === "pull_request" ? event.pull_request?.base?.sha : event.before;
    const head = process.env.GITHUB_SHA;
    if (![base, head].every((sha) => /^[a-f0-9]{40}$/i.test(sha) && !/^0+$/.test(sha))) {
      throw new Error("Missing comparison commits");
    }
    const git = (args) =>
      execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const start = eventName === "pull_request" ? git(["merge-base", base, head]).trim() : base;
    // Disabling rename detection keeps both old and new paths in the decision.
    const paths = git(["diff", "--name-only", "--no-renames", "-z", start, head, "--"])
      .split("\0")
      .filter(Boolean);
    const documentationOrStyle = (file) =>
      /^(AGENTS|README|PRODUCT|DESIGN)\.md$/.test(file) ||
      /^docs\/.+\.md$/.test(file) ||
      /^\.impeccable\//.test(file) ||
      /^frontend\/src\/.+\.css$/.test(file);
    // None of these run in the database job: it executes tests/local and
    // frontend/tests/local only, and the static job repeats its typecheck.
    const outsideDatabaseJob = (file) =>
      /^tests\/contract\//.test(file) ||
      /^frontend\/qa\//.test(file) ||
      /^frontend\/src\/qa\//.test(file) ||
      /^frontend\/src\/.+\.test\.tsx?$/.test(file);
    // A component reaches the database through a service module (.ts), which
    // always runs the suite. One that names Supabase or the generated types on
    // either side of the diff is data code, not presentation.
    const contentAt = (revision, file) =>
      git(["--literal-pathspecs", "ls-tree", "-r", "--name-only", revision, "--", file])
        ? git(["show", `${revision}:${file}`])
        : "";
    const presentationalComponent = (file) =>
      /^frontend\/src\/.+\.tsx$/.test(file) &&
      ![start, head].some((revision) =>
        /supabase|types\/database/i.test(contentAt(revision, file)),
      );
    const skippable = (file) =>
      documentationOrStyle(file) || outsideDatabaseJob(file) || presentationalComponent(file);
    if (paths.length > 0 && paths.every(skippable)) {
      return {
        required: false,
        reason:
          "Documentation, styles, presentational components, or tests outside the database job only: database execution is not required.",
      };
    }
    return {
      required: true,
      reason: "Code, configuration, or an empty diff: run the full database suite.",
    };
  } catch {
    return {
      required: true,
      reason: "Could not establish the changed paths: run the full database suite.",
    };
  }
}

const result = databaseScope();
console.log(result.reason);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `required=${result.required}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Database scope\n\n${result.reason}\n`);
}
