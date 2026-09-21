#!/usr/bin/env bash
# Copies the hosted account's rows into the local Supabase, re-keyed to the
# local user, so the full stack can be exercised on real content without
# touching production. Hosted is only read; the local database is disposable.
#
# The dump is personal data. It is written to the ignored supabase/.temp folder
# and must never be committed. Sign in locally once before running this, so the
# local user exists. Google connection rows are left out: their encrypted
# tokens belong to the hosted key, and Storage files are not part of a dump.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=supabase_db_apraxia
DUMP=supabase/.temp/hosted-data.sql
mkdir -p supabase/.temp

npx supabase db dump --linked --data-only --use-copy --schema public \
  -x public.google_calendar_connections \
  -x public.google_drive_connections \
  -x public.google_calendar_preferences \
  -f "$DUMP"

# One person's account: the uuid that appears most often is its owner.
HOSTED=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$DUMP" |
  sort | uniq -c | sort -rn | head -1 | awk '{print $2}')
LOCAL=$(docker exec "$DB" psql -U postgres -At -c \
  "select id from auth.users where email not like '%@example.test' order by created_at limit 1;")
if [ -z "$HOSTED" ] || [ -z "$LOCAL" ]; then
  echo "Could not resolve the user ids. Sign in at http://127.0.0.1:3000 first." >&2
  exit 1
fi
echo "hosted user ${HOSTED:0:8}... -> local user ${LOCAL:0:8}..."

TABLES=$(docker exec "$DB" psql -U postgres -At -c \
  "select string_agg(format('public.%I', tablename), ', ') from pg_tables where schemaname = 'public' and tablename not like 'google_%';")

# One transaction: a failed load leaves the local database as it was.
{
  echo "begin;"
  echo "truncate $TABLES cascade;"
  sed "s/$HOSTED/$LOCAL/g" "$DUMP"
  echo "commit;"
} | docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q >/dev/null

docker exec "$DB" psql -U postgres -At -c \
  "select 'todos', count(*) from public.todos union all select 'projects', count(*) from public.projects union all select 'ideas', count(*) from public.ideas union all select 'classes', count(*) from public.classes;"
echo "Done. Reload http://127.0.0.1:3000"
