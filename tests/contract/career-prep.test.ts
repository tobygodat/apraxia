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
const OWNERS = [OWNER, ONLOOKER, TAG_OWNER, UPLOAD_OWNER, SEARCH_OWNER, STEP_OWNER];

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
    await db.query(
      "insert into career_prep(application_id,body) values ($1,'Re-read the posting')",
      [application],
    );
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
      db.query("insert into career_prep(application_id,body) values ($1,'Borrowed')", [
        application,
      ]),
    ).rejects.toThrow(/foreign key|23503/i);
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
