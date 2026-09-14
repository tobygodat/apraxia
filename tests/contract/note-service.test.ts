import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { Database } from '../../frontend/src/types/database';
import { createNoteService, prepareUpload, type ClassNote } from '../../frontend/src/features/classes/noteService';
const owner = '11111111-1111-4111-8111-111111111111';
const id = '33333333-3333-4333-8333-333333333333';
const row: ClassNote = { id, user_id: owner, course_id: 'math3012', name: 'Notes.pdf', source: 'upload', drive_file_id: null, byte_size: 8, content_sha256: 'a'.repeat(64), object_path: `${owner}/${id}.pdf`, uploaded_at: null, created_at: '2026-09-13T00:00:00Z' };
function setup(responses: { body: unknown; status?: number }[]) {
  const fetch = vi.fn(async () => { const next = responses.shift(); if (!next) throw new Error('Unexpected request'); return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'Content-Type': 'application/json' } }); });
  return { service: createNoteService(createClient<Database>('https://notes.example.test', 'test-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } })), fetch };
}
const signal = () => new AbortController().signal;
it('reserves immutable metadata without claiming an upload is complete', async () => {
  const { service, fetch } = setup([{ body: null }, { body: row }]);
  await service.reserve(owner, row.course_id, { id, name: row.name, size: row.byte_size!, sha256: row.content_sha256! }, signal());
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({ id, user_id: owner, course_id: row.course_id, name: row.name, source: 'upload', byte_size: 8, content_sha256: 'a'.repeat(64) });
  expect(new Headers(init.headers).get('prefer')).toContain('resolution=ignore-duplicates');
});
it('confirms a previously uploaded object after an upload conflict, without overwriting it', async () => {
  const file = new File(['%PDF-1.7'], 'Notes.pdf');
  const draft = await prepareUpload(file, id); const note = { ...row, content_sha256: draft.sha256 };
  const { service, fetch } = setup([{ body: { statusCode: '409', error: 'Duplicate', message: 'Already exists' }, status: 409 }, { body: null }, { body: { ...note, uploaded_at: 'now' } }]);
  expect((await service.upload(note, file, signal())).uploaded_at).toBe('now');
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(init.headers).get('x-upsert')).toBe('false');
  expect(((init.body as FormData).get('') as File).type).toBe('application/pdf');
  expect(String((fetch.mock.calls[1] as unknown as [string])[0])).toContain('/rpc/finish_class_pdf');
});
it('rejects different bytes on retry before any upload and rejects incomplete downloads', async () => {
  const { service, fetch } = setup([]);
  await expect(service.upload(row, new File(['%PDF-1.7'], row.name, { type: 'application/pdf' }), signal())).rejects.toThrow('original PDF');
  await expect(service.download(row, signal())).rejects.toThrow('Finish saving'); expect(fetch).not.toHaveBeenCalled();
});
it('never reports an upload saved if object confirmation fails', async () => {
  const file = new File(['%PDF-1.7'], 'Notes.pdf', { type: 'application/pdf' }); const draft = await prepareUpload(file, id);
  const { service } = setup([{ body: { Key: 'class-pdfs/path', Id: 'id' } }, { body: { code: '22023', message: 'Missing object' }, status: 400 }]);
  await expect(service.upload({ ...row, content_sha256: draft.sha256 }, file, signal())).rejects.toThrow('hasn’t finished saving');
});
