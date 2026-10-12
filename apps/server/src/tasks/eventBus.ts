import { EventEmitter } from 'node:events';
import type { Permission, StreamMessage } from '@solar/shared';

/**
 * Who may receive a message of the event stream:
 * - `task`: a task's own messages (task, event, delta) - its owner, and roles that see every task (`tasks.all`).
 *   `ownerId` null = a task from before user accounts existed (only `tasks.all`).
 * - `permission`: users whose role has the permission (e.g. `users_changed` for `users.view`).
 * Without a scope a message is for everyone logged in (e.g. plugin statuses).
 */
export type MessageScope = { kind: 'task'; ownerId: string | null } | { kind: 'permission'; permission: Permission };

export type BusListener = (message: StreamMessage, scope: MessageScope | undefined) => void;

/** In-process pub/sub that feeds the server-sent events stream used by the chat UI and the monitor. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(message: StreamMessage, scope?: MessageScope): void {
    this.emitter.emit('message', message, scope);
  }

  subscribe(listener: BusListener): () => void {
    this.emitter.on('message', listener);
    return () => this.emitter.off('message', listener);
  }
}
