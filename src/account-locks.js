import { AppError } from './errors.js';

export class AccountLocks {
  constructor() { this.owners = new Map(); }
  busy(key) { return this.owners.has(key); }
  acquire(key, owner) {
    if (this.busy(key)) throw new AppError('ACCOUNT_BUSY', '此账号正在执行任务或保留待检查的窗口，请先完成操作或关闭对应任务窗口', { status: 409, retryable: true, details: { owner: this.owners.get(key) } });
    this.owners.set(key, owner);
    return () => { if (this.owners.get(key) === owner) { this.owners.delete(key); this.onRelease?.(); } };
  }
}
