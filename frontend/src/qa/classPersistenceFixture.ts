import type { ClassService, Course } from "../features/classes/classService";
/** Fictional services only. Retained across navigation, reset on QA reload. */
/**
 * A full course load, so a scenario can exercise a surface that groups by
 * class against more than the two classes the default seed carries.
 */
const MATH_NOTES = `# Week 6 — generating functions

A generating function turns a sequence into a single power series, so counting
becomes algebra.

- ordinary generating functions for unordered counts
- exponential ones when the order inside a block matters
- partial fractions are how a closed form falls out
- the [course page](https://example.invalid/math3012) has the worked examples

## before the quiz

- [x] rework the recurrence from lecture 11
- [ ] the two starred problems in the notes
- [ ] office hours friday, bring the partial-fraction question

> “Every counting problem is a generating function you have not written down
> yet.” — lecture 12

\`\`\`
a(n) = 3a(n-1) - 2a(n-2),  a(0) = 1, a(1) = 3
\`\`\`
`;

const DENSE_COURSES: Course[] = [
  { id: "cs1332", name: "CS1332", notes: "", updatedAt: "seed" },
  { id: "cs2340", name: "CS2340", notes: "", updatedAt: "seed" },
  { id: "math2551", name: "MATH2551", notes: "", updatedAt: "seed" },
  { id: "phys2211", name: "PHYS2211", notes: "", updatedAt: "seed" },
];

export function createClassPersistenceFixture(
  empty = false,
  dense = false,
  /** The `personal` scenario's classes, in place of the fictional ones. */
  seed?: {
    owner: string;
    classes: { id: string; name: string | null }[];
  },
): {
  classes: ClassService;
} {
  const owners = new Map<string, Course[]>();
  let revision = 0;
  if (seed) {
    owners.set(
      seed.owner,
      seed.classes.map((course) => ({ ...course, notes: "", updatedAt: "seed" })),
    );
  }
  const rows = (owner: string) => {
    if (!owners.has(owner))
      owners.set(
        owner,
        empty
          ? []
          : [
              { id: "math3012", name: "MATH3012", notes: MATH_NOTES, updatedAt: "seed" },
              // A second, untouched class so the list shows both a class with
              // work in it and one with nothing saved yet.
              { id: "hist2111", name: "HIST2111", notes: "", updatedAt: "seed" },
              ...(dense ? DENSE_COURSES : []),
            ],
      );
    return owners.get(owner)!;
  };
  return {
    classes: {
      async list(owner) {
        return rows(owner).map((row) => ({ ...row }));
      },
      async importLegacy() {
        /* QA never imports real browser records. */
      },
      async create(owner, value) {
        const existing = rows(owner).find((c) => c.id === value.id);
        if (existing) return { ...existing };
        const course = { ...value, notes: "", updatedAt: String(++revision) };
        rows(owner).push(course);
        return { ...course };
      },
      async saveNotes(owner, value, notes) {
        const course = rows(owner).find((c) => c.id === value.id);
        if (!course) throw new Error("Couldn’t save these notes. Try again.");
        course.notes = notes;
        course.updatedAt = String(++revision);
        return { ...course };
      },
      async rename(owner, value, name) {
        const course = rows(owner).find((c) => c.id === value.id);
        if (!course || course.updatedAt !== value.updatedAt)
          throw new Error("This class changed elsewhere. Reload classes.");
        course.name = name;
        course.updatedAt = String(++revision);
        return { ...course };
      },
    },
  };
}
