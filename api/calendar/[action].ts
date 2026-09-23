import {
  createCalendarHandler,
  type CalendarAction,
} from "../../server/calendar/calendarHandlers.js";

// One function for every calendar action: a warm instance then serves status,
// calendars, and events in turn instead of each path cold-starting its own
// lambda.
const actions = new Set<CalendarAction>([
  "connect",
  "callback",
  "complete",
  "disconnect",
  "status",
  "calendars",
  "events",
]);

export default {
  fetch(request: Request) {
    const action = new URL(request.url).pathname.split("/").pop() ?? "";
    if (!actions.has(action as CalendarAction))
      return Promise.resolve(new Response(null, { status: 404 }));
    return createCalendarHandler(action as CalendarAction)(request);
  },
};
