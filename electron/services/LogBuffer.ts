import { EventEmitter } from 'events';

interface LogEntry {
  runId: string;
  source?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  raw?: string;
}

interface LogBufferOptions {
  maxSize?: number;
  flushInterval?: number;
  maxLines?: number;
}

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;
const DEFAULT_FLUSH_INTERVAL = 10;
const DEFAULT_MAX_LINES = 100;

export class LogBuffer {
  private buffer: (LogEntry | null)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private capacity: number;
  private maxSize: number;
  private flushInterval: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private size = 0;
  private emitter: EventEmitter;
  private paused = false;

  constructor(options: LogBufferOptions = {}) {
    this.capacity = options.maxLines ?? DEFAULT_MAX_LINES;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.buffer = new Array(this.capacity).fill(null);
    this.emitter = new EventEmitter();
    this.startFlushTimer();
  }

  push(entry: LogEntry): void {
    if (this.paused) return;

    const entrySize = JSON.stringify(entry).length;

    if (this.size + entrySize > this.maxSize) {
      const dropped = this.count;
      this.emitter.emit('overflow', { dropped, reason: 'max-size-exceeded' });
      this.buffer.fill(null);
      this.head = 0;
      this.tail = 0;
      this.count = 0;
      this.size = 0;
    }

    this.buffer[this.tail] = entry;
    this.tail = (this.tail + 1) % this.capacity;
    this.size += entrySize;

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }

    if (this.count >= this.capacity) {
      this.flush();
    }
  }

  async flush(): Promise<LogEntry[]> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const entries: LogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) entries.push(entry);
    }

    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.size = 0;

    if (entries.length > 0) {
      this.emitter.emit('flush', entries);
    }

    this.startFlushTimer();
    return entries;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  getBuffer(): LogEntry[] {
    const result: LogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry) result.push(entry);
    }
    return result;
  }

  clear(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.size = 0;
  }

  onFlush(handler: (entries: LogEntry[]) => void): void {
    this.emitter.on('flush', handler);
  }

  onOverflow(handler: (info: { dropped: number; reason: string }) => void): void {
    this.emitter.on('overflow', handler);
  }

  private startFlushTimer(): void {
    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.flushInterval);
  }
}
