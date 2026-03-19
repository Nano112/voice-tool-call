/**
 * Minimal typed EventEmitter for the browser. Zero dependencies.
 */
export class TypedEventEmitter<TEventMap extends Record<string, any>> {
  private listeners = new Map<string, Set<(data: any) => void>>();

  on<K extends keyof TEventMap & string>(
    event: K,
    listener: (data: TEventMap[K]) => void
  ): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off<K extends keyof TEventMap & string>(
    event: K,
    listener: (data: TEventMap[K]) => void
  ): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  once<K extends keyof TEventMap & string>(
    event: K,
    listener: (data: TEventMap[K]) => void
  ): this {
    const wrapped = (data: TEventMap[K]) => {
      this.off(event, wrapped);
      listener(data);
    };
    return this.on(event, wrapped);
  }

  protected emit<K extends keyof TEventMap & string>(
    event: K,
    data: TEventMap[K]
  ): boolean {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const fn of set) fn(data);
    return true;
  }

  removeAllListeners(event?: keyof TEventMap & string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}
