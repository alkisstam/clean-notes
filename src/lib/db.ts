import Dexie, { type EntityTable } from 'dexie';
import type { Note, NoteImage, Notebook, PdfBlob, PdfFile } from './types';

export const db = new Dexie('clean-notes') as Dexie & {
  notes: EntityTable<Note, 'id'>;
  notebooks: EntityTable<Notebook, 'id'>;
  files: EntityTable<PdfFile, 'id'>;
  blobs: EntityTable<PdfBlob, 'id'>;
  images: EntityTable<NoteImage, 'id'>;
};

db.version(1).stores({
  notes: 'id, updatedAt, notebookId, kind, date, trashedAt, *tags',
  notebooks: 'id, createdAt',
  files: 'id, createdAt',
  blobs: 'id',
});

db.version(2).stores({ images: 'id' });

export const uid = () => crypto.randomUUID();
