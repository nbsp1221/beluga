export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences remain available in memory when storage is blocked or full.
  }
}

export function isLocalPreferenceEvent(event: StorageEvent, key: string): boolean {
  try {
    return event.key === key && event.storageArea === window.localStorage;
  } catch {
    return false;
  }
}
