import { useSyncExternalStore } from "react";

export function useTheme() {
  const theme = useSyncExternalStore(window.HSRTheme.subscribe, window.HSRTheme.get);
  return { dark: theme === "dark", toggleTheme: () => window.HSRTheme.set(theme === "dark" ? "light" : "dark") };
}
