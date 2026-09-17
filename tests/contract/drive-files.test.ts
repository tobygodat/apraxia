import { expect, it, vi } from "vitest";
import { serveDriveFiles } from "../../server/drive/driveFiles";

const request = (query: string) => new Request(`https://app.example.test/api/drive/${query}`);
const headers = { "Cache-Control": "private, no-store" };
it("lists only folders and PDFs with explicit pagination and a narrow projection", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("/files/class-1?")
      ? Response.json({ mimeType: "application/vnd.google-apps.folder", trashed: false })
      : Response.json({
          files: [
            {
              id: "note-1",
              name: "Lecture.pdf",
              mimeType: "application/pdf",
              owners: ["private"],
              size: "9000",
            },
          ],
          nextPageToken: "page-two",
        }),
  );
  const response = await serveDriveFiles(
    "files",
    request("files?folder=class-1&page=page-one&action=files"),
    "secret",
    fetcher,
    headers,
  );
  expect(await response.json()).toEqual({
    files: [{ id: "note-1", name: "Lecture.pdf", folder: false, size: "9000", modifiedTime: null }],
    nextPage: "page-two",
  });
  const url = new URL(String(fetcher.mock.calls[1]![0]));
  expect(url.searchParams.get("q")).toContain("'class-1' in parents and trashed = false");
  expect(url.searchParams.get("pageToken")).toBe("page-one");
});
it("rejects query injection and incomplete search results", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ files: [], incompleteSearch: true }),
  );
  await expect(
    serveDriveFiles("files", request("files?folder=bad%27id"), "secret", fetcher, headers),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    serveDriveFiles("files", request("files"), "secret", fetcher, headers),
  ).rejects.toThrow();
});
it("streams a PDF larger than 4.5 MB without waiting for the full download", async () => {
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      upstream = controller;
    },
  });
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("alt=media")
      ? new Response(stream)
      : Response.json({
          name: "Renamed lecture.pdf",
          mimeType: "application/pdf",
          size: "8000000",
          capabilities: { canDownload: true },
        }),
  );
  const response = await serveDriveFiles(
    "pdf",
    request("pdf?id=note-1&action=pdf"),
    "secret",
    fetcher,
    headers,
  );
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(decodeURIComponent(response.headers.get("x-apraxia-file-name")!)).toBe(
    "Renamed lecture.pdf",
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
  const reader = response.body!.getReader();
  upstream.enqueue(new TextEncoder().encode("%PDF-1.7"));
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("%PDF-1.7");
  upstream.enqueue(new Uint8Array(6 * 1024 * 1024));
  upstream.close();
  expect((await reader.read()).value?.length).toBe(6 * 1024 * 1024);
  expect((await reader.read()).done).toBe(true);
});
it("does not download non-PDF or download-restricted files", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ mimeType: "application/pdf", capabilities: { canDownload: false } }),
  );
  await expect(
    serveDriveFiles("pdf", request("pdf?id=note-1"), "secret", fetcher, headers),
  ).rejects.toMatchObject({ code: "file_unavailable" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects mismatched, duplicate, and unrelated routing query parameters", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const query of ["action=pdf", "action=files&action=files", "action=files&unexpected=1"]) {
    await expect(
      serveDriveFiles("files", request(`files?folder=root&${query}`), "secret", fetcher, headers),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  }
  expect(fetcher).not.toHaveBeenCalled();
});
