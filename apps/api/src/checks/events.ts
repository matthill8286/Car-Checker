import { EventEmitter } from 'node:events';
import type { CheckEvent } from '@carcheck/core';

/** Fans out progress for running checks to SSE subscribers in this process. */
export class CheckEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(checkId: string, event: CheckEvent): void {
    this.emitter.emit(checkId, event);
  }

  subscribe(checkId: string, listener: (event: CheckEvent) => void): () => void {
    this.emitter.on(checkId, listener);
    return () => this.emitter.off(checkId, listener);
  }
}
