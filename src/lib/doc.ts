import type { JSONContent } from '@tiptap/core';

export const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });

const BLOCKS = new Set([
  'paragraph', 'heading', 'codeBlock', 'tableCell', 'tableHeader', 'pdfAttachment', 'noteImage',
]);

/** Plain text of a document. Blocks are separated by newlines. */
export function docText(node: JSONContent | undefined): string {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text') out.push(n.text ?? '');
    else if (n.type === 'hardBreak') out.push(' ');
    else if (n.type === 'pdfAttachment') out.push(String(n.attrs?.name ?? ''));
    else if (n.type === 'noteImage') out.push(String(n.attrs?.alt ?? ''));
    n.content?.forEach(walk);
    if (n.type && BLOCKS.has(n.type)) out.push('\n');
  };
  if (node) walk(node);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}

/** Text of a node's own inline content, leaving nested blocks out. */
export function ownText(node: JSONContent): string {
  const first = node.content?.find((c) => c.type === 'paragraph');
  return first ? docText(first) : '';
}

export function walkDoc(node: JSONContent, visit: (n: JSONContent) => void) {
  visit(node);
  node.content?.forEach((c) => walkDoc(c, visit));
}

export function imageIdsIn(doc: JSONContent): string[] {
  const ids: string[] = [];
  walkDoc(doc, (n) => {
    if (n.type === 'noteImage' && n.attrs?.imageId) ids.push(String(n.attrs.imageId));
  });
  return ids;
}

export function pdfIdsIn(doc: JSONContent): string[] {
  const ids: string[] = [];
  walkDoc(doc, (n) => {
    if (n.type === 'pdfAttachment' && n.attrs?.fileId) ids.push(String(n.attrs.fileId));
  });
  return ids;
}
