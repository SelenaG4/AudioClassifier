import {open, NitroSQLiteConnection} from 'react-native-nitro-sqlite';

let db: NitroSQLiteConnection | null = null;

export interface SoundEvent {
  id: number;
  label: string;
  score: number;
  timestamp: string;
}

export function initDatabase(): void {
  db = open({name: 'audioevents.db'});
  db.execute(`
    CREATE TABLE IF NOT EXISTS sound_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      score REAL NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  console.log('Database ready');
}

export function logEvent(label: string, score: number): void {
  if (!db) return;
  db.execute(
    'INSERT INTO sound_events (label, score, timestamp) VALUES (?, ?, ?);',
    [label, score, new Date().toISOString()],
  );
}

export function getRecentEvents(limit = 20): SoundEvent[] {
  if (!db) return [];
  const result = db.execute(
    'SELECT id, label, score, timestamp FROM sound_events ORDER BY id DESC LIMIT ?;',
    [limit],
  );
  return (result.rows?._array ?? []) as SoundEvent[];
}

export function clearEvents(): void {
  if (!db) return;
  db.execute('DELETE FROM sound_events;');
}
/** Total number of logged events, regardless of the display limit. */
export function getEventCount(): number {
  if (!db) return 0;
  const result = db.execute('SELECT COUNT(*) AS total FROM sound_events;');
  const row = result.rows?._array?.[0] as {total: number} | undefined;
  return row?.total ?? 0;
}