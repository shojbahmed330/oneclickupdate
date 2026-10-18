/**
 * Tracks the last project the user was actively working on so that
 * navigations to `/` or `/dashboard` (without an id) return the user to
 * their builder workspace instead of yanking them to `/projects`.
 *
 * Stored in localStorage so it survives reloads / auth refreshes.
 */
const KEY = "lastProjectId";

export function getLastProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setLastProjectId(id: string | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function clearLastProjectId() {
  setLastProjectId(null);
}
