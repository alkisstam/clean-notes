import { TaskItem } from '@tiptap/extension-list';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { dateKey, dueLabel } from '../lib/dates';

/** To-do item with a stable id, so the Tasks view can reach it, and an optional due date. */
export const TaskItemDue = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-task-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-task-id': attrs.id } : {}),
      },
      due: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-due'),
        renderHTML: (attrs) => (attrs.due ? { 'data-due': attrs.due } : {}),
      },
    };
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const li = document.createElement('li');
      li.dataset.type = 'taskItem';

      const label = document.createElement('label');
      label.className = 'task-check';
      label.contentEditable = 'false';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.setAttribute('aria-label', 'Mark task complete');
      const box = document.createElement('span');
      box.className = 'task-box';
      label.append(check, box);

      const content = document.createElement('div');
      content.className = 'task-content';

      const dueWrap = document.createElement('span');
      dueWrap.className = 'task-due';
      dueWrap.contentEditable = 'false';
      const dueBtn = document.createElement('button');
      dueBtn.type = 'button';
      dueBtn.tabIndex = -1;
      const dueInput = document.createElement('input');
      dueInput.type = 'date';
      dueInput.tabIndex = -1;
      dueInput.setAttribute('aria-label', 'Due date');
      dueWrap.append(dueBtn, dueInput);
      li.append(label, content, dueWrap);

      const setAttrs = (attrs: Record<string, unknown>) => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }),
        );
      };

      check.addEventListener('change', () => setAttrs({ checked: check.checked }));
      dueBtn.addEventListener('click', () => {
        dueInput.value = node.attrs.due ?? '';
        try {
          dueInput.showPicker();
        } catch {
          dueInput.focus();
        }
      });
      dueInput.addEventListener('change', () => setAttrs({ due: dueInput.value || null }));

      const paint = () => {
        const due: string | null = node.attrs.due;
        const today = dateKey();
        li.dataset.checked = String(Boolean(node.attrs.checked));
        if (node.attrs.id) li.dataset.taskId = node.attrs.id;
        check.checked = Boolean(node.attrs.checked);
        dueBtn.textContent = due ? dueLabel(due, today) : '+ date';
        dueBtn.setAttribute('aria-label', due ? `Due ${dueLabel(due, today)}. Change date` : 'Add due date');
        dueWrap.dataset.set = String(Boolean(due));
        dueWrap.dataset.late = String(Boolean(due && due < today && !node.attrs.checked));
      };
      paint();

      return {
        dom: li,
        contentDOM: content,
        update: (next) => {
          if (next.type !== node.type) return false;
          node = next;
          paint();
          return true;
        },
        stopEvent: (e) => dueWrap.contains(e.target as Node) || label.contains(e.target as Node),
        ignoreMutation: (m) => !content.contains(m.target),
      };
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      ...(this.parent?.() ?? []),
      // Gives new to-dos an id, and a fresh one when a split or paste duplicates it.
      new Plugin({
        key: new PluginKey('taskIds'),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          let tr = state.tr;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (node.type !== type) return;
            const id: string | null = node.attrs.id;
            if (id && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const fresh = crypto.randomUUID();
            seen.add(fresh);
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh, ...(id ? { due: null } : {}) });
            changed = true;
          });
          return changed ? tr.setMeta('addToHistory', false) : null;
        },
      }),
    ];
  },
});
