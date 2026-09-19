'use client';

/**
 * Raw transport inspector.
 *
 * Shows everything `src/client/lib/stream.ts` sees on the wire — request target,
 * token claims, every response header, every decoded event-stream frame and
 * every parsed delta. Read-only and in-memory: closing the tab loses it, nothing
 * is stored or sent anywhere.
 *
 * Capture is lossless; the folding below is purely a view. A response arrives as
 * dozens of socket reads and dozens of frames, so by default rows of the same
 * kind within one turn collapse into a single expandable row. Turn "fold" off
 * for the strict chronological list.
 *
 * The chat itself is untouched; this only reads the capture bus.
 */

import { useMemo, useRef, useState, useSyncExternalStore, useEffect } from 'react';
import {
  debugClear,
  debugServerSnapshot,
  debugSnapshot,
  debugSubscribe,
  type DebugEntry,
  type DebugKind,
} from '../lib/debug-bus';
import styles from '../styles/debugpanel.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const KINDS: DebugKind[] = [
  'invoke',
  'request',
  'response',
  'chunk',
  'frame',
  'delta',
  'event',
  'error',
  'done',
  'info',
];

/** Kinds that are worth seeing opened — the noisy ones stay folded. */
const OPEN_BY_DEFAULT = new Set<DebugKind>(['invoke', 'request', 'response', 'error']);

/**
 * Kinds that repeat many times per turn. A socket read boundary (`chunk`) is
 * arbitrary and a long run of `contentBlockDelta` frames is just the model
 * streaming, so these fold; anything else stays one row per event.
 */
const FOLDABLE = new Set<DebugKind>(['chunk', 'frame', 'delta']);

/**
 * Binary framing decoded as text gives control bytes (the length prefixes) and
 * U+FFFD (the CRC32 fields, which are not valid UTF-8). Both collapse to a dot
 * so a raw dump stays readable; the hex view and the decoded frame rows carry
 * the data you actually want.
 */
function printable(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    const isControl = code < 32 && code !== 10 && code !== 9;
    const isC1 = code >= 127 && code <= 159;
    out += isControl || isC1 || code === 0xfffd ? '·' : ch;
  }
  return out;
}

/** Frames fold per event-type, so `contentBlockDelta` never swallows `metadata`. */
function foldKey(entry: DebugEntry): string {
  return `${entry.run}|${entry.kind}|${entry.kind === 'frame' ? entry.label : ''}`;
}

/**
 * Fold by key within a turn, keeping first-appearance order. Deliberately not
 * "consecutive only": the transport interleaves chunk/frame/delta, so adjacency
 * folding would leave dozens of two-row groups. Each member keeps its own
 * timestamp, so the ordering stays visible inside the group.
 */
function foldEntries(entries: DebugEntry[], enabled: boolean): DebugEntry[][] {
  if (!enabled) return entries.map((e) => [e]);

  const groups: DebugEntry[][] = [];
  const index = new Map<string, DebugEntry[]>();

  for (const entry of entries) {
    if (!FOLDABLE.has(entry.kind)) {
      groups.push([entry]);
      continue;
    }
    const key = foldKey(entry);
    const existing = index.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      const group = [entry];
      index.set(key, group);
      groups.push(group);
    }
  }

  return groups;
}

function Body({ entry }: { entry: DebugEntry }) {
  return (
    <>
      {entry.detail !== undefined && (
        <pre className={styles.pre}>{JSON.stringify(entry.detail, null, 2)}</pre>
      )}
      {entry.text !== undefined && entry.text !== '' && (
        <pre className={styles.pre}>{printable(entry.text)}</pre>
      )}
      {entry.hex && (
        <>
          <div className={styles.subLabel}>hex</div>
          <pre className={`${styles.pre} ${styles.hex}`}>{entry.hex}</pre>
        </>
      )}
    </>
  );
}

function Row({ entry, defaultOpen }: { entry: DebugEntry; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasBody = Boolean(entry.text || entry.detail !== undefined || entry.hex);

  return (
    <div className={`${styles.row} ${styles[entry.kind] ?? ''}`}>
      <button
        className={styles.rowHead}
        onClick={() => setOpen((v) => !v)}
        disabled={!hasBody}
        type="button"
      >
        <span className={styles.dt}>+{entry.dt}ms</span>
        <span className={styles.kind}>{entry.kind}</span>
        <span className={styles.label}>{entry.label}</span>
        {entry.bytes !== undefined && <span className={styles.bytes}>{entry.bytes} B</span>}
        {hasBody && <span className={styles.caret}>{open ? '−' : '+'}</span>}
      </button>

      {open && hasBody && (
        <div className={styles.body}>
          <Body entry={entry} />
        </div>
      )}
    </div>
  );
}

/** A folded run: headline numbers, the joined text, then the arrival timeline. */
function GroupRow({ entries }: { entries: DebugEntry[] }) {
  const [open, setOpen] = useState(false);
  const first = entries[0];
  const last = entries[entries.length - 1];
  const totalBytes = entries.reduce((sum, e) => sum + (e.bytes ?? 0), 0);

  // Joined because that is what the run *means*: the reassembled text, or the
  // payloads back to back. Each part keeps its own timing in the list below.
  const joined = entries
    .map((e) => e.text ?? '')
    .filter(Boolean)
    .join(first.kind === 'delta' ? '' : '\n');

  const label = first.kind === 'frame' ? first.label : first.kind;

  return (
    <div className={`${styles.row} ${styles[first.kind] ?? ''}`}>
      <button className={styles.rowHead} onClick={() => setOpen((v) => !v)} type="button">
        <span className={styles.dt}>
          +{first.dt}
          <span className={styles.range}>–{last.dt}</span>ms
        </span>
        <span className={styles.kind}>{first.kind}</span>
        <span className={styles.label}>
          <span className={styles.multiplier}>{entries.length}×</span> {label}
        </span>
        {totalBytes > 0 && <span className={styles.bytes}>{totalBytes} B</span>}
        <span className={styles.caret}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className={styles.body}>
          {joined && <pre className={styles.pre}>{printable(joined)}</pre>}

          <div className={styles.subLabel}>timeline</div>
          <pre className={`${styles.pre} ${styles.hex}`}>
            {entries.map((e) => `+${String(e.dt).padStart(6)}ms  ${e.bytes ?? 0} B`).join('\n')}
          </pre>

          {first.hex && (
            <>
              <div className={styles.subLabel}>hex · first only</div>
              <pre className={`${styles.pre} ${styles.hex}`}>{first.hex}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function DebugPanel({ open, onClose }: Props) {
  const entries = useSyncExternalStore(debugSubscribe, debugSnapshot, debugServerSnapshot);
  const [query, setQuery] = useState('');
  const [muted, setMuted] = useState<Set<DebugKind>>(new Set());
  const [follow, setFollow] = useState(true);
  const [fold, setFold] = useState(true);
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (muted.has(e.kind)) return false;
      if (!q) return true;
      const hay = `${e.kind} ${e.label} ${e.text ?? ''} ${
        e.detail === undefined ? '' : JSON.stringify(e.detail)
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, muted]);

  const groups = useMemo(() => foldEntries(visible, fold), [visible, fold]);

  useEffect(() => {
    if (open && follow) endRef.current?.scrollIntoView({ block: 'end' });
  }, [visible.length, open, follow]);

  if (!open) return null;

  const toggleKind = (kind: DebugKind) =>
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const copyAll = async () => {
    try {
      // Always the unfolded entries — folding is for reading, not for export.
      await navigator.clipboard.writeText(JSON.stringify(visible, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked in the portal iframe — the panel text is selectable */
    }
  };

  let lastRun = -1;

  return (
    <aside className={styles.panel} aria-label="Transport debug">
      <header className={styles.head}>
        <span className={styles.title}>Wire capture</span>
        <span className={styles.count}>
          {visible.length}
          {visible.length !== entries.length && ` / ${entries.length}`}
        </span>
        <button className={styles.headBtn} onClick={copyAll} type="button">
          {copied ? 'copied' : 'copy'}
        </button>
        <button className={styles.headBtn} onClick={debugClear} type="button">
          clear
        </button>
        <button className={styles.headBtn} onClick={onClose} type="button" aria-label="Close">
          ✕
        </button>
      </header>

      <div className={styles.controls}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter — usage, metadata, token, x-amzn…"
          spellCheck={false}
        />
        <label className={styles.follow}>
          <input type="checkbox" checked={fold} onChange={(e) => setFold(e.target.checked)} />
          fold
        </label>
        <label className={styles.follow}>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          follow
        </label>
      </div>

      <div className={styles.chips}>
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`${styles.chip} ${muted.has(kind) ? styles.chipOff : ''}`}
            onClick={() => toggleKind(kind)}
          >
            {kind}
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {groups.length === 0 && (
          <p className={styles.empty}>
            Nothing captured yet. Send a message — every byte of the response lands here.
          </p>
        )}
        {groups.map((group) => {
          const head = group[0];
          const newRun = head.run !== lastRun;
          lastRun = head.run;
          return (
            <div key={head.id}>
              {newRun && <div className={styles.runSep}>turn {head.run}</div>}
              {group.length === 1 ? (
                <Row entry={head} defaultOpen={OPEN_BY_DEFAULT.has(head.kind)} />
              ) : (
                <GroupRow entries={group} />
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </aside>
  );
}
