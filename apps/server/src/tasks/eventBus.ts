import { EventEmitter } from 'node:events';
import type { StreamMessage } from '@solar/shared';

/** In-process pub/sub that feeds the server-sent events stream used by the chat UI and the monitor. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(message: StreamMessage): void {
    this.emitter.emit('message', message);
  }

  subscribe(listener: (message: StreamMessage) => void): () => void {
    this.emitter.on('message', listener);
    return () => this.emitter.off('message', listener);
  }
}
