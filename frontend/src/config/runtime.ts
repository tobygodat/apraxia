export type RuntimeMode = "cloud" | "legacy";

export function resolveRuntimeMode(value?: string): RuntimeMode {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "cloud") return "cloud";
  if (normalized === "legacy") return "legacy";

  throw new Error(
    "VITE_ORBITOS_RUNTIME must be either cloud or legacy. No legacy data was loaded.",
  );
}
