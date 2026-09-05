# Generated and shared types

`database.ts` is generated from the active local Supabase schema with
`npm run db:types` after each migration change. Do not hand-edit this file.

`domain.ts` contains browser-facing contracts and write inputs. Its create
types intentionally omit ownership and protected lifecycle fields, and its
branded delete token marks the timestamp that must remain byte-for-byte intact
before Undo.
