// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DriveNotes } from './DriveNotes';
import type { DriveService } from './driveService';
afterEach(() => { cleanup(); localStorage.clear(); });
const note = { id: 'note', name: 'Lecture.pdf', folder: false, modifiedTime: null, size: null };
function service(): DriveService {
  return { status: vi.fn(async () => ({ connectionState: 'connected' })), connect: vi.fn(async () => 'https://accounts.google.com/'),
    disconnect: vi.fn(async () => undefined), files: vi.fn(async () => ({ files: [], nextPage: null })),
    pickPdf: vi.fn(async () => note), pdf: vi.fn(async () => new File(['%PDF-1.7'], note.name, { type: 'application/pdf' })) };
}
it('opens the native picker and downloads only the selected PDF, preserving an existing folder preference', async () => {
  localStorage.setItem('orbitos:drive-folder:v1:owner:math', JSON.stringify({ id: 'saved-folder', name: 'Notes' }));
  const drive=service(); const preview=vi.fn();
  render(<DriveNotes userId="owner" courseId="math" service={drive} onPreview={preview} />);
  fireEvent.click(await screen.findByRole('button',{name:'Open from Drive'}));
  await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.any(File)));
  expect(drive.pickPdf).toHaveBeenCalledWith(expect.any(AbortSignal),'saved-folder');
  expect(drive.files).not.toHaveBeenCalled();
  expect(drive.pdf).toHaveBeenCalledWith(note,expect.any(AbortSignal));
});
it('leaves the current reader unchanged when Google Picker is cancelled',async()=>{
  const drive=service(); vi.mocked(drive.pickPdf).mockResolvedValue(null); const preview=vi.fn();
  render(<DriveNotes userId="owner" courseId="math" service={drive} onPreview={preview} />);
  fireEvent.click(await screen.findByRole('button',{name:'Open from Drive'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Open from Drive'}).hasAttribute('disabled')).toBe(false));
  expect(drive.pdf).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
});
it('offers recovery after the picker fails to load',async()=>{
  const drive=service(); vi.mocked(drive.pickPdf).mockRejectedValueOnce(new Error('Picker unavailable'));
  render(<DriveNotes userId="owner" courseId="math" service={drive} onPreview={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button',{name:'Open from Drive'}));
  expect((await screen.findByRole('alert')).textContent).toBe('Picker unavailable');
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await waitFor(()=>expect(drive.pdf).toHaveBeenCalledTimes(1));
});
it('aborts selection when the class unmounts',async()=>{
  const drive=service(); let finish!:(value:typeof note)=>void;
  vi.mocked(drive.pickPdf).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const preview=vi.fn(); const view=render(<DriveNotes userId="owner" courseId="math" service={drive} onPreview={preview} />);
  fireEvent.click(await screen.findByRole('button',{name:'Open from Drive'}));
  view.unmount(); finish(note); await Promise.resolve();
  expect(drive.pdf).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
});