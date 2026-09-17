import { boundedFetchJson, DriveHttpError, object } from "./driveHttp.js";

const FOLDER = "application/vnd.google-apps.folder";
const PDF = "application/pdf";
const validId = (id: string) => /^[A-Za-z0-9_-]{1,256}$/.test(id);

/** Only fixed Google endpoints and bounded projections cross the server boundary. */
export async function serveDriveFiles(
  action: string,
  request: Request,
  accessToken: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<Response> {
  const query = new URL(request.url).searchParams;
  // Vercel includes the dynamic route segment in the query string.
  // Accept only one matching value; keep rejecting unrelated query parameters.
  const routeActions = query.getAll("action");
  if (routeActions.length > 1 || (routeActions.length === 1 && routeActions[0] !== action)) {
    throw new DriveHttpError("invalid_request", 400);
  }
  query.delete("action");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
  const init = { signal, headers: { Authorization: `Bearer ${accessToken}` } };
  async function metadata(url: URL) {
    const { response, value } = await boundedFetchJson(url.href, init, fetcher, 512 * 1024);
    if (!response.ok)
      throw new DriveHttpError(
        response.status === 401
          ? "reconnect_required"
          : response.status === 404 || response.status === 403
            ? "file_unavailable"
            : "drive_unavailable",
        response.status === 401 ? 409 : 502,
      );
    if (!object(value)) throw new DriveHttpError("drive_unavailable");
    return value;
  }
  if (action === "files") {
    if (
      [...query.keys()].some((key) => !["folder", "page"].includes(key)) ||
      query.getAll("folder").length > 1 ||
      query.getAll("page").length > 1
    )
      throw new DriveHttpError("invalid_request", 400);
    const folder = query.get("folder") ?? "root";
    const page = query.get("page");
    if (!validId(folder) || (page !== null && (page.length > 2048 || !page.length)))
      throw new DriveHttpError("invalid_request", 400);
    if (folder !== "root") {
      const folderUrl = new URL(`https://www.googleapis.com/drive/v3/files/${folder}`);
      folderUrl.search = "fields=mimeType,trashed&supportsAllDrives=true";
      const selected = await metadata(folderUrl);
      if (selected.mimeType !== FOLDER || selected.trashed === true)
        throw new DriveHttpError("file_unavailable", 404);
    }
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.search = new URLSearchParams({
      q: `'${folder}' in parents and trashed = false and (mimeType = '${PDF}' or mimeType = '${FOLDER}')`,
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,size)",
      pageSize: "100",
      orderBy: "folder,name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...(page ? { pageToken: page } : {}),
    }).toString();
    const value = await metadata(url);
    if (
      !Array.isArray(value.files) ||
      value.incompleteSearch === true ||
      (value.nextPageToken !== undefined &&
        (typeof value.nextPageToken !== "string" || value.nextPageToken.length > 2048))
    )
      throw new DriveHttpError("drive_unavailable");
    const files = value.files.map((item) => {
      if (
        !object(item) ||
        typeof item.id !== "string" ||
        !validId(item.id) ||
        typeof item.name !== "string" ||
        ![PDF, FOLDER].includes(String(item.mimeType))
      )
        throw new DriveHttpError("drive_unavailable");
      return {
        id: item.id,
        name: item.name,
        folder: item.mimeType === FOLDER,
        modifiedTime: typeof item.modifiedTime === "string" ? item.modifiedTime : null,
        size: typeof item.size === "string" ? item.size : null,
      };
    });
    return Response.json({ files, nextPage: value.nextPageToken ?? null }, { headers });
  }
  if (
    action !== "pdf" ||
    query.getAll("id").length !== 1 ||
    [...query.keys()].some((key) => key !== "id")
  )
    throw new DriveHttpError("invalid_request", 400);
  const id = query.get("id")!;
  if (!validId(id)) throw new DriveHttpError("invalid_request", 400);
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}`);
  url.search = new URLSearchParams({
    fields: "name,mimeType,size,trashed,capabilities(canDownload)",
    supportsAllDrives: "true",
  }).toString();
  const value = await metadata(url);
  if (
    value.mimeType !== PDF ||
    value.trashed === true ||
    !object(value.capabilities) ||
    value.capabilities.canDownload !== true
  )
    throw new DriveHttpError("file_unavailable", 403);
  url.search = "alt=media&supportsAllDrives=true";
  const response = await fetcher(url.href, {
    ...init,
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok || !response.body)
    throw new DriveHttpError(
      response.status === 401 ? "reconnect_required" : "file_unavailable",
      response.status === 401 ? 409 : 502,
    );
  // Pass bytes through as they arrive. Never buffer a PDF into a function payload.
  // The bytes are served inline on the app origin: sandbox them and forbid framing so a
  // hostile PDF cannot script or be embedded against the app's session. The reader
  // fetches the body into memory (pdf.js), so neither header affects it.
  return new Response(response.body, {
    headers: {
      ...headers,
      "Content-Type": PDF,
      "Content-Disposition": "inline",
      "X-Accel-Buffering": "no",
      "Content-Security-Policy": "sandbox",
      "X-Frame-Options": "DENY",
      ...(typeof value.name === "string" && value.name.length <= 1024
        ? { "X-Apraxia-File-Name": encodeURIComponent(value.name) }
        : {}),
    },
  });
}
