import { useEffect, useRef, useState } from 'react';
import type { DrivePage, DriveService } from './driveService';

type Folder = { id: string; name: string };
const root: Folder = { id: 'root', name: 'My Drive' };
export function DriveNotes({ userId, courseId, service, onPreview }: {
  userId: string; courseId: string; service: DriveService; onPreview(file: File | null): void;
}) {
  const key = `orbitos:drive-folder:v1:${userId}:${courseId}`;
  const [saved, setSaved] = useState<Folder | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null');
      return value && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value.id) && typeof value.name === 'string' ? value : null;
    } catch { return null; }
  });
  const [path, setPath] = useState<Folder[]>([saved ?? root]);
  const [choosing, setChoosing] = useState(!saved);
  const [connected, setConnected] = useState(false);
  const [page, setPage] = useState<DrivePage>({ files: [], nextPage: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const folder = path[path.length - 1]!;
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Google Drive could not load. Try again.'); }
    finally { if (!controller.signal.aborted) { setBusy(false); pending.current = null; } }
  }
  function load(nextPath: Folder[], nextPage?: string) {
    void run(async signal => {
      const result = await service.files(nextPath[nextPath.length - 1]!.id, nextPage, signal);
      if (signal.aborted) return;
      setPath(nextPath);
      setPage(previous => ({ ...result, files: nextPage ? [...previous.files, ...result.files.filter(file => !previous.files.some(old => old.id === file.id))] : result.files }));
    });
  }
  function initialize() {
    void run(async signal => {
      const status = await service.status(signal);
      if (signal.aborted) return;
      const active = status?.connectionState === 'connected'; setConnected(active);
      if (active) {
        const result = await service.files(folder.id, undefined, signal);
        if (!signal.aborted) setPage(result);
      }
    });
  }
  useEffect(() => { initialize(); return () => pending.current?.abort(); }, [service, key]);
  function choose() {
    try { localStorage.setItem(key, JSON.stringify(folder)); }
    catch { setError('The folder choice could not be saved. Check browser storage and try again.'); return; }
    setSaved(folder); setChoosing(false); onPreview(null);
  }
  function connect() {
    void run(async signal => {
      const url = new URL(await service.connect(signal));
      if (url.origin !== 'https://accounts.google.com') throw new Error('The Google connection could not start.');
      if (!signal.aborted) window.location.assign(url.href);
    });
  }
  return <details className="classes-drive" open>
    <summary>Google Drive <span>{busy ? 'Loading…' : connected ? 'Connected' : 'Not connected'}</span></summary>
    <div aria-busy={busy}>
      {error && <p role="alert">{error}</p>}
      {!connected ? <>
        <p>Connect Drive to read your Goodnotes PDF backups. Google will ask for read-only access to your Drive files.</p>
        <button disabled={busy} onClick={connect}>Connect Google Drive</button>
        {error && <button disabled={busy} onClick={initialize}>Try again</button>}
      </> : <>
        <div className="classes-drive-actions">
          <button disabled={busy} onClick={() => load(path)}>Refresh</button>
          <button disabled={busy} onClick={() => { setChoosing(true); load([root]); }}>Choose folder</button>
          {error.startsWith('Reconnect') && <button disabled={busy} onClick={connect}>Reconnect Drive</button>}
          <button disabled={busy} onClick={() => void run(async signal => {
            await service.disconnect(signal);
            if (!signal.aborted) { setConnected(false); setPage({ files: [], nextPage: null }); onPreview(null); }
          })}>Disconnect Drive</button>
        </div>
        <p>{choosing ? 'Choose the folder containing this class’s PDF backups.' : `Notes from ${saved?.name ?? folder.name}`}</p>
        {choosing && <div className="classes-drive-actions">
          {path.length > 1 && <button disabled={busy} onClick={() => load(path.slice(0, -1))}>Back</button>}
          <span>{folder.name}</span><button disabled={busy} onClick={choose}>Use this folder</button>
          {saved && <button disabled={busy} onClick={() => { setChoosing(false); load([saved]); }}>Cancel</button>}
        </div>}
        <ul className="classes-drive-files">{page.files.filter(file => choosing || !file.folder).map(file => <li key={file.id}>
          <button disabled={busy} onClick={() => file.folder ? load([...path, { id: file.id, name: file.name }]) : void run(async signal => {
            const pdf = await service.pdf(file, signal);
            if (!signal.aborted) onPreview(pdf);
          })}>{file.folder ? 'Folder: ' : ''}{file.name}</button>
          {!file.folder && <a href={`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`} target="_blank" rel="noopener noreferrer">Open in Drive</a>}
        </li>)}</ul>
        {!busy && !error && !page.files.some(file => choosing || !file.folder) && <p>{choosing ? 'No folders or PDFs here.' : 'No PDFs in this folder yet. Add a Goodnotes PDF backup, then refresh.'}</p>}
        {page.nextPage && <button disabled={busy} onClick={() => load(path, page.nextPage!)}>Load more</button>}
        <p className="classes-local-note">Folder choice is saved in this browser. Refresh to see updated backups.</p>
      </>}
    </div>
  </details>;
}
