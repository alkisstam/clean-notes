import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Lock } from 'lucide-react';
import { db } from '../lib/db';
import { formatBytes } from '../lib/pdf';
import { useStore } from '../lib/store';

function PdfCard({ node, selected }: NodeViewProps) {
  const fileId: string = node.attrs.fileId;
  const file = useLiveQuery(() => db.files.get(fileId), [fileId], null);
  const setPdf = useStore((s) => s.setPdf);
  const open = useStore((s) => s.pdf?.fileId === fileId);
  const missing = file === undefined;
  const pages = file?.encrypted ? 'Password protected' : file ? `${file.pageCount} ${file.pageCount === 1 ? 'page' : 'pages'}` : '';
  return (
    <NodeViewWrapper className="pdf-node" data-drag-handle>
      <button
        type="button"
        className="pdf-card"
        data-selected={selected}
        data-open={open}
        disabled={missing}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPdf({ fileId })}
        contentEditable={false}
      >
        <span className="pdf-thumb">
          {file?.thumb ? <img src={file.thumb} alt="" draggable={false} /> : file?.encrypted ? <Lock size={20} /> : <FileText size={20} />}
        </span>
        <span className="pdf-card-text">
          <strong>{node.attrs.name}</strong>
          <small>{missing ? 'This file is no longer on this device' : file ? `${pages} · ${formatBytes(file.size)}` : ' '}</small>
        </span>
        {!missing && <span className="pdf-open">{open ? 'Open' : 'View'}</span>}
      </button>
    </NodeViewWrapper>
  );
}

export const PdfAttachment = Node.create({
  name: 'pdfAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      fileId: { default: null, parseHTML: (el) => el.getAttribute('data-file-id') },
      name: { default: 'document.pdf', parseHTML: (el) => el.getAttribute('data-name') },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-pdf-attachment]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-pdf-attachment': '',
        'data-file-id': node.attrs.fileId,
        'data-name': node.attrs.name,
      }),
      node.attrs.name,
    ];
  },
  addNodeView() {
    // Clicking the card opens the PDF. It must not select the block, because the
    // next keystroke would then replace it with text.
    return ReactNodeViewRenderer(PdfCard, {
      stopEvent: ({ event }) => /^(mouse|pointer|click)/.test(event.type),
    });
  },
});
