/* Operate: the class keeps one compact source control above the reader.
   Google's own Picker owns file search, previews, selection, and cancellation. */
import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import type { DriveService, DriveFile } from "./driveService";
import "./drivePicker.css";
import { serviceErrorMessage } from "../../lib/serviceError";
import { readDriveFolder, rememberDriveFolder } from "./driveFolderMemory";
export function DriveNotes({
  userId,
  courseId,
  service,
  onPreview,
  onChooseLocal,
  onSelect,
  disabled = false,
}: {
  userId: string;
  courseId: string;
  service: DriveService;
  onPreview(file: File | null): void;
  onChooseLocal?(): void;
  disabled?: boolean;
  onSelect?(file: DriveFile, pdf: File, signal: AbortSignal): Promise<void>;
}) {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("Checking Drive…");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  async function run(label: string, work: (signal: AbortSignal) => Promise<void>) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(label);
    setError("");
    try {
      await work(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(serviceErrorMessage(cause, "Google Drive could not open. Try again."));
    } finally {
      if (pending.current === controller) {
        setBusy("");
        pending.current = null;
      }
    }
  }
  function initialize() {
    void run("Checking Drive…", async (signal) => {
      const status = await service.status(signal);
      if (!signal.aborted) setConnected(status?.connectionState === "connected");
    });
  }
  useEffect(() => {
    initialize();
    return () => pending.current?.abort();
    // `initialize` is re-created every render; the provider identity is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, userId, courseId]);
  function browse() {
    void run("Choosing a PDF…", async (signal) => {
      // Reopen where this class's notes were last taken from.
      const file = await service.pickPdf(signal, readDriveFolder(userId, courseId));
      if (!file || signal.aborted) return;
      rememberDriveFolder(userId, courseId, file.parentId);
      setBusy(`Opening ${file.name}…`);
      const pdf = await service.pdf(file, signal);
      if (signal.aborted) return;
      if (onSelect) {
        setBusy(`Saving ${file.name}…`);
        await onSelect(file, pdf, signal);
      } else onPreview(pdf);
    });
  }
  function connect() {
    void run("Connecting…", async (signal) => {
      const url = new URL(await service.connect(signal));
      if (url.origin !== "https://accounts.google.com")
        throw new Error("The Google connection could not start.");
      if (!signal.aborted) window.location.assign(url.href);
    });
  }
  return (
    <>
      <div className="drive-source">
        <WorkspaceIcon name="projects" />
        <strong>Google Drive</strong>
        <span className="drive-source-state" role="status">
          {busy || (connected ? "Connected" : "Read your PDF backups")}
        </span>
        <button
          className="drive-open-button"
          disabled={disabled || !!busy}
          onClick={connected ? browse : connect}
        >
          {connected ? (onSelect ? "Add from Drive" : "Open from Drive") : "Connect Drive"}
          <WorkspaceIcon name="right" />
        </button>
        {onChooseLocal && (
          <button
            className="drive-local-button"
            disabled={disabled}
            onClick={() => {
              pending.current?.abort();
              pending.current = null;
              setBusy("");
              setError("");
              onChooseLocal();
            }}
          >
            {onSelect ? "Upload PDF" : "From device"}
          </button>
        )}
        {connected && (
          <details className="drive-menu">
            <summary aria-label="Drive connection options" title="Drive connection options">
              <WorkspaceIcon name="down" />
            </summary>
            <div>
              <button
                disabled={disabled || !!busy}
                onClick={() =>
                  void run("Disconnecting…", async (signal) => {
                    await service.disconnect(signal);
                    if (!signal.aborted) {
                      setConnected(false);
                      onPreview(null);
                    }
                  })
                }
              >
                Disconnect Drive
              </button>
            </div>
          </details>
        )}
      </div>
      {error && (
        <div className="drive-inline-error">
          <p role="alert">{error}</p>
          <button
            disabled={disabled || !!busy}
            onClick={error.startsWith("Reconnect") ? connect : connected ? browse : initialize}
          >
            {error.startsWith("Reconnect") ? "Reconnect Drive" : "Try again"}
          </button>
        </div>
      )}
    </>
  );
}
