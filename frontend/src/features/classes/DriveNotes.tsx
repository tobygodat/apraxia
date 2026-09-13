/* Operate: the class keeps one compact source control above the reader.
   Google's own Picker owns file search, previews, selection, and cancellation. */
import { useEffect, useRef, useState } from 'react';
import { WorkspaceIcon } from '../../components/WorkspaceIcon';
import type { DriveService } from './driveService';
import './drivePicker.css';
export function DriveNotes({ userId, courseId, service, onPreview }: {
  userId: string; courseId: string; service: DriveService; onPreview(file: File | null): void;
}) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState('Checking Drive…');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  async function run(label: string, work: (signal: AbortSignal) => Promise<void>) {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(label); setError('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Google Drive could not open. Try again.'); }
    finally { if (pending.current === controller) { setBusy(''); pending.current = null; } }
  }
  function initialize() {
    void run('Checking Drive…', async signal => {
      const status = await service.status(signal);
      if (!signal.aborted) setConnected(status?.connectionState === 'connected');
    });
  }
  useEffect(() => { initialize(); return () => pending.current?.abort(); }, [service, userId, courseId]);
  function browse() {
    void run('Choosing a PDF…', async signal => {
      let parent: string | undefined;
      try {
        const folder = JSON.parse(localStorage.getItem(`orbitos:drive-folder:v1:${userId}:${courseId}`) ?? 'null');
        if (typeof folder?.id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(folder.id)) parent = folder.id;
      } catch { /* A stale folder preference must not prevent opening Drive. */ }
      const file = await service.pickPdf(signal, parent);
      if (!file || signal.aborted) return;
      setBusy(`Opening ${file.name}…`);
      const pdf = await service.pdf(file, signal);
      if (!signal.aborted) onPreview(pdf);
    });
  }
  function connect() {
    void run('Connecting…', async signal => {
      const url = new URL(await service.connect(signal));
      if (url.origin !== 'https://accounts.google.com') throw new Error('The Google connection could not start.');
      if (!signal.aborted) window.location.assign(url.href);
    });
  }
  return <>
    <div className="drive-source">
      <WorkspaceIcon name="projects" /><strong>Google Drive</strong>
      <span className="drive-source-state" role="status">{busy || (connected ? 'Connected' : 'Read your PDF backups')}</span>
      <button className="drive-open-button" disabled={!!busy} onClick={connected ? browse : connect}>{connected ? 'Open from Drive' : 'Connect Drive'}<WorkspaceIcon name="right" /></button>
      {connected && <details className="drive-menu"><summary aria-label="Drive connection options" title="Drive connection options"><WorkspaceIcon name="down" /></summary><div>
        <button disabled={!!busy} onClick={() => void run('Disconnecting…', async signal => {
          await service.disconnect(signal);
          if (!signal.aborted) { setConnected(false); onPreview(null); }
        })}>Disconnect Drive</button>
      </div></details>}
    </div>
    {error && <div className="drive-inline-error"><p role="alert">{error}</p><button disabled={!!busy} onClick={error.startsWith('Reconnect') ? connect : connected ? browse : initialize}>{error.startsWith('Reconnect') ? 'Reconnect Drive' : 'Try again'}</button></div>}
  </>;
}