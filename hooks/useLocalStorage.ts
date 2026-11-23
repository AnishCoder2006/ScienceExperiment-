"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * useState that is also saved in the browser's localStorage, so it survives a refresh.
 * The server cannot read localStorage, so the first render uses `initial` and the saved
 * value is loaded right after mount. `loaded` tells you when that has happened.
 * Every read and write is wrapped in try/catch: private windows can block storage.
 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      // Corrupt JSON or blocked storage: keep the initial value.
    }
    setLoaded(true);

    // Keep other open tabs in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      try {
        setValue(e.newValue ? (JSON.parse(e.newValue) as T) : initial);
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // `initial` is only used as a fallback, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(value));
        } catch {}
        return value;
      });
    },
    [key],
  );

  return [value, update, loaded] as const;
}
