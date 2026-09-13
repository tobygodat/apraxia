// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { pickGooglePdf } from './googlePicker';
const grant = { accessToken: 'temporary', developerKey: 'public-key', appId: '123' };
afterEach(() => { vi.unstubAllGlobals(); });
function sdk() {
  let callback!: (data: unknown) => void;
  const picker = { dispose: vi.fn(), setVisible: vi.fn() };
  const builder = { addView: vi.fn().mockReturnThis(), setOAuthToken: vi.fn().mockReturnThis(), setDeveloperKey: vi.fn().mockReturnThis(), setAppId: vi.fn().mockReturnThis(), setOrigin: vi.fn().mockReturnThis(), setTitle: vi.fn().mockReturnThis(), setCallback: vi.fn((fn) => { callback = fn; return builder; }), build: vi.fn(() => picker) };
  const view = { setIncludeFolders: vi.fn().mockReturnThis(), setSelectFolderEnabled: vi.fn().mockReturnThis(), setMimeTypes: vi.fn().mockReturnThis(), setParent: vi.fn().mockReturnThis() };
  vi.stubGlobal('google', { picker: { Action: { CANCEL: 'cancel', PICKED: 'picked' }, ViewId: { DOCS: 'docs' }, DocsView: class { constructor() { return view; } }, PickerBuilder: class { constructor() { return builder; } } } });
  return { picker, view, builder, respond: (data: unknown) => callback(data) };
}
it('filters PDFs and resolves a selected file while disposing the popup', async () => {
  const fake = sdk(); const selection = pickGooglePdf(grant, undefined, 'saved-folder'); await Promise.resolve();
  expect(fake.view.setMimeTypes).toHaveBeenCalledWith('application/pdf');
  expect(fake.view.setParent).toHaveBeenCalledWith('saved-folder');
  expect(fake.builder.setOAuthToken).toHaveBeenCalledWith('temporary');
  fake.respond({ action: 'picked', docs: [{ id: 'pdf-one', name: 'Notes.pdf', mimeType: 'application/pdf' }] });
  expect(await selection).toMatchObject({ id: 'pdf-one', name: 'Notes.pdf' });
  expect(fake.picker.dispose).toHaveBeenCalledTimes(1);
});
it.each(['cancel', 'abort'])('cleans up after %s and ignores a late selection', async reason => {
  const fake = sdk(); const controller = new AbortController(); const selection = pickGooglePdf(grant, controller.signal); await Promise.resolve();
  if (reason === 'abort') controller.abort(); else fake.respond({ action: 'cancel' });
  fake.respond({ action: 'picked', docs: [{ id: 'late', name: 'Late.pdf', mimeType: 'application/pdf' }] });
  expect(await selection).toBeNull(); expect(fake.picker.dispose).toHaveBeenCalledTimes(1);
});
it('rejects non-PDF selection data', async () => {
  const fake = sdk(); const selection = pickGooglePdf(grant); await Promise.resolve();
  fake.respond({ action: 'picked', docs: [{ id: 'file', name: 'Other', mimeType: 'text/plain' }] });
  await expect(selection).rejects.toThrow('Choose a PDF');
});
