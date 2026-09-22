import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { storageHarnessSql } from "../helpers/storageHarness";

// One account per concern: the suite shares a single migrated database, so
// replaying every migration per case cannot push a case past its timeout.
const OWNER = "11111111-1111-4111-8111-111111111111";
const ONLOOKER = "22222222-2222-4222-8222-222222222222";
const TAG_OWNER = "33333333-3333-4333-8333-333333333333";
const UPLOAD_OWNER = "44444444-4444-4444-8444-444444444444";
const SEARCH_OWNER = "55555555-5555-4555-8555-555555555555";
const STEP_OWNER = "66666666-6666-4666-8666-666666666666";
const INTEGRATION_OWNER = "77777777-7777-4777-8777-777777777777";
const OWNERS = [
  OWNER,
  ONLOOKER,
  TAG_OWNER,
  UPLOAD_OWNER,
  SEARCH_OWNER,
  STEP_OWNER,
  INTEGRATION_OWNER,
];

async function migrated(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls; create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  await db.exec(storageHarnessSql);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  for (const owner of OWNERS) await db.query("insert into auth.users(id) values ($1)", [owner]);
  return db;
}

describe("career prep", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrated();
  }, 120_000);

  afterEach(async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  });

  afterAll(async () => {
    await db.close();
  });

  async function signIn(userId: string): Promise<void> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  async function addApplication(company: string, role: string): Promise<string> {
    const rows = await db.query<{ id: string }>(
      "insert into career_applications(company, role) values ($1, $2) returning id::text",
      [company, role],
    );
    return rows.rows[0]!.id;
  }

  it("keeps an application and everything hanging off it to its owner", async () => {
    await signIn(OWNER);
    const application = await addApplication("Stripe", "Backend engineer");
    await db.query(
      "insert into career_steps(application_id,name,scheduled_on) values ($1,'Technical screen','2026-10-01')",
      [application],
    );
    await db.query(
      "insert into career_questions(application_id,body,answer,tags) values ($1,'Design a rate limiter','Token bucket',array['system design'])",
      [application],
    );
    await db.query("select * from import_career_prep_items($1,$2::jsonb)", [
      application,
      JSON.stringify([
        {
          id: "11111111-aaaa-4aaa-8aaa-111111111111",
          body: "Re-read the posting",
          due_on: null,
        },
      ]),
    ]);
    await db.query(
      "insert into career_resources(application_id,kind,title,content_type,byte_size,content_sha256) values ($1,'file','resume.pdf','application/pdf',1024,$2)",
      [application, "a".repeat(64)],
    );
    await db.query(
      "insert into career_resources(application_id,kind,title,url) values ($1,'link','Their engineering blog','https://example.test/blog')",
      [application],
    );
    const story = (
      await db.query<{ id: string }>(
        "insert into career_stories(title,body,tags) values ('The migration that went wrong','Situation, action, result',array['failure']) returning id::text",
      )
    ).rows[0]!;
    await db.query("insert into career_story_uses(story_id,application_id) values ($1,$2)", [
      story.id,
      application,
    ]);

    await signIn(ONLOOKER);
    for (const table of [
      "career_applications",
      "career_steps",
      "career_questions",
      "career_prep",
      "career_resources",
      "career_stories",
      "career_story_uses",
    ])
      expect(
        (await db.query<{ count: number }>(`select count(*)::int as count from ${table}`)).rows,
        `${table} is private`,
      ).toEqual([{ count: 0 }]);

    // A guessed application id cannot be adopted: the foreign key carries the
    // owner, so the row the onlooker names does not exist for them.
    await expect(
      db.query("select * from import_career_prep_items($1,$2::jsonb)", [
        application,
        JSON.stringify([
          {
            id: "22222222-aaaa-4aaa-8aaa-222222222222",
            body: "Borrowed",
            due_on: null,
          },
        ]),
      ]),
    ).rejects.toThrow(/Application unavailable|P0002/i);
  });

  it("refuses browser writes to the columns the database owns", async () => {
    await signIn(OWNER);
    const application = await addApplication("Figma", "Product engineer");

    // deleted_at belongs to soft_delete_record, not to an update statement, and
    // the browser never hard deletes an application.
    await expect(db.query("update career_applications set deleted_at = now()")).rejects.toThrow(
      /permission denied|42501/i,
    );
    await expect(db.query("delete from career_applications")).rejects.toThrow(
      /permission denied|42501/i,
    );
    await expect(
      db.query(
        "insert into career_resources(application_id,kind,title,content_type,byte_size,content_sha256,uploaded_at) values ($1,'file','early.pdf','application/pdf',10,$2,now())",
        [application, "a".repeat(64)],
      ),
    ).rejects.toThrow(/permission denied|42501/i);
    // The stage is a fixed list, not free text.
    await expect(db.query("update career_applications set stage = 'ghosted'")).rejects.toThrow(
      /invalid input value for enum/i,
    );
    // A posting link has to be a link.
    await expect(
      db.query("update career_applications set posting_url = 'javascript:alert(1)'"),
    ).rejects.toThrow(/career_applications_posting_url_bounded/);
    await expect(db.query("update career_applications set company = '  '")).rejects.toThrow(
      /career_applications_company_bounded/,
    );
  });

  it("soft deletes and restores an application through the shared record RPCs", async () => {
    await signIn(OWNER);
    const application = await addApplication("Linear", "Design engineer");
    const deletedAt = (
      await db.query<{ at: string }>("select soft_delete_record('application', $1)::text as at", [
        application,
      ])
    ).rows[0]!.at;
    expect(deletedAt).toBeTruthy();
    // A deleted application leaves the browser's view entirely, so undo has to
    // come from restore_record and the timestamp the delete returned.
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from career_applications where id = $1",
          [application],
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await db.query("update career_applications set stage = 'offer' where id = $1", [
          application,
        ])
      ).affectedRows,
    ).toBe(0);
    expect(
      (
        await db.query<{ restored: boolean }>(
          "select restore_record('application', $1, $2::timestamptz) as restored",
          [application, deletedAt],
        )
      ).rows,
    ).toEqual([{ restored: true }]);
    // A stale undo, replayed after the row came back, changes nothing.
    expect(
      (
        await db.query<{ restored: boolean }>(
          "select restore_record('application', $1, $2::timestamptz) as restored",
          [application, deletedAt],
        )
      ).rows,
    ).toEqual([{ restored: false }]);
    expect(
      (
        await db.query<{ stage: string }>(
          "select stage::text from career_applications where id = $1",
          [application],
        )
      ).rows,
    ).toEqual([{ stage: "interested" }]);
  });

  it("keeps Career and its canonical todo in one state across edits, retries and deletes", async () => {
    await signIn(INTEGRATION_OWNER);
    const application = await addApplication("Canonical", "Systems engineer");
    const first = "77777777-aaaa-4aaa-8aaa-777777777771";
    const independent = "77777777-aaaa-4aaa-8aaa-777777777772";
    const imported = JSON.stringify([
      { id: first, body: "Draft the project story", due_on: "2026-10-02" },
      { id: independent, body: "Research the team", due_on: "2026-10-03" },
    ]);

    expect(
      (
        await db.query<{ id: string; todo_id: string }>(
          "select id::text,todo_id::text from import_career_prep_items($1,$2::jsonb)",
          [application, imported],
        )
      ).rows,
    ).toEqual([
      { id: first, todo_id: first },
      { id: independent, todo_id: independent },
    ]);

    // Task edits are canonical and the trigger projects all three shared fields
    // into Career in the same transaction.
    await db.query(
      "update todos set text='Practice the project story aloud',due_date='2026-10-05',completed=true where id=$1",
      [first],
    );
    expect(
      (
        await db.query<{ body: string; due_on: string; done: boolean }>(
          "select body,due_on::text,done_at is not null as done from career_prep where id=$1",
          [first],
        )
      ).rows,
    ).toEqual([{ body: "Practice the project story aloud", due_on: "2026-10-05", done: true }]);

    // Replaying the stale plan is a read-only receipt. It neither duplicates
    // the rows nor overwrites the task changes made after the first commit.
    await db.query("select * from import_career_prep_items($1,$2::jsonb)", [application, imported]);
    expect(
      (
        await db.query<{ count: number; text: string; due_date: string; completed: boolean }>(
          `select count(*)::int as count,min(text) as text,min(due_date)::text as due_date,
                  bool_and(completed) as completed
           from todos where id=$1`,
          [first],
        )
      ).rows,
    ).toEqual([
      {
        count: 1,
        text: "Practice the project story aloud",
        due_date: "2026-10-05",
        completed: true,
      },
    ]);

    // A Career edit writes through the same todo and preserves fields omitted
    // by that control. Here the date stays put while the checkbox reopens it.
    await db.query("select save_career_prep_item($1,$2::jsonb)", [
      application,
      JSON.stringify({ id: first, completed: false }),
    ]);
    expect(
      (
        await db.query<{ text: string; due_date: string; completed: boolean }>(
          "select text,due_date::text,completed from todos where id=$1",
          [first],
        )
      ).rows,
    ).toEqual([
      {
        text: "Practice the project story aloud",
        due_date: "2026-10-05",
        completed: false,
      },
    ]);

    await db.query("select save_career_prep_item($1,$2::jsonb)", [
      application,
      JSON.stringify({ id: first, body: "Career-side wording" }),
    ]);
    expect(
      (await db.query<{ text: string }>("select text from todos where id=$1", [first])).rows,
    ).toEqual([{ text: "Career-side wording" }]);

    const independentToken = (
      await db.query<{ token: string }>("select soft_delete_record('todo',$1)::text as token", [
        independent,
      ])
    ).rows[0]!.token;
    expect((await db.query("select id from career_prep where id=$1", [independent])).rows).toEqual(
      [],
    );

    // A replay after Tasks deleted one item returns what survives and leaves
    // the deleted item deleted, so the retry can finish.
    expect(
      (
        await db.query<{ id: string }>(
          "select id::text from import_career_prep_items($1,$2::jsonb)",
          [application, imported],
        )
      ).rows,
    ).toEqual([{ id: first }]);
    expect((await db.query("select id from todos where id=$1", [independent])).rows).toEqual([]);

    // Application delete uses one revision token. Restore revives only the task
    // deleted by that application; the independently deleted action stays gone.
    const applicationToken = (
      await db.query<{ token: string }>(
        "select soft_delete_record('application',$1)::text as token",
        [application],
      )
    ).rows[0]!.token;
    expect((await db.query("select id from todos where id=$1", [first])).rows).toEqual([]);
    // Undoing the earlier task delete cannot revive it under a deleted application.
    expect(
      (
        await db.query<{ restored: boolean }>(
          "select restore_record('todo',$1,$2::timestamptz) as restored",
          [independent, independentToken],
        )
      ).rows,
    ).toEqual([{ restored: false }]);
    expect((await db.query("select id from todos where id=$1", [independent])).rows).toEqual([]);
    expect(
      (
        await db.query<{ restored: boolean }>(
          "select restore_record('application',$1,$2::timestamptz) as restored",
          [application, applicationToken],
        )
      ).rows,
    ).toEqual([{ restored: true }]);
    expect((await db.query("select id from todos where id=$1", [first])).rows).toHaveLength(1);
    expect((await db.query("select id from todos where id=$1", [independent])).rows).toEqual([]);
    expect(
      (
        await db.query<{ restored: boolean }>(
          "select restore_record('todo',$1,$2::timestamptz) as restored",
          [independent, independentToken],
        )
      ).rows,
    ).toEqual([{ restored: true }]);

    expect(
      (
        await db.query<{ removed: boolean }>("select remove_career_prep_item($1) as removed", [
          first,
        ])
      ).rows,
    ).toEqual([{ removed: true }]);
    expect((await db.query("select id from todos where id=$1", [first])).rows).toEqual([]);
    expect((await db.query("select id from career_prep where id=$1", [first])).rows).toEqual([]);

    await signIn(ONLOOKER);
    await expect(
      db.query("select * from import_career_prep_items($1,$2::jsonb)", [application, imported]),
    ).rejects.toThrow(/Application unavailable|P0002/i);
    await expect(
      db.query("select save_career_prep_item($1,$2::jsonb)", [
        application,
        JSON.stringify({ id: independent, body: "Borrowed" }),
      ]),
    ).rejects.toThrow(/Prep item unavailable|P0002/i);
  });

  it("backfills isolated prep while preserving an existing todo as authority", async () => {
    const isolated = new PGlite();
    try {
      await isolated.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
        create role service_role nologin noinherit bypassrls; create schema auth;
        create table auth.users(id uuid primary key, email text);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        grant usage on schema auth to anon, authenticated, service_role;
        grant execute on function auth.uid() to anon, authenticated, service_role;`);
      await isolated.exec(storageHarnessSql);
      const names = (await readdir("supabase/migrations"))
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const boundary = names.indexOf("20260922062559_canonical_career_prep_todos.sql");
      expect(boundary).toBeGreaterThan(0);
      for (const name of names.slice(0, boundary))
        await isolated.exec(await readFile(`supabase/migrations/${name}`, "utf8"));

      await isolated.exec(`
        insert into auth.users(id) values ('88888888-8888-4888-8888-888888888888');
        set request.jwt.claim.sub='88888888-8888-4888-8888-888888888888';
        set role authenticated;
      `);
      const application = (
        await isolated.query<{ id: string }>(
          "insert into career_applications(company,role) values ('Existing','Engineer') returning id::text",
        )
      ).rows[0]!.id;
      const linkedTodo = "88888888-aaaa-4aaa-8aaa-888888888881";
      await isolated.query(
        "insert into todos(id,text,due_date) values ($1,'Canonical task','2026-11-04')",
        [linkedTodo],
      );
      await isolated.query("update todos set completed=true where id=$1", [linkedTodo]);
      await isolated.query(
        `insert into career_prep(application_id,body,due_on,todo_id,position)
         values ($1,'Stale prep','2026-11-01',$2,0),($1,'Unlinked prep','2026-11-02',null,1)`,
        [application, linkedTodo],
      );
      await isolated.exec("reset role");
      await isolated.exec(
        await readFile(
          "supabase/migrations/20260922062559_canonical_career_prep_todos.sql",
          "utf8",
        ),
      );
      await isolated.exec(
        "set request.jwt.claim.sub='88888888-8888-4888-8888-888888888888'; set role authenticated;",
      );

      const rows = await isolated.query<{
        body: string;
        due_on: string;
        done: boolean;
        todo_id: string;
      }>(
        `select body,due_on::text,done_at is not null as done,todo_id::text
         from career_prep order by position`,
      );
      expect(rows.rows[0]).toEqual({
        body: "Canonical task",
        due_on: "2026-11-04",
        done: true,
        todo_id: linkedTodo,
      });
      expect(rows.rows[1]).toMatchObject({
        body: "Unlinked prep",
        due_on: "2026-11-02",
        done: false,
      });
      expect(rows.rows[1]!.todo_id).toBeTruthy();
      expect(
        (
          await isolated.query<{ text: string; due_date: string }>(
            "select text,due_date::text from todos where id=$1",
            [rows.rows[1]!.todo_id],
          )
        ).rows,
      ).toEqual([{ text: "Unlinked prep", due_date: "2026-11-02" }]);
    } finally {
      await isolated.close();
    }
  }, 120_000);

  it("keeps each occurrence of a repeating prep task with its application", async () => {
    await signIn(INTEGRATION_OWNER);
    const application = await addApplication("Repeating", "Platform engineer");
    const practice = "77777777-bbbb-4bbb-8bbb-777777777771";
    await db.query("select * from import_career_prep_items($1,$2::jsonb)", [
      application,
      JSON.stringify([{ id: practice, body: "Practice aloud", due_on: "2026-09-22" }]),
    ]);
    await db.query("update todos set recurrence_freq='daily' where id=$1", [practice]);
    await db.query("update todos set completed=true where id=$1", [practice]);

    const visible = () =>
      db.query<{ body: string; done: boolean; linked: boolean }>(
        `select prep.body,prep.done_at is not null as done,prep.todo_id=todo.id as linked
         from career_prep prep join todos todo on todo.id=prep.todo_id
         where prep.application_id=$1 order by prep.position`,
        [application],
      );
    expect((await visible()).rows).toEqual([
      { body: "Practice aloud", done: true, linked: true },
      { body: "Practice aloud", done: false, linked: true },
    ]);

    // Undoing the completion withdraws the successor, and its prep row with it.
    await db.query("update todos set completed=false where id=$1", [practice]);
    expect((await visible()).rows).toEqual([{ body: "Practice aloud", done: false, linked: true }]);
  });

  it("reads the next step from the steps themselves rather than a stored column", async () => {
    await signIn(STEP_OWNER);
    const application = await addApplication("Ramp", "Infrastructure engineer");
    await db.query(
      `insert into career_steps(application_id,name,scheduled_on,position,done_at) values
        ($1,'Recruiter call','2026-09-20',0,now()),
        ($1,'Technical screen','2026-10-02',1,null),
        ($1,'Onsite',null,2,null)`,
      [application],
    );

    // The next step is the earliest round that is not done, by scheduled_on,
    // and a round with no date yet waits behind the ones that have one.
    const next = await db.query<{ name: string }>(
      `select name from career_steps
       where application_id = $1 and done_at is null
       order by scheduled_on nulls last, position
       limit 1`,
      [application],
    );
    expect(next.rows).toEqual([{ name: "Technical screen" }]);

    // Nothing on the application itself caches it.
    expect(
      (
        await db.query<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'career_applications'
             and column_name in ('next_step_at','next_step_on')`,
        )
      ).rows,
    ).toEqual([]);
  });

  it("normalizes tags so the same tag typed two ways groups across companies", async () => {
    await signIn(TAG_OWNER);
    const application = await addApplication("Vercel", "Frontend engineer");
    const withTags = (tags: string, body = "Q") =>
      db.query<{ id: string }>(
        `insert into career_questions(application_id,body,tags) values ($1,$2,${tags}) returning id::text`,
        [application, body],
      );

    // Casing, padding, blanks and duplicates are corrected rather than refused:
    // typing "System Design " must reach the same bucket as "system design".
    const first = (
      await withTags(
        "array['System Design ','behavioral','  BEHAVIORAL','','system design']",
        "Mixed",
      )
    ).rows[0]!;
    const tagsOf = async (id: string) =>
      (await db.query<{ tags: string[] }>("select tags from career_questions where id = $1", [id]))
        .rows;
    expect(await tagsOf(first.id)).toEqual([{ tags: ["behavioral", "system design"] }]);

    // An update takes the same treatment, so a tag cannot be smuggled in later.
    await db.query("update career_questions set tags = array['  Culture Fit'] where id = $1", [
      first.id,
    ]);
    expect(await tagsOf(first.id)).toEqual([{ tags: ["culture fit"] }]);

    // The two limits a page cannot silently fix are errors.
    await expect(withTags(`array['${"x".repeat(41)}']`, "Long")).rejects.toThrow(
      /40 characters or fewer/,
    );
    await expect(
      withTags(`array[${Array.from({ length: 13 }, (_, i) => `'tag${i}'`).join(",")}]`, "Many"),
    ).rejects.toThrow(/12 tags or fewer/);

    // A tag filter is the cross-company view, so it has to match exactly.
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from career_questions where tags @> array['culture fit']",
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("stores a file only after its bytes land, and only for its own reservation", async () => {
    await signIn(UPLOAD_OWNER);
    const application = await addApplication("Notion", "Platform engineer");
    const material = (
      await db.query<{ id: string; path: string }>(
        "insert into career_resources(application_id,kind,title,content_type,byte_size,content_sha256) values ($1,'file','letter.pdf','application/pdf',2048,$2) returning id::text, object_path as path",
        [application, "b".repeat(64)],
      )
    ).rows[0]!;

    // A link is the other half of the same table and reserves nothing.
    const link = (
      await db.query<{ path: string | null }>(
        "insert into career_resources(application_id,kind,title,url) values ($1,'link','Levels','https://example.test/levels') returning object_path as path",
        [application],
      )
    ).rows[0]!;
    expect(link.path).toBeNull();
    // Neither kind can borrow the other\u2019s columns.
    await expect(
      db.query(
        "insert into career_resources(application_id,kind,title,url,byte_size) values ($1,'link','Mixed','https://example.test/x',10)",
        [application],
      ),
    ).rejects.toThrow(/career_resources_kind_shape/);
    // The path is derived from the owner and the row, so two files with the
    // same name cannot collide and a filename cannot escape its folder.
    expect(material.path).toBe(`${UPLOAD_OWNER}/${material.id}.pdf`);

    // Nothing may be written to a path no row reserved.
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values ('career-resources','loose.pdf')",
      ),
    ).rejects.toThrow(/row-level security|42501/i);
    await expect(db.query("select finish_career_resource($1)", [material.id])).rejects.toThrow(
      /Upload is incomplete/,
    );

    // Bytes that do not match the reservation are not the upload it promised.
    const object = (sha: string) =>
      db.query(
        "insert into storage.objects(bucket_id,name,metadata) values ('career-resources',$1,$2::jsonb)",
        [
          material.path,
          JSON.stringify({ size: 2048, mimetype: "application/pdf", sha256: sha.repeat(64) }),
        ],
      );
    await object("c");
    await expect(db.query("select finish_career_resource($1)", [material.id])).rejects.toThrow(
      /does not match this upload/,
    );

    // A stored object is immutable to its owner: there is no UPDATE policy, so
    // correcting it means removing it and sending the file again.
    expect(
      (
        await db.query("update storage.objects set metadata = '{}'::jsonb where name = $1", [
          material.path,
        ])
      ).affectedRows,
    ).toBe(0);
    await db.query("delete from storage.objects where name = $1", [material.path]);
    await object("b");
    await db.query("select finish_career_resource($1)", [material.id]);

    // Retrying finalization is safe and does not move the timestamp.
    const finished = (
      await db.query<{ at: string }>(
        "select uploaded_at::text as at from career_resources where id = $1",
        [material.id],
      )
    ).rows;
    await db.query("select finish_career_resource($1)", [material.id]);
    expect(
      (
        await db.query<{ at: string }>(
          "select uploaded_at::text as at from career_resources where id = $1",
          [material.id],
        )
      ).rows,
    ).toEqual(finished);

    await signIn(ONLOOKER);
    await expect(db.query("select finish_career_resource($1)", [material.id])).rejects.toThrow(
      /File unavailable/,
    );
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from storage.objects where bucket_id = 'career-resources'",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  });

  it("keeps a behavioural story on the account and records where it was told", async () => {
    await signIn(STEP_OWNER);
    const application = await addApplication("Datadog", "Systems engineer");
    const other = await addApplication("Cloudflare", "Systems engineer");
    const story = (
      await db.query<{ id: string }>(
        "insert into career_stories(title,body,tags) values ('Owned the outage','Situation, action, result',array['Ownership','ownership']) returning id::text",
      )
    ).rows[0]!;
    // A story is written once, so its tags are normalized like a question's.
    expect(
      (
        await db.query<{ tags: string[] }>("select tags from career_stories where id = $1", [
          story.id,
        ])
      ).rows,
    ).toEqual([{ tags: ["ownership"] }]);

    // The same story is told at more than one company, and recording a use
    // twice is still one row.
    await db.query(
      "insert into career_story_uses(story_id,application_id,used_on) values ($1,$2,'2026-10-02'),($1,$3,null)",
      [story.id, application, other],
    );
    await expect(
      db.query("insert into career_story_uses(story_id,application_id) values ($1,$2)", [
        story.id,
        application,
      ]),
    ).rejects.toThrow(/duplicate key|23505/i);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from career_story_uses where story_id = $1",
          [story.id],
        )
      ).rows,
    ).toEqual([{ count: 2 }]);

    // Deleting the application it was told at takes the use with it, never the
    // story: the story outlives every application it was used for.
    await db.query("delete from career_story_uses where application_id = $1", [other]);
    expect(
      (await db.query<{ count: number }>("select count(*)::int as count from career_stories")).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("finds an application by company and role, and hides a deleted one", async () => {
    await signIn(SEARCH_OWNER);
    const application = await addApplication("Anthropic", "Research engineer");
    const search = (query: string) =>
      db.query<{ record_type: string; record_id: string; title: string; snippet: string }>(
        "select record_type::text, record_id, title, snippet from search_records($1)",
        [query],
      );

    expect((await search("anthropic")).rows).toEqual([
      {
        record_type: "application",
        record_id: application,
        title: "Anthropic",
        snippet: "Research engineer",
      },
    ]);
    // The role is stemmed, so "engineers" still reaches "engineer".
    expect((await search("engineers")).rows.map((row) => row.record_id)).toEqual([application]);

    await db.query("select soft_delete_record('application', $1)", [application]);
    expect((await search("anthropic")).rows).toEqual([]);
  });
});
