import type { JSONContent } from '@tiptap/core';

export interface Note {
  id: string;
  title: string;
  content: JSONContent;
  /** Plain text of the content, kept for the list preview and search. */
  text: string;
  notebookId: string | null;
  /** Note this one is nested under. Absent on top-level notes and ones made before sub-notes existed. */
  parentId?: string | null;
  tags: string[];
  kind: 'note' | 'daily';
  /** YYYY-MM-DD, daily notes only. */
  date?: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  /** Hidden from lists and Tasks, still searchable. Absent on notes made before archiving existed. */
  archivedAt?: number | null;
  /** Which editor instance wrote last, so an editor ignores its own echoes. */
  writer?: string;
}

export interface Notebook {
  id: string;
  name: string;
  createdAt: number;
  /** Absent on notebooks made before sync existed. */
  updatedAt?: number;
}

/** Remembers a hard delete so merges on other devices remove the row too. */
export interface Tombstone {
  id: string;
  table: 'notes' | 'notebooks';
  deletedAt: number;
}

export interface PdfFile {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  pageTexts: string[];
  thumb: string | null;
  encrypted: boolean;
  createdAt: number;
}

export interface PdfBlob {
  id: string;
  blob: Blob;
}

export interface NoteImage {
  id: string;
  name: string;
  size: number;
  width: number;
  height: number;
  blob: Blob;
  createdAt: number;
}

export type View =
  | { type: 'all' }
  | { type: 'daily' }
  | { type: 'tasks' }
  | { type: 'pdfs' }
  | { type: 'pinned' }
  | { type: 'archive' }
  | { type: 'trash' }
  | { type: 'notebook'; id: string }
  | { type: 'tag'; path: string };

export interface TaskRef {
  id: string;
  noteId: string;
  noteTitle: string;
  text: string;
  done: boolean;
  due: string | null;
}
