begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select ok(not has_function_privilege('anon', 'public.read_calendar_credentials(uuid)', 'execute'), 'Anonymous callers cannot read credentials');
select ok(not has_function_privilege('authenticated', 'public.read_calendar_credentials(uuid)', 'execute'), 'Browser callers cannot read credentials');
select ok(not has_function_privilege('authenticated', 'public.begin_calendar_oauth_attempt(uuid,text,text,timestamptz,text)', 'execute'), 'Browser callers cannot create private PKCE attempts');
select ok(not has_function_privilege('authenticated', 'public.consume_calendar_oauth_attempt(uuid,text,text)', 'execute'), 'Browser callers cannot consume private PKCE attempts');
select ok(not has_function_privilege('authenticated', 'public.save_calendar_credentials(uuid,uuid,timestamptz,text,integer,text[])', 'execute'), 'Browser callers cannot save credentials');
select ok(not has_function_privilege('authenticated', 'public.clear_calendar_credentials(uuid,public.google_calendar_connection_state,timestamptz)', 'execute'), 'Browser callers cannot clear credentials');
select ok(not has_function_privilege('authenticated', 'public.sync_calendar_preferences(uuid,jsonb)', 'execute'), 'Browser callers cannot impersonate owners during discovery');
select ok(has_function_privilege('service_role', 'public.read_calendar_credentials(uuid)', 'execute'), 'Server role can read credentials');
select ok(has_function_privilege('service_role', 'public.save_calendar_credentials(uuid,uuid,timestamptz,text,integer,text[])', 'execute'), 'Server role can save credentials');
select ok(not has_column_privilege('authenticated', 'private.google_oauth_transactions', 'code_verifier', 'select'), 'Browser role cannot read PKCE verifier');

-- The four-argument clear decides whether the refresh-token ciphertext is
-- destroyed, so it is at least as sensitive as the three-argument form.
select ok(not has_function_privilege('authenticated', 'public.clear_calendar_credentials(uuid,public.google_calendar_connection_state,timestamptz,boolean)', 'execute'), 'Browser callers cannot choose whether credentials are deleted');
select ok(has_function_privilege('service_role', 'public.clear_calendar_credentials(uuid,public.google_calendar_connection_state,timestamptz,boolean)', 'execute'), 'Server role can clear credentials without deleting them');

select * from finish();
rollback;
