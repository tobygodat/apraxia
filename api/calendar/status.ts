import { createCalendarHandler } from "../../server/calendar/calendarHandlers.js";
export default { fetch: createCalendarHandler("status") };
