import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it } from "vitest";
import { storageHarnessSql } from "../helpers/storageHarness";

// The QA fixture's Ctrl+K is a substring stub, so the only honest evidence for
// what search matches is the SQL itself. pgTAP covers grants and role posture;
// this covers the matching, the kinds, and the stemming that pgTAP would only
// repeat more slowly.

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
// Long enough that its title is cut, so the snippet has something left to say.
const longTask =
  "Pack the kayak trailer before dawn: straps, pump, spare paddle, dry bags, " +
  "cooler, tide chart, first aid kit, handheld radio, printed charts, and the " +
  "permit for the harbour launch ramp.";
const untitledIdea =
  "A telescope mount that folds into a rucksack, so a clear night away from " +
  "the city needs one bag rather than three.";
let database: PGlite;

type Result = {
  record_type: string;
  record_id: string;
  parent_id: string | null;
  title: string;
  snippet: string;
};

async function search(query: string): Promise<Result[]> {
  const { rows } = await database.query<Result>(
    "select record_type::text as record_type, record_id, parent_id, title, snippet" +
      " from public.search_records($1)",
    [query],
  );
  return rows;
}

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls; create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  await database.exec(storageHarnessSql);
  const names = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
  for (const name of names)
    await database.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await database.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
  await database.exec(`
    insert into public.classes(user_id,id,name) values
      ('${owner}','MATH3012','Linear Algebra'),
      ('${owner}','HIST1100',null),
      ('${owner}','IT',null),
      ('${owner}','STUDIES','Media studies'),
      ('${other}','MATH3012','Another account''s linear algebra');
    insert into public.projects(id,user_id,title,description) values
      ('a4000000-0000-4000-8000-000000000001','${owner}','Shelving','Build the reading shelves');
    insert into public.ideas(id,user_id,title,body) values
      ('a4000000-0000-4000-8000-000000000002','${owner}','Bookmarks','Save the good essays');
    insert into public.todos(id,user_id,text,class_id,assignment_type) values
      ('a4000000-0000-4000-8000-000000000003','${owner}','Problem set on eigenvectors','MATH3012','Homework');
    insert into public.todos(id,user_id,text) values
      ('a4000000-0000-4000-8000-000000000004','${owner}','Return the library books'),
      ('a4000000-0000-4000-8000-000000000005','${owner}','Renew the library books'),
      ('a4000000-0000-4000-8000-000000000007','${owner}','${longTask}');
    insert into public.ideas(id,user_id,title,body) values
      ('a4000000-0000-4000-8000-000000000008','${owner}',null,'${untitledIdea}');
    insert into public.projects(id,user_id,title,description) values
      ('a4000000-0000-4000-8000-000000000009','${owner}','Reglaze the greenhouse',
       'Reglaze the greenhouse');
    insert into public.class_notes(id,user_id,course_id,name,source,drive_file_id) values
      ('a4000000-0000-4000-8000-000000000006','${owner}','MATH3012','Week 3 lecture slides','drive','drive-file-1');
    update public.todos set deleted_at = statement_timestamp()
      where id = 'a4000000-0000-4000-8000-000000000005';
  `);
  await database.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}'`);
}, 60_000);

afterAll(async () => {
  await database.close();
});

it("stems English words so a singular query finds a plural record and back", async () => {
  expect((await search("book")).map((r) => r.title)).toEqual(["Return the library books"]);
  expect((await search("libraries")).map((r) => r.title)).toEqual(["Return the library books"]);
  expect((await search("builds")).map((r) => r.title)).toEqual(["Shelving"]);
  expect((await search("essay")).map((r) => r.title)).toEqual(["Bookmarks"]);
  expect((await search("lectures")).map((r) => r.title)).toEqual(["Week 3 lecture slides"]);
});

it("finds a class, its assignments, and its saved notes from one course code", async () => {
  const rows = await search("MATH3012");
  expect(rows.map((r) => [r.record_type, r.record_id, r.parent_id]).sort()).toEqual([
    ["assignment", "a4000000-0000-4000-8000-000000000003", "MATH3012"],
    ["class", "MATH3012", null],
    ["class_note", "a4000000-0000-4000-8000-000000000006", "MATH3012"],
  ]);
});

it("identifies a class by its course code and keeps a nameless class findable", async () => {
  expect((await search("algebra")).map((r) => [r.record_type, r.record_id, r.title])).toEqual([
    ["class", "MATH3012", "Linear Algebra"],
  ]);
  expect((await search("HIST1100")).map((r) => [r.record_id, r.title, r.snippet])).toEqual([
    ["HIST1100", "HIST1100", ""],
  ]);
});

it("finds a course code that English stems away or stems differently", async () => {
  // 'IT' is an English stopword, so both the stemmed vector and a stemmed query
  // are empty; 'STUDIES' stems to 'studi', which is not the text itself.
  expect((await search("IT")).map((r) => [r.record_type, r.record_id])).toEqual([["class", "IT"]]);
  expect((await search("STUDIES")).map((r) => [r.record_type, r.record_id])).toEqual([
    ["class", "STUDIES"],
  ]);
  expect((await search("studies")).map((r) => r.record_id)).toEqual(["STUDIES"]);
});

it("returns nothing for an unmatched query and for one that only excludes", async () => {
  expect(await search("the of and")).toEqual([]);
  expect(await search("-book")).toEqual([]);
  expect(await search("   ")).toEqual([]);
});

it("separates an assignment from a task without a class", async () => {
  expect((await search("eigenvectors")).map((r) => r.record_type)).toEqual(["assignment"]);
  expect((await search("book")).map((r) => [r.record_type, r.parent_id])).toEqual([["todo", null]]);
});

it("excludes soft-deleted tasks and every record another account owns", async () => {
  expect((await search("renew")).map((r) => r.title)).toEqual([]);
  await database.exec(`set request.jwt.claim.sub = '${other}'`);
  expect((await search("MATH3012")).map((r) => [r.record_type, r.title])).toEqual([
    ["class", "Another account's linear algebra"],
  ]);
  await database.exec(`set request.jwt.claim.sub = '${owner}'`);
});

it("keeps every search vector on a partial or plain GIN index", async () => {
  const { rows } = await database.query<{ indexname: string }>(
    `select indexname from pg_indexes
     where schemaname = 'public' and indexdef like '%gin (search_vector)%'
     order by indexname`,
  );
  expect(rows.map((r) => r.indexname)).toEqual([
    "class_notes_search_idx",
    "classes_search_idx",
    "ideas_search_idx",
    "projects_search_idx",
    "todos_search_idx",
  ]);
});

it("keeps the delete and restore contract on its own narrower record type", async () => {
  const { rows } = await database.query<{ kinds: string }>(
    `select enum_range(null::public.orbitos_record_type)::text as kinds`,
  );
  expect(rows).toEqual([{ kinds: "{todo,idea,project}" }]);
  const search = await database.query<{ kinds: string }>(
    `select enum_range(null::public.search_record_type)::text as kinds`,
  );
  expect(search.rows).toEqual([{ kinds: "{todo,assignment,idea,project,class,class_note}" }]);
});

it("never prints a record's own text twice in one row", async () => {
  // A task is only its text, so it belongs in the title and nowhere else.
  expect((await search("book")).map((r) => [r.title, r.snippet])).toEqual([
    ["Return the library books", ""],
  ]);
  // An idea with no title of its own, and a project described by its title.
  expect((await search("telescope")).map((r) => [r.title, r.snippet])).toEqual([
    [untitledIdea, ""],
  ]);
  expect((await search("greenhouse")).map((r) => [r.title, r.snippet])).toEqual([
    ["Reglaze the greenhouse", ""],
  ]);
});

it("continues a cut title in the snippet instead of restarting it", async () => {
  const rows = await search("kayak");
  expect(rows.map((r) => [r.title, r.snippet])).toEqual([
    [
      "Pack the kayak trailer before dawn: straps, pump, spare paddle, dry bags, " +
        "cooler, tide chart, first aid kit, handheld radio, printed charts, and the " +
        "permit for",
      "the harbour launch ramp.",
    ],
  ]);
  // Title and snippet together are the task, each word once and in order.
  expect(rows.map((r) => `${r.title} ${r.snippet}`)).toEqual([longTask]);
});
