export default class InterProcessCommunicationAdapter {
  constructor() {
    this.listeners = new Map();
  }

  listen(channel, handler) {
    if (!channel || typeof handler !== "function") {
      return;
    }
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel).add(handler);
  }

  async emit(channel, payload) {
    const handlers = this.listeners.get(channel);
    if (!handlers || handlers.size === 0) {
      return [];
    }
    const results = [];
    for (const handler of handlers) {
      try {
        // eslint-disable-next-line no-await-in-loop
        results.push(await handler(payload));
      } catch (error) {
        console.warn(`[HK] IPC handler for ${channel} failed`, error);
      }
    }
    return results;
  }
}
