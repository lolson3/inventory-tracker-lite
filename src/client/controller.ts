import type { Command, Operation, State } from '../server/model.js';
import { randomUuid } from './utils/uuid.js';
export class Controller {
  state: State = { revision: 0, inventory: [], itemTypes: [] };
  ready = false;
  busy = false;
  pending: Command | null = null;
  message = 'Loading inventory…';
  constructor(
    private changed: () => void,
    private request: typeof fetch = fetch,
    private uuid = randomUuid,
  ) {}
  private async api(path: string, command?: Command): Promise<State> {
    const response = await this.request.call(globalThis, path, {
      method: command ? 'POST' : 'GET',
      headers: {
        ...(command ? { 'Content-Type': 'application/json' } : {}),
      },
      body: command ? JSON.stringify(command) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = new Error(
        (await response.json()).error ?? 'Request failed',
      ) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    return response.json() as Promise<State>;
  }
  async load() {
    if (this.busy || this.pending) return;
    this.ready = false;
    this.busy = true;
    this.message = 'Loading inventory…';
    this.changed();
    try {
      this.state = await this.api('/api/data');
      this.ready = true;
      this.message = '';
    } catch (error) {
      this.message = `${(error as Error).message}. Refresh the page to try again.`;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async execute(operation: Operation) {
    if (!this.ready || this.busy || this.pending) return;
    this.pending = {
      requestId: this.uuid(),
      revision: this.state.revision,
      operation,
    };
    await this.retry();
  }
  async retry() {
    if (!this.pending || this.busy) return;
    this.busy = true;
    this.message = 'Saving…';
    this.changed();
    try {
      this.state = await this.api('/api/operations', this.pending);
      this.pending = null;
      this.message = 'Saved.';
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      this.message = `Save failed: ${(error as Error).message}`;
      if (status && [400, 404, 409, 413, 415].includes(status)) {
        const wasBatch = this.pending?.operation.kind === 'batch';
        this.pending = null;
        if (wasBatch) {
          this.message += ' Review the scans and try again.';
          return;
        }
        this.ready = false;
        this.message +=
          ' Your input remains visible. Note your change, then refresh the page and review before trying again.';
      } else
        this.message +=
          ' Use Retry save; the same change will not be applied twice.';
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}
