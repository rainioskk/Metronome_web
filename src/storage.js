export function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Private browsing and restricted file contexts can disable storage.
  }
}

export function readNumber(key, fallback) {
  const value = Number.parseInt(readStorage(key) ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export function readBoolean(key, fallback) {
  const value = readStorage(key);
  if (value === null) return fallback;
  return value === "true";
}
