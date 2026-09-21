export interface SearchPage {
  readonly to: string;
  readonly label: string;
}

/** The sidebar's sections, then the two pages that live in the account menu. */
const SEARCH_PAGES: readonly SearchPage[] = [
  { to: "/", label: "Home" },
  { to: "/todos", label: "Tasks" },
  { to: "/ideas", label: "Ideas" },
  { to: "/projects", label: "Projects" },
  { to: "/classes", label: "Classes" },
  { to: "/career", label: "Career" },
  { to: "/appearance", label: "Appearance" },
  { to: "/settings", label: "Settings" },
];

/** Every page for an empty query; otherwise the pages whose name contains it, prefix matches first. */
export function matchPages(query: string): readonly SearchPage[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SEARCH_PAGES;
  const matches = SEARCH_PAGES.filter((page) => page.label.toLowerCase().includes(needle));
  return [
    ...matches.filter((page) => page.label.toLowerCase().startsWith(needle)),
    ...matches.filter((page) => !page.label.toLowerCase().startsWith(needle)),
  ];
}

/** Steps a highlight through `count` rows, wrapping at both ends; -1 means nothing is highlighted. */
export function stepHighlight(current: number, direction: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}
