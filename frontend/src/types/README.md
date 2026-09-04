# Generated and shared types

`database.ts` is generated from the active local Supabase schema with
`npm run db:types` after each migration change. Generation currently waits on
the local Supabase stack tracked in `USER_ACTIONS.md`; do not hand-edit a file
under that name.

`domain.ts` contains browser-facing contracts and write inputs. Its create
types intentionally omit ownership and protected lifecycle fields, and its
branded delete token marks the timestamp that must remain byte-for-byte intact
before Undo.
