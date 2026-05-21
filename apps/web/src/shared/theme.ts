export const THEMES = ["light", "dark"] as const;

export type AppTheme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "gpt-image-canvas.theme";

export function isAppTheme(value: string | null | undefined): value is AppTheme {
  return value === "light" || value === "dark";
}

export function readStoredTheme(storage: Pick<Storage, "getItem">): AppTheme | undefined {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return isAppTheme(value) ? value : undefined;
}

export function resolveInitialTheme(input: {
  storage?: Pick<Storage, "getItem">;
  matchMedia?: (query: string) => Pick<MediaQueryList, "matches">;
}): AppTheme {
  const storedTheme = input.storage ? readStoredTheme(input.storage) : undefined;
  if (storedTheme) {
    return storedTheme;
  }

  if (input.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}
