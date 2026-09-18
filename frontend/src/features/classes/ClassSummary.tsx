import { describeClassOverview, type ClassOverview } from "./classOverview";

/**
 * One ruled line of class facts: what is due next, then how much is open and
 * saved. The list row pushes the counts to its right edge; the class header
 * keeps them inline behind a middle dot.
 */
export function ClassSummary({
  overview,
  today,
  variant,
}: {
  overview: ClassOverview;
  today: string;
  variant: "row" | "header";
}) {
  const { due, overdue, counts } = describeClassOverview(overview, today);
  return (
    <p className={`classes-summary classes-summary--${variant}`}>
      <span className={overdue ? "classes-summary__due classes-summary__due--overdue" : undefined}>
        {due}
      </span>
      {counts && <span className="classes-summary__counts">{counts}</span>}
    </p>
  );
}
