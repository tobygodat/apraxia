import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

// Only positively identified documentation and styles can skip database work.
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
      /^frontend\/src\/.+\.css$/.test(file);
    if (paths.length > 0 && paths.every(documentationOrStyle)) {
      return {
        required: false,
        reason: "Documentation/styles only: database execution is not required.",
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
