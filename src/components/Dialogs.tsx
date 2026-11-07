import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileClock, HardDrive, Laptop, Moon, QrCode, RefreshCw, Sun, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { autoBackupSupported, chooseBackupFile, exportBackup, importBackup, stopAutoBackup } from '../lib/backup';
import { relativeTime } from '../lib/dates';
import { db } from '../lib/db';
import { formatBytes } from '../lib/pdf';
import { foldQuery } from '../lib/search';
import { useStore, type DialogState, type ThemePref } from '../lib/store';
import { disableServerSync, enableServerSync, syncNow } from '../lib/sync';

export const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: 'system', label: 'System', icon: Laptop },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      data-wide={wide}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-body">
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function Prompt({ dialog, close }: { dialog: Extract<DialogState, { kind: 'prompt' }>; close: () => void }) {
  const [value, setValue] = useState(dialog.value);
  return (
    <Modal title={dialog.title} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim() && !dialog.allowEmpty) return;
          dialog.onConfirm(value);
          close();
        }}
      >
        <label className="field">
          <span>{dialog.label}</span>
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        {dialog.hint && <p className="dialog-hint">{dialog.hint}</p>}
        <footer>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!value.trim() && !dialog.allowEmpty}>{dialog.confirm}</button>
        </footer>
      </form>
    </Modal>
  );
}

function PickNote({ dialog, close }: { dialog: Extract<DialogState, { kind: 'pickNote' }>; close: () => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // After the Modal's showModal(), which moves focus to its close button.
  useEffect(() => input.current?.focus(), []);
  const current = useStore((s) => s.noteId);
  const notes = useLiveQuery(() => db.notes.filter((n) => !n.trashedAt && n.id !== current).toArray(), [current], []);
  const shown = useMemo(() => {
    const q = foldQuery(query);
    return notes
      .map((n) => ({ n, title: n.title || 'Untitled' }))
      .filter(({ title }) => !q || foldQuery(title).includes(q))
      .sort((a, b) => b.n.updatedAt - a.n.updatedAt)
      .slice(0, 50);
  }, [notes, query]);
  const pick = (id: string, title: string) => {
    close();
    dialog.onPick(id, title);
  };
  return (
    <Modal title="Link to note" onClose={close}>
      <form
        className="pick-note"
        onSubmit={(e) => {
          e.preventDefault();
          if (shown[0]) pick(shown[0].n.id, shown[0].title);
        }}
      >
        <label className="field">
          <span className="sr-only">Search notes</span>
          <input ref={input} value={query} placeholder="Search notes" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="pick-note-list" role="listbox" aria-label="Notes">
          {shown.length === 0 && <p className="dialog-hint">No matching note</p>}
          {shown.map(({ n, title }) => (
            <button key={n.id} type="button" role="option" aria-selected={false} onClick={() => pick(n.id, title)}>{title}{n.text && <small>{n.text}</small>}</button>
          ))}
        </div>
        {dialog.onUnlink && (
          <footer>
            <button
              type="button"
              className="btn"
              onClick={() => {
                close();
                dialog.onUnlink!();
              }}
            >Remove link</button>
          </footer>
        )}
      </form>
    </Modal>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | null = null;
const installListeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as InstallEvent;
  installListeners.forEach((l) => l());
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  installListeners.forEach((l) => l());
});

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Search'],
  ['Alt N', 'New note'],
  ['Alt T', "Today's note"],
  ['Ctrl \\', 'Focus mode'],
  ['/', 'Insert a block'],
  ['Ctrl click', 'Open a link'],
];

function Settings({ close }: { close: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const showToast = useStore((s) => s.showToast);
  const counts = useLiveQuery(async () => ({
    notes: await db.notes.filter((n) => !n.trashedAt).count(),
    files: await db.files.count(),
    images: await db.images.count(),
  }), []);
  const autoBackup = useLiveQuery(async () => {
    const handle = (await db.meta.get('backupFile'))?.value as FileSystemFileHandle | undefined;
    const at = (await db.meta.get('backupWrittenTime'))?.value as number | undefined;
    return handle ? { name: handle.name, at } : null;
  }, []);
  const sync = useLiveQuery(async () => {
    const on = !!(await db.meta.get('syncToken'))?.value;
    const at = (await db.meta.get('syncedAt'))?.value as number | undefined;
    return { on, at };
  }, []);
  const [token, setToken] = useState('');
  // The desktop app has no server behind it, so it asks for one; the web app syncs with the server it came from.
  const [server, setServer] = useState('https://');
  const [pairQr, setPairQr] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [, bump] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void window.desktop?.syncServer().then((s) => s && setServer(s));
  }, []);

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage(`${formatBytes(e.usage ?? 0)} of ${formatBytes(e.quota ?? 0)} available`));
    void navigator.storage?.persisted?.().then(setPersisted);
    const l = () => bump((n) => n + 1);
    installListeners.add(l);
    return () => {
      installListeners.delete(l);
    };
  }, []);

  return (
    <Modal title="Settings" onClose={close} wide>
      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3>Your data</h3>
        <p>
          Everything stays in this browser. Clearing site data removes it, so keep a backup.
        </p>
        <p className="settings-stat">
          <HardDrive size={14} />
          <span>
            {counts ? `${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'}, ${counts.files} ${counts.files === 1 ? 'PDF' : 'PDFs'}, ${counts.images} ${counts.images === 1 ? 'image' : 'images'}` : '…'}
            {usage ? `. ${usage}.` : ''}
            {persisted === true ? ' Protected from automatic cleanup.' : ''}
          </span>
        </p>
        <div className="settings-row">
          <button
            type="button"
            className="btn"
            onClick={() => void exportBackup().catch(() => showToast({ message: 'The backup could not be created.' }))}
          >
            <Download size={14} /> Export backup
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Restore backup
          </button>
          {persisted === false && (
            <button
              type="button"
              className="btn"
              onClick={() => void navigator.storage.persist().then((ok) => {
                setPersisted(ok);
                showToast({ message: ok ? 'Storage is now protected.' : 'The browser declined. Installing the app usually helps.' });
              })}
            >
              Protect storage
            </button>
          )}
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="application/json,.json"
            aria-label="Backup file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void importBackup(file)
                .then(async ({ added, updated, skipped }) => {
                  showToast({ message: `Restored: ${added} added, ${updated} updated, ${skipped} already current.` });
                  await syncNow(true);
                })
                .catch((err: Error) => showToast({ message: err.message }));
            }}
          />
        </div>
        <p className="dialog-hint">Restoring merges with what is here. If a note exists in both, the newer copy wins.</p>
        {autoBackupSupported && (
          <>
            <p className="settings-stat">
              <FileClock size={14} />
              <span>
                {autoBackup
                  ? `Auto-backup to ${autoBackup.name}${autoBackup.at ? `, last saved ${relativeTime(autoBackup.at)}` : ''}.`
                  : 'Auto-backup is off.'}
              </span>
            </p>
            <div className="settings-row">
              <button
                type="button"
                className="btn"
                onClick={() => void chooseBackupFile()
                  .then(() => syncNow(true))
                  .catch((err: Error) => err.name !== 'AbortError' && showToast({ message: 'Auto-backup could not be set up.' }))}
              >
                <FileClock size={14} /> {autoBackup ? 'Change file' : 'Auto-backup to a file'}
              </button>
              {autoBackup && (
                <button type="button" className="btn" onClick={() => void stopAutoBackup()}>
                  Stop
                </button>
              )}
            </div>
            <p className="dialog-hint">
              The file is rewritten about a minute after each change. Put it in a Dropbox, Drive or Syncthing folder and choose the same file on your other computers to keep them in sync.
            </p>
          </>
        )}
      </section>

      <section className="settings-section">
        <h3>Sync</h3>
        <p>
          {window.desktop
            ? 'Keep your devices in step through your Clean Notes server. Notes are sent to that server over HTTPS.'
            : 'Keep your devices in step through the server this app is hosted on. Notes are sent to that server over HTTPS.'}
        </p>
        {sync?.on ? (
          <>
            <p className="settings-stat">
              <RefreshCw size={14} />
              <span>{sync.at ? `Last synced ${relativeTime(sync.at)}.` : 'Not synced yet.'}</span>
            </p>
            <div className="settings-row">
              <button type="button" className="btn" onClick={() => void syncNow()}>
                <RefreshCw size={14} /> Sync now
              </button>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  if (pairQr) return setPairQr(null);
                  const { toDataURL } = await import('qrcode');
                  const token = (await db.meta.get('syncToken'))?.value as string;
                  const url = window.desktop ? await window.desktop.syncServer() : new URL('.', location.href).href;
                  setPairQr(await toDataURL(JSON.stringify({ url, token }), { margin: 1, width: 240 }));
                }}
              >
                <QrCode size={14} /> {pairQr ? 'Hide code' : 'Pair a phone'}
              </button>
              <button type="button" className="btn" onClick={() => void disableServerSync().then(() => setPairQr(null))}>
                Turn off
              </button>
            </div>
            {pairQr && (
              <>
                <img className="pair-qr" src={pairQr} alt="Pairing code with the sync address and token" width={240} height={240} />
                <p className="dialog-hint">Scan this in the Clean Notes Android app. It contains your sync token, so don't share it.</p>
              </>
            )}
          </>
        ) : (
          <form
            className="settings-row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token.trim()) return;
              try {
                await window.desktop?.setSyncServer(server.trim());
              } catch {
                return showToast({ message: 'Enter the server address, starting with https://' });
              }
              await enableServerSync(token);
              setToken('');
            }}
          >
            {window.desktop && (
              <input
                type="url"
                autoComplete="off"
                placeholder="Server address"
                aria-label="Server address"
                value={server}
                onChange={(e) => setServer(e.target.value)}
              />
            )}
            <input
              type="password"
              autoComplete="off"
              placeholder="Sync token"
              aria-label="Sync token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button type="submit" className="btn">
              <RefreshCw size={14} /> Turn on sync
            </button>
          </form>
        )}
        <p className="dialog-hint">Changes sync about a minute after you make them, and when you come back to the app. If a note was edited on two devices, the newer edit wins.</p>
      </section>

      {installEvent && (
        <section className="settings-section">
          <h3>Install</h3>
          <p>Run Clean Notes in its own window, with or without a connection.</p>
          <div className="settings-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => void installEvent?.prompt().then(() => {
                installEvent = null;
                bump((n) => n + 1);
              })}
            >
              Install app
            </button>
          </div>
        </section>
      )}

      <section className="settings-section">
        <h3>Shortcuts</h3>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
          ))}
        </dl>
      </section>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const setDialog = useStore((s) => s.setDialog);
  const close = () => setDialog(null);
  if (!dialog) return null;
  if (dialog.kind === 'settings') return <Settings close={close} />;
  if (dialog.kind === 'pickNote') return <PickNote dialog={dialog} close={close} />;
  if (dialog.kind === 'prompt') return <Prompt key={dialog.title} dialog={dialog} close={close} />;
  return (
    <Modal title={dialog.title} onClose={close}>
      {dialog.body && <p>{dialog.body}</p>}
      <footer>
        <button type="button" className="btn" onClick={close} autoFocus>Cancel</button>
        <button
          type="button"
          className={dialog.danger ? 'btn danger' : 'btn primary'}
          onClick={() => {
            dialog.onConfirm();
            close();
          }}
        >
          {dialog.confirm}
        </button>
      </footer>
    </Modal>
  );
}

export function ToastHost() {
  const toast = useStore((s) => s.toast);
  const dismiss = useStore((s) => s.dismissToast);
  useEffect(() => {
    if (!toast || toast.sticky) return;
    const t = setTimeout(dismiss, toast.action ? 6000 : 3800);
    return () => clearTimeout(t);
  }, [toast, dismiss]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            dismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
