// Captures one QA fixture route across scenarios and viewports in a single
// playwright-cli session and writes one collage, so a layout check is one
// command and one image instead of a navigate-and-screenshot loop.
//
//   npm run qa:capture -- --route=/todos
//   npm run qa:capture -- --route=/settings --scenarios=personal,dense,empty --theme=paper
//
// Needs the dev server (`npm run dev:web`). Desktop is the owner's real window,
// 1218x1133 at device pixel ratio 1.44; phone is 375x812. The report lists
// console errors and elements wider than the viewport. Output goes to the
// gitignored frontend/qa/local/captures/: `personal` captures are personal data.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "frontend/qa/local/captures");
const session = "apraxia-qa-capture";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [name, ...value] = argument.replace(/^--/, "").split("=");
    return [name, value.join("=")];
  }),
);
const capture = {
  scenarios: (options.scenarios ?? "personal,dense").split(","),
  viewports: [
    { name: "desktop", width: 1218, height: 1133 },
    { name: "phone", width: 375, height: 812 },
  ].filter(
    (viewport) => !options.viewports || options.viewports.split(",").includes(viewport.name),
  ),
  output,
  // The snippet runs in a bare context without URLSearchParams.
  url: Object.fromEntries(
    (options.scenarios ?? "personal,dense").split(",").map((scenario) => {
      const query = new URLSearchParams({ scenario, route: options.route ?? "/" });
      if (options.theme) query.set("theme", options.theme);
      const base = (options.base ?? "http://localhost:5173").replace(/\/$/, "");
      return [scenario, `${base}/qa/${options.page ?? "workspace"}.html?${query}`];
    }),
  ),
  stem: `${options.route ?? "/"}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home",
};

// Runs inside playwright-cli, which supplies `page`; nothing here can close
// over this file, so the settings arrive as a JSON literal.
const snippet = `async (page) => {
  const capture = ${JSON.stringify(capture)};
  const messages = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) messages.push(message.text());
  });
  page.on("pageerror", (error) => messages.push(String(error)));
  const shots = [];
  for (const scenario of capture.scenarios) {
    for (const viewport of capture.viewports) {
      messages.length = 0;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(capture.url[scenario], { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const describe = (element) =>
          element.tagName.toLowerCase() +
          (element.id ? "#" + element.id : "") +
          (typeof element.className === "string" && element.className
            ? "." + element.className.trim().split(/\\s+/).slice(0, 2).join(".")
            : "");
        const wide = [...document.body.querySelectorAll("*")].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && (box.right > width + 1 || box.left < -1);
        });
        // Content past the edge is only a fault when the page itself scrolls:
        // a board that scrolls inside its own container is meant to. Report the
        // outermost offenders, since their descendants follow from them.
        const pageScrolls = document.documentElement.scrollWidth > width;
        return {
          pageScrolls,
          elements: !pageScrolls ? [] : wide.filter((element) => !wide.includes(element.parentElement)).slice(0, 8).map(describe),
        };
      });
      const name = [capture.stem, scenario, viewport.name].join("_") + ".png";
      const image = await page.screenshot({ path: capture.output + "/" + name, scale: "device" });
      shots.push({ scenario, viewport, name, overflow, errors: [...messages], image: image.toString("base64") });
    }
  }
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 1700, height: 900 });
  await sheet.setContent(
    "<body style='margin:0;padding:16px;background:#777;font:600 15px system-ui;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap'>" +
      shots
        .map((shot) => {
          const flagged = shot.overflow.pageScrolls || shot.errors.length;
          return "<figure style='margin:0'><figcaption style='padding:4px 8px;color:#fff;background:" +
            (flagged ? "#b00020" : "#222") + "'>" + shot.scenario + " · " + shot.viewport.name + " " +
            shot.viewport.width + "×" + shot.viewport.height +
            (shot.overflow.pageScrolls ? " · SCROLLS SIDEWAYS" : "") +
            (shot.errors.length ? " · " + shot.errors.length + " console error(s)" : "") +
            "</figcaption><img style='display:block;width:" + shot.viewport.width + "px' src='data:image/png;base64," +
            shot.image + "'></figure>";
        })
        .join("") +
      "</body>",
  );
  await sheet.screenshot({ path: capture.output + "/" + capture.stem + "_collage.png", fullPage: true, scale: "css" });
  await sheet.close();
  return shots.map(({ image, ...shot }) => shot);
}`;

function cli(...args) {
  const result = spawnSync("npx", ["playwright-cli", `-s=${session}`, ...args], {
    cwd: output,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0 || result.stdout.startsWith("### Error")) {
    throw new Error(result.stdout + result.stderr);
  }
  return result.stdout;
}

mkdirSync(output, { recursive: true });
// The snippet lives outside the repository so lint never reads generated code.
const scratch = mkdtempSync(resolve(tmpdir(), "apraxia-qa-capture-"));
writeFileSync(resolve(scratch, "capture.js"), snippet);

cli("open", `--config=${resolve(root, "scripts/qa-playwright.json")}`);
let report;
try {
  report = JSON.parse(cli("--raw", "run-code", `--filename=${resolve(scratch, "capture.js")}`));
} finally {
  spawnSync("npx", ["playwright-cli", `-s=${session}`, "close"], { cwd: output });
  rmSync(scratch, { recursive: true, force: true });
}

for (const shot of report) {
  const problems = [
    shot.overflow.pageScrolls && "page scrolls sideways",
    shot.overflow.elements.length && `past the viewport: ${shot.overflow.elements.join(", ")}`,
    ...shot.errors.map((error) => `console: ${error.slice(0, 200)}`),
  ].filter(Boolean);
  console.log(
    `${shot.scenario} · ${shot.viewport.name}: ${problems.length ? problems.join("; ") : "clean"}`,
  );
}
console.log(resolve(output, `${capture.stem}_collage.png`));
if (report.some((shot) => shot.overflow.pageScrolls || shot.errors.length)) process.exitCode = 1;
