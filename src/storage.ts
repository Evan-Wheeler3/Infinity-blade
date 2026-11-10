/** Autosave to localStorage. Storage can be unavailable (private mode), so every access is guarded. */
import { newProfile, type Profile } from './core/profile';

const KEY = 'hollowspire.save.v1';

export function loadProfile(): { profile: Profile; existing: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Profile;
      if (data && data.version === 1) {
        // Fill fields added after a save was written.
        const fresh = newProfile();
        return { profile: { ...fresh, ...data, settings: { ...fresh.settings, ...data.settings }, stats: { ...fresh.stats, ...data.stats } }, existing: true };
      }
    }
  } catch {
    /* fall through to a new profile */
  }
  return { profile: newProfile(), existing: false };
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked; the session still plays */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
