export const PLATFORM_WINDOW_CLOSED_MESSAGE = "检测到用户已关闭平台窗口，本账号已停止处理";

export class PlatformWindowClosedError extends Error {
  constructor(message = PLATFORM_WINDOW_CLOSED_MESSAGE) {
    super(message);
    this.name = "PlatformWindowClosedError";
    this.code = "PLATFORM_WINDOW_CLOSED";
  }
}

export function isPlatformWindowClosedError(error) {
  if (error?.code === "PLATFORM_WINDOW_CLOSED") return true;
  const message = String(error?.message ?? error ?? "");
  return /target (?:page, context or browser|page|context|browser) has been closed|target closed|browser has been closed|page has been closed|context has been closed/i.test(message);
}

export function normalizePlatformWindowError(error) {
  if (isPlatformWindowClosedError(error)) return new PlatformWindowClosedError();
  return error instanceof Error ? error : new Error(String(error ?? "未知错误"));
}

export function createPlatformWindowCloseGuard(browser, context, delayMs = 50) {
  let disposed = false;
  let settled = false;
  let closeTimer;
  let rejectClosed;
  const pageListeners = new Map();

  const promise = new Promise((_, reject) => {
    rejectClosed = reject;
  });
  // The guard may be disposed after a successful task without ever entering a race.
  void promise.catch(() => {});

  const fail = () => {
    if (disposed || settled) return;
    settled = true;
    rejectClosed(new PlatformWindowClosedError());
  };

  const hasOpenPage = () => {
    try {
      return context.pages().some(page => !page.isClosed());
    } catch {
      return false;
    }
  };

  const verifyWindowClosed = () => {
    if (disposed || settled) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (disposed || settled) return;
      const connected = typeof browser?.isConnected !== "function" || browser.isConnected();
      if (!connected || !hasOpenPage()) fail();
    }, delayMs);
  };

  const watchPage = page => {
    if (!page || pageListeners.has(page)) return;
    const onClose = () => verifyWindowClosed();
    pageListeners.set(page, onClose);
    page.once("close", onClose);
  };

  const onPage = page => watchPage(page);
  const onDisconnected = () => fail();
  for (const page of context.pages()) watchPage(page);
  context.on("page", onPage);
  browser.on("disconnected", onDisconnected);

  return {
    promise,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(closeTimer);
      context.off?.("page", onPage);
      browser.off?.("disconnected", onDisconnected);
      for (const [page, listener] of pageListeners) page.off?.("close", listener);
      pageListeners.clear();
    }
  };
}
