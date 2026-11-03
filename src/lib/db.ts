import Dexie, { type EntityTable } from 'dexie';
import type { Note, NoteImage, Notebook, PdfBlob, PdfFile, Tombstone } from './types';

export const db = new Dexie('clean-notes') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  notebooks: EntityTable<Notebook, 'id'>;
  files: EntityTable<PdfFile, 'id'>;
  blobs: EntityTable<PdfBlob, 'id'>;
  images: EntityTable<NoteImage, 'id'>;
  tombstones: EntityTable<Tombstone, 'id'>;
  /** Device-local settings: backup file handle, sync server, sync markers. Never exported. */
  meta: EntityTable<{ key: string; value: unknown }, 'key'>;
};

db.version(1).stores({
  notes: 'id, updatedAt, notebookId, kind, date, trashedAt, *tags',
  notebooks: 'id, createdAt',
  files: 'id, createdAt',
  blobs: 'id',
});

db.version(2).stores({ images: 'id' });

db.version(3).stores({ tombstones: 'id', meta: 'key' });

/** Called after every data write, so auto-backup and sync know there is something new. */
export const writeListeners = new Set<() => void>();

db.use({
  stack: 'dbcore',
  name: 'dirty',
  create: (down) => ({
    ...down,
    table: (name) => {
      const t = down.table(name);
      if (name === 'meta') return t;
      return {
        ...t,
        mutate: (req) =>
          t.mutate(req).then((res) => {
            writeListeners.forEach((l) => l());
            return res;
          }),
      };
    },
  }),
});

export const getMeta = async <T>(key: string) => (await db.meta.get(key))?.value as T | undefined;
export const setMeta = (key: string, value: unknown) =>
  value === undefined ? db.meta.delete(key) : db.meta.put({ key, value });

export const uid = () => crypto.randomUUID();
