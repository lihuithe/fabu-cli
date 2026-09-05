import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { BINDING_URLS, BINDING_WINDOW, DEFAULT_ACCOUNT_AVATAR, LOGIN_INVALID_MESSAGE, bilibiliProfileFromPayload, chromeCandidates, closeActiveBindingBrowsers, focusLoginArea, hasVisibleLoginPrompt, storedAvatar, storedNickname, trackBindingBrowser } from "../src/account-binding.js";
import { centerPublishWindow, closeActiveBrowsers, trackBrowserWindow } from "../src/runner.js";
import { createPlatformWindowCloseGuard, normalizePlatformWindowError, PLATFORM_WINDOW_CLOSED_MESSAGE } from "../src/platform-window.js";

class FakeBrowser extends EventEmitter {
  constructor() {
    super();
    this.closeCalls = 0;
  }

  async close() {
    this.closeCalls += 1;
    this.emit("disconnected");
  }
}

test("macOS 能找到系统和用户目录中的 Chrome", () => {
  assert.deepEqual(chromeCandidates("darwin", "/Users/tester"), [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Users/tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ]);
});

test("账号绑定窗口足以显示抖音右侧登录区域", () => {
  assert.equal(BINDING_WINDOW.width >= 1200, true);
  assert.equal(BINDING_WINDOW.viewport.width >= 1180, true);
});

test("登录失效提示使用统一短文案", () => {
  assert.equal(LOGIN_INVALID_MESSAGE, "该账号登录失效，请到平台账号页面重新登录");
});

test("自动发布窗口会在页面打开后调整为居中非全屏尺寸", async () => {
  let evaluated = false;
  await centerPublishWindow({
    async evaluate(callback) {
      evaluated = typeof callback === "function";
    }
  });
  assert.equal(evaluated, true);
});

test("视频号绑定从助手首页采集昵称而不是从发布页采集", () => {
  assert.equal(BINDING_URLS.channels, "https://channels.weixin.qq.com");
});

test("历史记录中被备注覆盖的昵称恢复为平台占位昵称", () => {
  assert.equal(storedNickname({ nickname: "小号", remark: "小号" }, "视频号"), "视频号账号");
  assert.equal(storedNickname({ nickname: "真实昵称", remark: "品牌号", nickname_captured: true }, "视频号"), "真实昵称");
});

test("头像缺失时返回统一默认头像", () => {
  assert.equal(storedAvatar({ avatar: "" }), DEFAULT_ACCOUNT_AVATAR);
  assert.equal(storedAvatar({ avatar: "/account-assets/not-found.png" }), DEFAULT_ACCOUNT_AVATAR);
});

test("B站只使用当前登录用户接口返回的昵称和头像", () => {
  assert.deepEqual(bilibiliProfileFromPayload({
    code: 0,
    data: { isLogin: true, uname: "当前用户", face: "https://i0.hdslb.com/bfs/face/current.jpg" }
  }), {
    nickname: "当前用户",
    avatar_source: "https://i0.hdslb.com/bfs/face/current.jpg"
  });
  assert.deepEqual(bilibiliProfileFromPayload({
    code: 0,
    data: { isLogin: true, uname: "无头像用户", face: "https://i0.hdslb.com/bfs/face/member/noface.jpg" }
  }), {
    nickname: "无头像用户",
    avatar_source: ""
  });
  assert.deepEqual(bilibiliProfileFromPayload({ code: 0, data: { isLogin: false } }), { nickname: "", avatar_source: "" });
});

test("抖音登录定位使用稳定文案并滚动到登录卡片", async () => {
  let requestedSelector = "";
  let scrolled = false;
  const page = {
    locator(selector) {
      requestedSelector ||= selector;
      const matched = selector === 'article:has-text("扫码登录")';
      return {
        async count() { return matched ? 1 : 0; },
        nth() {
          return {
            async isVisible() { return true; },
            async scrollIntoViewIfNeeded() { scrolled = true; }
          };
        }
      };
    },
    async waitForTimeout() {}
  };
  assert.equal(await focusLoginArea(page, "douyin", 100), true);
  assert.equal(requestedSelector, 'article:has-text("扫码登录")');
  assert.equal(scrolled, true);
});

test("小红书和B站优先使用当前页面稳定属性定位登录区", async () => {
  for (const [platform, expectedSelector] of [
    ["xiaohongshu", 'input[placeholder="手机号"]'],
    ["bilibili", 'img[alt="Scan me!"]']
  ]) {
    let requestedSelector = "";
    const page = {
      locator(selector) {
        requestedSelector ||= selector;
        const matched = selector === expectedSelector;
        return {
          async count() { return matched ? 1 : 0; },
          nth() {
            return {
              async isVisible() { return true; },
              async scrollIntoViewIfNeeded() {}
            };
          }
        };
      },
      async waitForTimeout() {}
    };
    assert.equal(await focusLoginArea(page, platform, 100), true);
    assert.equal(requestedSelector, expectedSelector);
  }
});

test("发布时可识别四个平台登录页 URL 和视频号 iframe 登录提示", async () => {
  const urlCases = [
    ["douyin", "https://creator.douyin.com/login?redirect=/creator-micro/content/upload"],
    ["xiaohongshu", "https://creator.xiaohongshu.com/new/login?redirect=/publish/publish"],
    ["channels", "https://channels.weixin.qq.com/login.html"],
    ["bilibili", "https://passport.bilibili.com/login"]
  ];
  for (const [platform, url] of urlCases) {
    const page = { isClosed: () => false, frames: () => [{ url: () => url }] };
    assert.equal(await hasVisibleLoginPrompt(page, platform), true);
  }

  const emptyLocator = () => ({ async count() { return 0; }, nth() { throw new Error("不存在"); } });
  const loginLocator = selector => ({
    async count() { return selector === 'text="微信扫码登录"' ? 1 : 0; },
    nth() { return { async isVisible() { return true; } }; }
  });
  const channelsPage = {
    isClosed: () => false,
    frames: () => [
      { url: () => "https://channels.weixin.qq.com/platform/post/create", locator: emptyLocator },
      { url: () => "about:blank", locator: loginLocator }
    ]
  };
  assert.equal(await hasVisibleLoginPrompt(channelsPage, "channels"), true);
});

test("用户关闭发布窗口后会释放对应 Chrome 进程", async () => {
  const browser = new FakeBrowser();
  const page = new EventEmitter();
  trackBrowserWindow(browser, page);
  page.emit("close");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(browser.closeCalls, 1);
});

test("平台窗口关闭底层异常会转换为用户可理解的提示", () => {
  const error = normalizePlatformWindowError(new Error("page.waitForTimeout: Target page, context or browser has been closed"));
  assert.equal(error.code, "PLATFORM_WINDOW_CLOSED");
  assert.equal(error.message, PLATFORM_WINDOW_CLOSED_MESSAGE);
});

test("图文发布窗口关闭后会立即终止当前任务", async () => {
  const browser = new EventEmitter();
  browser.isConnected = () => true;
  const context = new EventEmitter();
  const page = new EventEmitter();
  let closed = false;
  page.isClosed = () => closed;
  context.pages = () => closed ? [] : [page];
  const guard = createPlatformWindowCloseGuard(browser, context, 0);

  closed = true;
  page.emit("close");
  await assert.rejects(guard.promise, error => {
    assert.equal(error.code, "PLATFORM_WINDOW_CLOSED");
    assert.equal(error.message, PLATFORM_WINDOW_CLOSED_MESSAGE);
    return true;
  });
  guard.dispose();
});

test("平台正常新开页面时不会误判为用户关闭窗口", async () => {
  const browser = new EventEmitter();
  browser.isConnected = () => true;
  const context = new EventEmitter();
  const firstPage = new EventEmitter();
  const secondPage = new EventEmitter();
  let firstClosed = false;
  let secondClosed = false;
  firstPage.isClosed = () => firstClosed;
  secondPage.isClosed = () => secondClosed;
  context.pages = () => [firstPage, secondPage].filter(page => !page.isClosed());
  const guard = createPlatformWindowCloseGuard(browser, context, 0);
  context.emit("page", secondPage);

  firstClosed = true;
  firstPage.emit("close");
  const outcome = await Promise.race([
    guard.promise.then(() => "closed", () => "closed"),
    new Promise(resolve => setTimeout(() => resolve("open"), 20))
  ]);
  assert.equal(outcome, "open");

  secondClosed = true;
  secondPage.emit("close");
  await assert.rejects(guard.promise, error => error.code === "PLATFORM_WINDOW_CLOSED");
  guard.dispose();
});

test("程序退出时会关闭仍在运行的全部 Chrome 进程", async () => {
  const first = new FakeBrowser();
  const second = new FakeBrowser();
  trackBrowserWindow(first, new EventEmitter());
  trackBrowserWindow(second, new EventEmitter());
  await closeActiveBrowsers();
  assert.equal(first.closeCalls, 1);
  assert.equal(second.closeCalls, 1);
});

test("程序退出时也会关闭仍在等待扫码的账号绑定窗口", async () => {
  const browser = new FakeBrowser();
  trackBindingBrowser(browser);
  await closeActiveBindingBrowsers();
  assert.equal(browser.closeCalls, 1);
});
