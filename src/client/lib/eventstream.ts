/**
 * `application/vnd.amazon.eventstream` frame decoder — panel only.
 *
 * InvokeHarness answers in AWS's binary event-stream framing, so decoding the
 * socket as UTF-8 yields readable JSON surrounded by garbage: the length
 * prefixes render as control chars and the two CRC32 fields as replacement
 * chars. This walks the actual frame layout instead.
 *
 *   uint32  total length   (whole frame, including both CRCs)
 *   uint32  headers length
 *   uint32  prelude CRC32
 *   bytes   headers        (repeated: u8 name len, name, u8 type, value)
 *   bytes   payload        (total - headers - 16)
 *   uint32  message CRC32
 *
 * CRCs are not verified — we are reading, not validating.
 *
 * The chat transport does NOT use this: `readAwsEventStream` keeps its own
 * regex scan so streaming behaviour is untouched. This runs alongside, purely
 * to give the debug panel real frames.
 */

export interface EventStreamFrame {
  headers: Record<string, string | number | boolean | null>;
  /** Payload decoded as UTF-8 (these payloads are always JSON in practice). */
  payload: string;
  byteLength: number;
}

/** Sanity bound — a bad length prefix must not make us wait forever. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

const HEADER_TYPE = {
  boolTrue: 0,
  boolFalse: 1,
  byte: 2,
  short: 3,
  integer: 4,
  long: 5,
  byteArray: 6,
  string: 7,
  timestamp: 8,
  uuid: 9,
} as const;

/**
 * Incremental decoder: feed it every chunk, it returns whatever frames are now
 * complete and keeps the partial tail for next time.
 */
export class EventStreamDecoder {
  private buffer = new Uint8Array(0);
  private readonly text = new TextDecoder('utf-8');
  /** Set once the byte layout stops making sense — we then stop guessing. */
  desynced = false;

  push(chunk: Uint8Array): EventStreamFrame[] {
    if (this.desynced) return [];

    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const frames: EventStreamFrame[] = [];
    while (this.buffer.length >= 16) {
      const view = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset,
        this.buffer.byteLength
      );
      const total = view.getUint32(0, false);
      const headersLength = view.getUint32(4, false);

      if (total < 16 || total > MAX_FRAME_BYTES || headersLength > total - 16) {
        this.desynced = true;
        return frames;
      }
      if (this.buffer.length < total) break; // frame still arriving

      try {
        frames.push(this.readFrame(view, headersLength, total));
      } catch {
        this.desynced = true;
        return frames;
      }
      this.buffer = this.buffer.subarray(total);
    }

    return frames;
  }

  private readFrame(view: DataView, headersLength: number, total: number): EventStreamFrame {
    const headers = this.readHeaders(view, 12, 12 + headersLength);
    const payloadStart = 12 + headersLength;
    const payloadEnd = total - 4;
    const payload = this.text.decode(
      new Uint8Array(view.buffer, view.byteOffset + payloadStart, payloadEnd - payloadStart)
    );
    return { headers, payload, byteLength: total };
  }

  private readHeaders(
    view: DataView,
    start: number,
    end: number
  ): Record<string, string | number | boolean | null> {
    const out: Record<string, string | number | boolean | null> = {};
    let i = start;

    while (i < end) {
      const nameLength = view.getUint8(i);
      i += 1;
      const name = this.text.decode(new Uint8Array(view.buffer, view.byteOffset + i, nameLength));
      i += nameLength;
      const type = view.getUint8(i);
      i += 1;

      switch (type) {
        case HEADER_TYPE.boolTrue:
          out[name] = true;
          break;
        case HEADER_TYPE.boolFalse:
          out[name] = false;
          break;
        case HEADER_TYPE.byte:
          out[name] = view.getInt8(i);
          i += 1;
          break;
        case HEADER_TYPE.short:
          out[name] = view.getInt16(i, false);
          i += 2;
          break;
        case HEADER_TYPE.integer:
          out[name] = view.getInt32(i, false);
          i += 4;
          break;
        case HEADER_TYPE.long:
        case HEADER_TYPE.timestamp:
          out[name] = Number(view.getBigInt64(i, false));
          i += 8;
          break;
        case HEADER_TYPE.byteArray:
        case HEADER_TYPE.string: {
          const len = view.getUint16(i, false);
          i += 2;
          out[name] = this.text.decode(new Uint8Array(view.buffer, view.byteOffset + i, len));
          i += len;
          break;
        }
        case HEADER_TYPE.uuid: {
          const bytes = new Uint8Array(view.buffer, view.byteOffset + i, 16);
          out[name] = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
          i += 16;
          break;
        }
        default:
          throw new Error(`unknown header type ${type}`);
      }
    }

    return out;
  }
}

/** `:event-type` if present — that is the frame's real name. */
export function frameLabel(frame: EventStreamFrame): string {
  const eventType = frame.headers[':event-type'];
  const messageType = frame.headers[':message-type'];
  if (typeof eventType === 'string') return eventType;
  if (typeof messageType === 'string') return messageType;
  return 'frame';
}

/** Pretty-print the payload when it is JSON, else hand it back untouched. */
export function framePayloadText(frame: EventStreamFrame): string {
  const trimmed = frame.payload.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return frame.payload;
  }
}
