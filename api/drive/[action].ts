import { createDriveHandler, type DriveAction } from '../../server/drive/driveHandlers.js';
const actions = new Set(['connect', 'callback', 'complete', 'disconnect', 'status', 'files', 'pdf']);
export default { fetch(request: Request) {
  const action = new URL(request.url).pathname.split('/').pop() ?? '';
  if (!actions.has(action)) return Promise.resolve(new Response(null, { status: 404 }));
  return createDriveHandler(action as DriveAction)(request);
} };
