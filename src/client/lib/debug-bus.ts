/**
 * In-memory capture bus for the debug panel.
 *
 * Everything the chat transport sees on the wire is pushed here verbatim:
 * request target + headers, response status + every response header, each raw
 * byte chunk of the AgentCore event-stream, each extracted delta, and the end
 * state. The panel renders it; nothing is persisted, logged or sent anywhere.
 *
 * Capture is always on (cheap: push + swap a reference) so the panel can be
 * opened *after* a bad turn and still show what happened.
 */

export type DebugKind =
  | 'invoke' // start of a turn — separates runs in the panel
  | 'request'
  | 'response'
  | 'chunk' // raw bytes off the socket
  | 'delta' // text we managed to parse out of a chunk
  | 'event' // anything else we recognised in the stream
  | 'error'
  | 'done'
  | 'info';

export interface DebugEntry {
  id: number;
  /** Turn counter — every streamChat() call bumps it. */
  run: number;
  /** epoch ms */
  t: number;
  /** ms since the start of this run */
  dt: number;
  kind: DebugKind;
  label: string;
  /** Structured payload, rendered as pretty JSON. */
  detail?: unknown;
  /** Verbatim text (raw chunk, parsed delta, error body). Never truncated here. */
  text?: string;
  /** Hex preview of the first bytes — event-stream framing is binary. */
  hex?: string;
  bytes?: number;
}

/** Ring cap: the panel is a debugger, not a log store. */
const MAX_ENTRIES = 3000;

let entries: DebugEntry[] = [];
let nextId = 1;
let run = 0;
let runStart = Date.now();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Start a new turn. Returns the run number so callers can tag out-of-band emits. */
export function debugNewRun(): number {
  run += 1;
  runStart = Date.now();
  return run;
}

export function debugEmit(
  kind: DebugKind,
  label: string,
  extra?: Omit<DebugEntry, 'id' | 'run' | 't' | 'dt' | 'kind' | 'label'>
): void {
  const t = Date.now();
  const entry: DebugEntry = { id: nextId++, run, t, dt: t - runStart, kind, label, ...extra };
  const next = entries.concat(entry);
  entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  notify();
}

export function debugClear(): void {
  entries = [];
  notify();
}

/** Stable reference between emits — safe for useSyncExternalStore. */
export function debugSnapshot(): DebugEntry[] {
  return entries;
}

const EMPTY: DebugEntry[] = [];
export function debugServerSnapshot(): DebugEntry[] {
  return EMPTY;
}

export function debugSubscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** First `max` bytes as hex — the only way to read event-stream frame headers. */
export function bytesToHex(bytes: Uint8Array, max = 192): string {
  const slice = bytes.subarray(0, max);
  let out = '';
  for (let i = 0; i < slice.length; i++) {
    out += slice[i].toString(16).padStart(2, '0');
    out += (i + 1) % 16 === 0 ? '\n' : ' ';
  }
  return bytes.length > max ? `${out.trimEnd()} … (+${bytes.length - max} bytes)` : out.trimEnd();
}

/** All response headers, including the x-amzn-* ids needed to match a trace. */
export function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * JWT claims for the panel. The signed token itself is never shown in full —
 * claims are what you debug with, the raw string is just a credential.
 */
export function describeToken(token: string | null): Record<string, unknown> {
  if (!token) return { present: false };
  const parts = token.split('.');
  const shape = {
    present: true,
    length: token.length,
    preview: `${token.slice(0, 8)}…${token.slice(-6)}`,
    segments: parts.length,
  };
  try {
    const payload = JSON.parse(
      atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))
    ) as Record<string, unknown>;
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
    return {
      ...shape,
      claims: payload,
      expiresInSeconds: exp ? exp - Math.floor(Date.now() / 1000) : undefined,
    };
  } catch {
    return { ...shape, claims: '<unparseable>' };
  }
}
