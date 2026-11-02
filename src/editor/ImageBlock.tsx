import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, ImageOff, Maximize2, Type, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db } from '../lib/db';
import { saveBlob } from '../lib/pdf';
import { store } from '../lib/store';
import type { NoteImage } from '../lib/types';

const MIN_WIDTH = 15;
const SIZES = [
  { label: 'S', name: 'Small', width: 33 },
  { label: 'M', name: 'Medium', width: 60 },
  { label: 'L', name: 'Full width', width: 100 },
];

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function Lightbox({ src, alt, close }: { src: string; alt: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="lightbox"
      contentEditable={false}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={close}
    >
      <img src={src} alt={alt} />
      <button type="button" className="lightbox-close" aria-label="Close image" autoFocus onClick={close}>
        <X size={18} />
      </button>
    </dialog>
  );
}

function ImageView({ node, selected, editor, updateAttributes }: NodeViewProps) {
  const imageId: string = node.attrs.imageId;
  const alt: string = node.attrs.alt ?? '';
  const image = useLiveQuery(() => db.images.get(imageId), [imageId], null as NoteImage | null | undefined);
  const src = useObjectUrl(image?.blob);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [viewing, setViewing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const width: number = liveWidth ?? node.attrs.width ?? 100;
  const editable = editor.isEditable;

  const startResize = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const box = wrap.current!.getBoundingClientRect();
    let next = width;
    const move = (ev: PointerEvent) => {
      next = Math.round(Math.max(MIN_WIDTH, Math.min(100, ((ev.clientX - box.left) / box.width) * 100)));
      setLiveWidth(next);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      updateAttributes({ width: next });
      setLiveWidth(null);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  if (image === undefined) {
    return (
      <NodeViewWrapper className="image-node" data-drag-handle>
        <div className="image-missing" contentEditable={false}>
          <ImageOff size={16} /> This image is no longer on this device
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="image-node" ref={wrap}>
      <figure
        className="image-frame"
        data-selected={selected && editable}
        contentEditable={false}
        data-drag-handle
        style={{
          width: `${width}%`,
          aspectRatio: image?.width && image.height ? `${image.width} / ${image.height}` : undefined,
        }}
        onDoubleClick={() => setViewing(true)}
        onClick={() => {
          if (!editable) setViewing(true);
        }}
      >
        {src && <img src={src} alt={alt} draggable={false} />}
        {selected && editable && (
          <>
            <div className="image-tools" role="toolbar" aria-label="Image options">
              {SIZES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="image-size"
                  title={s.name}
                  aria-label={s.name}
                  aria-pressed={width === s.width}
                  onClick={() => updateAttributes({ width: s.width })}
                >
                  {s.label}
                </button>
              ))}
              <span className="format-sep" />
              <button
                type="button"
                title="Describe image"
                aria-label="Describe image"
                data-active={Boolean(alt)}
                onClick={() =>
                  store.getState().setDialog({
                    kind: 'prompt',
                    title: 'Describe this image',
                    label: 'Description',
                    value: alt,
                    allowEmpty: true,
                    confirm: 'Save',
                    hint: 'Read aloud by screen readers, and included in search.',
                    onConfirm: (v) => updateAttributes({ alt: v.trim() }),
                  })
                }
              >
                <Type size={15} />
              </button>
              <button type="button" title="View full size" aria-label="View full size" onClick={() => setViewing(true)}>
                <Maximize2 size={15} />
              </button>
              <button
                type="button"
                title="Download"
                aria-label="Download image"
                onClick={() => image && saveBlob(image.blob, image.name)}
              >
                <Download size={15} />
              </button>
            </div>
            <span className="image-handle" aria-hidden onPointerDown={startResize} />
          </>
        )}
      </figure>
      {viewing && src && <Lightbox src={src} alt={alt} close={() => setViewing(false)} />}
    </NodeViewWrapper>
  );
}

export const ImageBlock = Node.create({
  name: 'noteImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      imageId: { default: null, parseHTML: (el) => el.getAttribute('data-image-id') },
      alt: { default: '', parseHTML: (el) => el.getAttribute('data-alt') ?? '' },
      width: { default: 100, parseHTML: (el) => Number(el.getAttribute('data-width')) || 100 },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-note-image]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-note-image': '',
        'data-image-id': node.attrs.imageId,
        'data-alt': node.attrs.alt,
        'data-width': node.attrs.width,
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView, {
      // The toolbar, handle and full-size view handle their own events.
      stopEvent: ({ event }) => {
        const t = event.target as HTMLElement | null;
        return Boolean(t?.closest?.('.image-tools, .image-handle, .lightbox'));
      },
    });
  },
});
