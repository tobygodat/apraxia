import type { ReactNode } from "react";

const icons = {
  maximize: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  minimize: <path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5" />,
  classes: (
    <>
      <path d="m2 8 10-5 10 5-10 5Z M6 10v7q6 5 12 0v-7M22 8v8" />
    </>
  ),
  home: <path d="m3 10 9-7 9 7v10H3Z M9 20v-7h6v7" />,
  todos: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  ideas: <path d="M5 3h10l4 4v14H5ZM14 3v5h5M8 12h8m-8 4h6" />,
  projects: <path d="M3 7V4h6l3 3h9v13H3Z M3 10h18" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  refresh: (
    <>
      <path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" />
    </>
  ),
  edit: <path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14ZM13 20h8" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 10h18M7 14h2m4 0h2" />
    </>
  ),
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type WorkspaceIconName = keyof typeof icons;

export function WorkspaceIcon({
  name,
  className = "",
}: {
  name: WorkspaceIconName;
  className?: string;
}) {
  return (
    <svg
      className={`workspace-icon ${className}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}
