/** Compact Google-style ranges, retaining both periods when they differ. */
export function formatEventTimeRange(start: string, end: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = (value: string) => {
    const formatted = formatter.formatToParts(new Date(value));
    const hour = formatted.find((part) => part.type === "hour")!.value;
    const minute = formatted.find((part) => part.type === "minute")!.value;
    const period = formatted.find((part) => part.type === "dayPeriod")!.value.toLowerCase();
    return { clock: minute === "00" ? hour : `${hour}:${minute}`, period };
  };
  const from = parts(start);
  const to = parts(end);
  return `${from.clock}${from.period === to.period ? "" : from.period} – ${to.clock}${to.period}`;
}
