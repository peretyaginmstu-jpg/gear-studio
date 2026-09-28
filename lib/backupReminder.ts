/** Projects live only in this browser: remind to keep a copy once there is work worth losing. */
export const BACKUP_INTERVAL_DAYS = 7;
const KEY = 'gear-project-backups';
type Entry = { backedUpAt?: string; snoozedUntil?: string };

export function shouldRemindBackup(input: { hasWork: boolean; updatedAt: string; entry?: Entry; now?: Date }): boolean {
  const now = input.now ?? new Date(), day = 86_400_000;
  if (!input.hasWork) return false;
  if (input.entry?.snoozedUntil && Date.parse(input.entry.snoozedUntil) > now.getTime()) return false;
  const backedUp = input.entry?.backedUpAt ? Date.parse(input.entry.backedUpAt) : NaN;
  if (Number.isNaN(backedUp)) return now.getTime() - Date.parse(input.updatedAt) >= 0;
  // A recent copy is enough; an old one matters only if the project changed after it.
  return now.getTime() - backedUp >= BACKUP_INTERVAL_DAYS * day && Date.parse(input.updatedAt) > backedUp;
}

const read = (): Record<string, Entry> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const write = (map: Record<string, Entry>) => { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode: reminder just repeats */ } };
export const backupEntry = (id: string): Entry | undefined => read()[id];
export function markBackedUp(id: string, at = new Date()) { const map = read(); map[id] = { backedUpAt: at.toISOString() }; write(map); }
export function snoozeBackup(id: string, days = BACKUP_INTERVAL_DAYS, now = new Date()) {
  const map = read(); map[id] = { ...map[id], snoozedUntil: new Date(now.getTime() + days * 86_400_000).toISOString() }; write(map);
}
