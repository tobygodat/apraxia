// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DriveNotes } from './DriveNotes';
import type { DriveService } from './driveService';

afterEach(() => { cleanup(); localStorage.clear(); });
const note = { id: 'note', name: 'Lecture.pdf', folder: false, modifiedTime: null, size: null };
function service(): DriveService {
  return { status: vi.fn(async () => ({ connectionState: 'connected' })), connect: vi.fn(async () => 'https://accounts.google.com/'),
    disconnect: vi.fn(async () => undefined),
    files: vi.fn(async folder => ({ files: folder === 'root' ? [{ ...note, id: 'folder', name: 'Math notes', folder: true }] : [note], nextPage: null })),
    pdf: vi.fn(async () => new File(['%PDF-1.7'], note.name, { type: 'application/pdf' })) };
}
it('saves a class folder, opens PDFs, refreshes and disconnects', async () => {
  const drive = service(); const preview = vi.fn();
  render(<DriveNotes userId="owner" courseId="math" service={drive} onPreview={preview} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Folder: Math notes' }));
  await screen.findByRole('button', { name: 'Lecture.pdf' });
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }));
  expect(JSON.parse(localStorage.getItem('orbitos:drive-folder:v1:owner:math')!)).toEqual({ id: 'folder', name: 'Math notes' });
  fireEvent.click(screen.getByRole('button', { name: 'Lecture.pdf' }));
  await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.any(File)));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(drive.files).toHaveBeenCalledTimes(3));
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Drive' }));
  await screen.findByRole('button', { name: 'Connect Google Drive' });
  expect(preview).toHaveBeenLastCalledWith(null);
});
it('shows load errors and allows a retry', async () => {
  const drive = service(); vi.mocked(drive.status).mockRejectedValueOnce(new Error('Connection failed'));
  render(<DriveNotes userId="owner" courseId="math" service={drive} onPreview={vi.fn()} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Connection failed');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Folder: Math notes' });
});
it('cancels a pending PDF when the class unmounts', async () => {
  const drive = service(); vi.mocked(drive.files).mockResolvedValue({ files: [note], nextPage: null });
  let resolve!: (file: File) => void;
  vi.mocked(drive.pdf).mockImplementation(() => new Promise(done => { resolve = done; }));
  const preview = vi.fn(); const view = render(<DriveNotes userId="owner" courseId="math" service={drive} onPreview={preview} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Lecture.pdf' }));
  view.unmount(); resolve(new File(['pdf'], 'Late.pdf'));
  await Promise.resolve(); expect(preview).not.toHaveBeenCalled();
});
