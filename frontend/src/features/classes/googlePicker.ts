/// <reference types="google.picker" />
import type { DriveFile } from "./driveService";
export interface PickerGrant {
  accessToken: string;
  developerKey: string;
  appId: string;
}
type LoaderWindow = Window & {
  gapi?: {
    load(
      name: string,
      options: { callback(): void; onerror(): void; timeout: number; ontimeout(): void },
    ): void;
  };
};
let loading: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (typeof google !== "undefined" && google.picker) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const fail = () => finish(new Error("Google’s file picker could not load. Try again."));
    const timer = window.setTimeout(fail, 20000);
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      const api = (window as LoaderWindow).gapi;
      if (!api) {
        fail();
        return;
      }
      api.load("picker", {
        callback: () => finish(),
        onerror: fail,
        timeout: 15000,
        ontimeout: fail,
      });
    };
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
export async function pickGooglePdf(
  grant: PickerGrant,
  signal?: AbortSignal,
  parent?: string,
): Promise<DriveFile | null> {
  await loadPicker();
  if (signal?.aborted) return null;
  return new Promise((resolve, reject) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let picker: google.picker.Picker | undefined;
    let settled = false;
    const finish = (file: DriveFile | null, error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      picker?.dispose();
      if (opener?.isConnected) opener.focus();
      if (error) reject(error);
      else resolve(file);
    };
    const cancel = () => finish(null);
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes("application/pdf");
    if (parent && /^[A-Za-z0-9_-]{1,256}$/.test(parent)) view.setParent(parent);
    try {
      picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(grant.accessToken)
        .setDeveloperKey(grant.developerKey)
        .setAppId(grant.appId)
        .setOrigin(window.location.origin)
        .setTitle("Open a PDF from Google Drive")
        .setCallback((data) => {
          if (data.action === google.picker.Action.CANCEL) {
            finish(null);
            return;
          }
          if (data.action !== google.picker.Action.PICKED) return;
          const file = data.docs?.[0];
          if (
            !file ||
            !/^[A-Za-z0-9_-]{1,256}$/.test(file.id) ||
            typeof file.name !== "string" ||
            file.mimeType !== "application/pdf"
          ) {
            finish(null, new Error("Choose a PDF to open in your notes reader."));
            return;
          }
          finish({ id: file.id, name: file.name, folder: false, modifiedTime: null, size: null });
        })
        .build();
      signal?.addEventListener("abort", cancel, { once: true });
      picker.setVisible(true);
    } catch {
      finish(null, new Error("Google’s file picker could not open. Try again."));
    }
  });
}
