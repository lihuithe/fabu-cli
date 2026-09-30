import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { bindingManager, chromePath, hasVisibleLoginPrompt, LOGIN_INVALID_MESSAGE } from "./account-binding.js";
import { appendTopics, dismissKuaishouPublishGuide, fillFirst, safeClick, setChannelsLocationHidden, setChannelsOriginalIfAvailable, setRights, visibleFirst, visibleUploadError } from "./browser-utils.js";
import { centerPublishWindow, fillChannelsShortTitle } from "./runner.js";
import { channelsImageTextContent, IMAGE_TEXT_PLATFORMS, kuaishouImageTextContent } from "./image-text-platforms.js";
import { createPlatformWindowCloseGuard, normalizePlatformWindowError } from "./platform-window.js";
import { setScheduledPublish } from "./schedule-publish.js";

class ImageTextLoginExpiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImageTextLoginExpiredError";
    this.code = "LOGIN_EXPIRED";
  }
}

async function closeBrowser(browser) {
  if (browser?.isConnected()) await browser.close().catch(() => {});
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function trackImageTextWindow(browser, page, log = () => {}) {
  page.once("close", () => {
    log("Chrome 页面已关闭，正在确认是否为平台页面切换");
    setTimeout(() => {
      if (!browser?.isConnected()) return;
      const hasOpenPage = browser.contexts().some(context => context.pages().some(candidate => !candidate.isClosed()));
      if (!hasOpenPage) void closeBrowser(browser);
    }, 3_000);
  });
}

async function visibleModeControl(page, platform, timeoutMs = 12_000) {
  const onScreen = async locator => {
    try {
      return await locator.evaluate(element => {
        if (element.closest('[aria-hidden="true"]')) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
      });
    } catch { return false; }
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const text of platform.modeTexts) {
      try {
        const candidates = page.getByText(text, { exact: true });
        for (let index = 0; index < Math.min(await candidates.count(), 12); index += 1) {
          const candidate = candidates.nth(index);
          if (!(await candidate.isVisible({ timeout: 80 })) || !(await onScreen(candidate))) continue;
          const clickable = candidate.locator('xpath=ancestor-or-self::*[self::button or self::a or @role="tab" or contains(@class,"tab")][1]');
          if (await clickable.count() && await onScreen(clickable.first())) return clickable.first();
          return candidate;
        }
      } catch {}
    }
    for (const selector of platform.modeSelectors) {
      try {
        const candidates = page.locator(selector);
        for (let index = 0; index < Math.min(await candidates.count(), 12); index += 1) {
          const candidate = candidates.nth(index);
          if (await candidate.isVisible({ timeout: 80 }) && await onScreen(candidate)) return candidate;
        }
      } catch {}
    }
    await delay(180);
  }
  return null;
}

async function imageTextModeState(page, platform) {
  if (!platform.activeModeSelectors?.length) return null;
  for (const selector of platform.activeModeSelectors) {
    try {
      const candidates = page.locator(selector);
      for (let index = 0; index < Math.min(await candidates.count(), 8); index += 1) {
        if (await candidates.nth(index).isVisible({ timeout: 80 })) return true;
      }
    } catch {}
  }
  return false;
}

async function findImageInputOnce(page, platform) {
  for (const selector of platform.imageInputs) {
    try {
      const inputs = page.locator(selector);
      for (let index = 0; index < Math.min(await inputs.count(), 12); index += 1) {
        const input = inputs.nth(index);
        const accept = String(await input.getAttribute("accept") ?? "").toLowerCase();
        if (accept && !accept.includes("image") && !accept.includes(".jpg") && !accept.includes(".jpeg") && !accept.includes(".png") && !accept.includes(".webp")) continue;
        return input;
      }
    } catch {}
  }
  return null;
}

export async function findImageInput(page, platform, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const input = await findImageInputOnce(page, platform);
    if (input) return input;
    await delay(220);
  }
  return null;
}

async function findConfirmedImageInput(page, platform) {
  const modeState = await imageTextModeState(page, platform);
  if (modeState === false) return null;
  return findImageInputOnce(page, platform);
}

const CHANNELS_CONTENT_ROOT = 'li.finder-ui-desktop-menu__item.finder-ui-desktop-menu__sub__wrp:has(> a.finder-ui-desktop-menu__sub__link .finder-ui-desktop-menu__name span:text-is("内容管理"))';

async function exactChannelsImageLink(root, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const links = root
      .locator('> ul.finder-ui-desktop-sub-menu > li.finder-ui-desktop-sub-menu__item > a.finder-ui-desktop-menu__link')
      .filter({ hasText: /^\s*图文\s*$/ });
    for (let index = 0; index < Math.min(await links.count(), 6); index += 1) {
      const link = links.nth(index);
      if ((await link.innerText({ timeout: 100 }).catch(() => "")).trim() === "图文") return link;
    }
    await delay(160);
  }
  return null;
}

async function waitChannelsImageRoute(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = page.url().toLowerCase();
    if (current.includes("/platform/post/findernewlifepostlist") || current.includes("/platform/post/findernewlifecreate")) return true;
    const createButton = page.getByRole("button", { name: "发表图文", exact: true }).first();
    if (await createButton.isVisible().catch(() => false)) return true;
    await delay(150);
  }
  return false;
}

async function waitChannelsImageInput(page, platform, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return null;
    const input = await findImageInputOnce(page, platform);
    if (input) {
      const accept = String(await input.getAttribute("accept") ?? "").toLowerCase();
      if (accept.includes("image") || accept.includes(".jpg") || accept.includes(".jpeg") || accept.includes(".png") || accept.includes(".webp")) return input;
    }
    await delay(180);
  }
  return null;
}

async function openChannelsImageTextMode(page, platform) {
  const url = () => page.url().toLowerCase();
  if (url().includes("/platform/post/findernewlifecreate")) {
    return waitChannelsImageInput(page, platform, 25_000);
  }

  let imageAreaActive = await imageTextModeState(page, platform) === true;
  if (!url().includes("/platform/post/findernewlifepostlist") && !imageAreaActive) {
    const root = page.locator(CHANNELS_CONTENT_ROOT).first();
    const contentLink = root.locator('> a.finder-ui-desktop-menu__sub__link').first();
    if (!(await contentLink.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false))) return null;

    await safeClick(contentLink, "展开视频号内容管理菜单", { timeout: 5_000 }).catch(() => {});
    const imageLink = await exactChannelsImageLink(root);
    if (!imageLink) return null;
    if (await imageLink.isVisible({ timeout: 100 }).catch(() => false)) {
      await safeClick(imageLink, "进入视频号图文管理", { timeout: 5_000 });
    } else {
      await imageLink.evaluate(element => element.click());
    }
    if (!(await waitChannelsImageRoute(page))) {
      await page.goto("https://channels.weixin.qq.com/platform/post/finderNewLifePostList", { waitUntil: "commit", timeout: 30_000 });
      if (!(await waitChannelsImageRoute(page, 8_000))) return null;
    }
    imageAreaActive = true;
  }

  const createDeadline = Date.now() + 20_000;
  let createClicked = false;
  while (Date.now() < createDeadline) {
    if (page.isClosed()) return null;
    if (url().includes("/platform/post/findernewlifecreate")) {
      return waitChannelsImageInput(page, platform, Math.max(1, createDeadline - Date.now()));
    }
    const input = imageAreaActive ? await waitChannelsImageInput(page, platform, 250) : null;
    if (input) return input;
    if (!createClicked) {
      const createButton = page.getByRole("button", { name: "发表图文", exact: true }).first();
      if (await createButton.isVisible({ timeout: 100 }).catch(() => false)) {
        await safeClick(createButton, "进入视频号图文上传页面", { timeout: 5_000 });
        createClicked = true;
      }
    }
    await delay(180);
  }
  return null;
}

export async function openImageTextMode(page, platform) {
  if (platform.key === "channels") return openChannelsImageTextMode(page, platform);
  const context = page.context();
  const deadline = Date.now() + 35_000;
  let lastSwitchAttemptAt = 0;
  while (Date.now() < deadline) {
    const pages = context.pages().slice().reverse();
    for (const candidatePage of pages) {
      if (candidatePage.isClosed()) continue;
      const input = await findConfirmedImageInput(candidatePage, platform);
      if (input) return input;
    }

    if (Date.now() - lastSwitchAttemptAt >= 1_200) {
      for (const candidatePage of pages) {
        if (candidatePage.isClosed()) continue;
        const modeState = await imageTextModeState(candidatePage, platform);
        if (modeState === true) continue;
        const control = await visibleModeControl(candidatePage, platform, 700);
        if (!control) continue;
        lastSwitchAttemptAt = Date.now();
        try {
          await safeClick(control, `切换到${platform.name}图文发布模式`, { timeout: 3_000 });
        } catch {}
        break;
      }
    }
    await delay(220);
  }
  return null;
}

export class ImageTextChromeRunner {
  constructor(log, completed, progress = () => {}) {
    this.log = log;
    this.completed = completed;
    this.progress = progress;
    this.reported = new WeakSet();
    this.jobBrowsers = new Map();
    this.cancelled = false;
  }

  start(jobs) {
    this.log(`正在并行启动 ${jobs.length} 个图文发布 Chrome 窗口`);
    for (const job of jobs) void this.#runJob(job);
  }

  run(job) { return this.#runJob(job); }
  hasOpenWindows() { return this.jobBrowsers.size > 0; }

  async closeWindows() {
    await Promise.allSettled([...new Set(this.jobBrowsers.values())].map(closeBrowser));
    this.jobBrowsers.clear();
  }

  async closeJobs(jobs) {
    await Promise.allSettled([...new Set(jobs.map(job => this.jobBrowsers.get(job)).filter(Boolean))].map(closeBrowser));
    for (const job of jobs) this.jobBrowsers.delete(job);
  }

  async cancel() {
    this.cancelled = true;
    await this.closeWindows();
  }

  #throwIfCancelled() {
    if (this.cancelled) throw new Error("任务已取消");
  }

  #stage(job, status, message) {
    this.progress(job, status, message);
  }

  #report(job, success, reason = "", errorCode = "") {
    if (this.reported.has(job)) return;
    this.reported.add(job);
    this.completed(job, success, reason, errorCode);
  }

  async #snapshot(page, job, prefix) {
    try {
      const folder = job.artifactDir || path.dirname(job.images[0]);
      await page.screenshot({ path: path.join(folder, `${prefix}_${job.platformKey}.png`), fullPage: true });
      fs.writeFileSync(path.join(folder, `${prefix}_${job.platformKey}.html`), await page.content(), "utf8");
    } catch {}
  }

  async #markExpiredLogin(page, platform, job) {
    if (!(await hasVisibleLoginPrompt(page, platform.key))) return;
    bindingManager.markLoginInvalid(platform.key, job.accountId, LOGIN_INVALID_MESSAGE);
    throw new ImageTextLoginExpiredError(LOGIN_INVALID_MESSAGE);
  }

  async #dismissKuaishouGuide(page, platform, job, timeoutMs = 250) {
    if (platform.key !== "kuaishou") return false;
    if (!(await dismissKuaishouPublishGuide(page, timeoutMs))) return false;
    this.log(`[${platform.name}/${job.account}] 已关闭首次发布作品指引`);
    return true;
  }

  async #waitForForm(page, platform, job, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let uploadReady = !platform.uploadReadySelectors?.length;
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new Error(`${platform.name}图文页面在图片处理期间被关闭`);
      await this.#markExpiredLogin(page, platform, job);
      const uploadError = await visibleUploadError(page);
      if (uploadError) throw new Error(`图片上传失败：${uploadError}`);
      await this.#dismissKuaishouGuide(page, platform, job);
      if (!uploadReady && await visibleFirst(page, platform.uploadReadySelectors, 100)) uploadReady = true;
      if (uploadReady && await visibleFirst(page, [...platform.titles, ...platform.contents], 100)) return true;
      await delay(350);
    }
    return false;
  }

  async #setImageFiles(page, platform, input, images) {
    let currentInput = input;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await currentInput.setInputFiles(images);
        return;
      } catch (error) {
        lastError = error;
        if (page.isClosed()) throw error;
        await delay(350);
        currentInput = await findConfirmedImageInput(page, platform);
        if (!currentInput) break;
      }
    }
    throw lastError ?? new Error(`${platform.name}图片上传控件已失效`);
  }

  async #fillContent(page, platform, job) {
    this.#stage(job, "filling", "正在填写图文标题、正文与话题");
    if (platform.key === "kuaishou") {
      this.#stage(job, "filling", "正在填写图文简介与话题");
      await this.#dismissKuaishouGuide(page, platform, job, 4_000);
      const content = kuaishouImageTextContent(job.title, job.content);
      if (content && !(await fillFirst(page, platform.contents, content, true))) throw new Error("快手图文正文填写失败");
      if (!(await appendTopics(page, platform, job.topics, topic => {
        this.log(`[${platform.name}/${job.account}] 平台拒绝添加标签“${topic}”，已跳过`);
      }))) throw new Error("快手话题填写失败");
      await this.#dismissKuaishouGuide(page, platform, job, 1_500);
      return;
    }
    const titleField = await visibleFirst(page, platform.titles, platform.titleRequired ? 10_000 : 1_200);
    if (titleField) {
      if (!(await fillFirst(page, platform.titles, job.title))) throw new Error(`${platform.name}标题填写失败`);
    } else if (platform.titleRequired) {
      throw new Error(`${platform.name}未找到图文标题输入框`);
    }

    const content = platform.key === "channels"
      ? channelsImageTextContent(job.content, job.topics)
      : job.content;
    if (content && !(await fillFirst(page, platform.contents, content))) throw new Error(`${platform.name}正文填写失败`);
    if (platform.key === "channels" && job.shortTitle && !(await fillChannelsShortTitle(page, platform, job.shortTitle))) {
      throw new Error("视频号短标题填写失败");
    }
    if (platform.key !== "channels" && !(await appendTopics(page, platform, job.topics, topic => {
      this.log(`[${platform.name}/${job.account}] 平台拒绝添加标签“${topic}”，已跳过`);
    }))) throw new Error(`${platform.name}话题填写失败`);
  }

  async #saveLoginState(context, platform, job) {
    if (platform.key !== "channels" && platform.key !== "kuaishou") return;
    try {
      await bindingManager.saveRuntimeState(context, platform.key, job.accountId);
      this.log(`[${platform.name}/${job.account}] 图文发布页登录状态已保存`);
    } catch (error) {
      this.log(`[${platform.name}/${job.account}] 登录状态保存失败：${error.message}`);
    }
  }

  async #runJob(job) {
    const platform = IMAGE_TEXT_PLATFORMS[job.platformKey];
    let browser;
    let page;
    let windowCloseGuard;
    try {
      this.#throwIfCancelled();
      this.#stage(job, "launching", "正在启动独立 Chrome 窗口");
      browser = await chromium.launch({
        executablePath: chromePath(),
        headless: false,
        chromiumSandbox: false,
        args: ["--disable-blink-features=AutomationControlled", "--window-size=1040,780", "--window-position=440,120"]
      });
      this.jobBrowsers.set(job, browser);
      browser.on("disconnected", () => { this.jobBrowsers.delete(job); this.onWindowClosed?.(); });
      const context = await browser.newContext({ storageState: bindingManager.storageState(job.platformKey, job.accountId), viewport: null });
      page = await context.newPage();
      windowCloseGuard = createPlatformWindowCloseGuard(browser, context);
      await Promise.race([
        windowCloseGuard.promise,
        (async () => {
      trackImageTextWindow(browser, page, message => this.log(`[${platform.name}/${job.account}] ${message}`));
      await centerPublishWindow(page);

      this.#stage(job, "navigating", "正在进入平台图文发布页");
      await page.goto(platform.url, { waitUntil: "commit", timeout: 90_000 });
      await this.#markExpiredLogin(page, platform, job);
      const input = await openImageTextMode(page, platform);
      if (!input) {
        const fallbackPage = page.context().pages().slice().reverse().find(candidate => !candidate.isClosed());
        if (fallbackPage) page = fallbackPage;
        await this.#markExpiredLogin(page, platform, job);
        if (platform.key === "channels" && await page.getByText("请完成出镜人身份验证", { exact: false }).first().isVisible({ timeout: 300 }).catch(() => false)) {
          throw new Error("当前视频号账号需要先完成出镜人身份验证，暂时无法进入图文发表页");
        }
        throw new Error("未找到图文图片上传入口，请检查平台页面是否已调整");
      }
      const uploadPage = input.page();
      if (uploadPage !== page) {
        page = uploadPage;
        trackImageTextWindow(browser, page, message => this.log(`[${platform.name}/${job.account}] ${message}`));
        await centerPublishWindow(page);
      }
      await this.#markExpiredLogin(page, platform, job);

      this.#throwIfCancelled();
      this.#stage(job, "uploading", `正在上传 ${job.images.length} 张图片`);
      await this.#setImageFiles(page, platform, input, job.images);
      this.log(`[${platform.name}/${job.account}] ${job.images.length} 张图片已提交给平台`);
      if (!(await this.#waitForForm(page, platform, job))) throw new Error("等待图片处理或图文表单超时");

      this.#throwIfCancelled();
      await this.#fillContent(page, platform, job);
      this.#stage(job, "rights", `正在设置${platform.name}内容声明`);
      await setRights(page, job, this.log, platform);
      if (platform.key === "channels" && job.channelsOriginal) {
        this.#stage(job, "original", "正在设置视频号原创声明");
        const originalResult = await setChannelsOriginalIfAvailable(page);
        if (originalResult === "failed") throw new Error("视频号原创声明设置失败：未能完成协议确认和原创声明");
        this.log(`[${platform.name}/${job.account}] ${originalResult === "unavailable" ? "当前账号未提供原创声明控件，已跳过" : "已完成原创声明"}`);
      }
      if (platform.key === "channels" && job.channelsHideLocation) {
        this.#stage(job, "location", "正在将视频号位置设置为不显示位置");
        if (!(await setChannelsLocationHidden(page))) throw new Error("视频号位置设置失败：未能选择“不显示位置”");
        this.log(`[${platform.name}/${job.account}] 已选择不显示位置`);
      }
      if (job.scheduledAt) {
        this.#stage(job, "scheduling", `正在选择定时发布时间：${job.scheduledAt.replace("T", " ")}`);
        await setScheduledPublish(page, platform, job.scheduledAt, message => this.log(`[${platform.name}/${job.account}] ${message}`), { timezone: 'Asia/Shanghai' });
        await this.#snapshot(page, job, "image_text_schedule_verified");
      }
      await this.#saveLoginState(context, platform, job);
      await this.#snapshot(page, job, "image_text_ready");
      this.#stage(job, "ready", job.scheduledAt ? "图文资料与定时时间已填写，等待人工检查并发布" : "图文资料填写完成，等待人工检查并发布");
      this.#report(job, true);
      this.log(`[${platform.name}/${job.account}] 图文资料填写完成${job.scheduledAt ? "，定时时间已选择" : ""}；浏览器保留，未点击最终发布按钮`);
        })()
      ]);
    } catch (caughtError) {
      const error = normalizePlatformWindowError(caughtError);
      const loginExpired = error.code === "LOGIN_EXPIRED";
      const cancelled = this.cancelled || error.message === "任务已取消";
      if (page && !page.isClosed() && !loginExpired) await this.#snapshot(page, job, "image_text_failure");
      this.#stage(job, cancelled ? "cancelled" : "failed", cancelled ? "任务已取消" : error.message);
      this.#report(job, false, cancelled ? "任务已取消" : error.message, error.code || (loginExpired ? "LOGIN_EXPIRED" : 'AUTOMATION_FAILED'));
      if (loginExpired) await closeBrowser(browser);
      const retainBrowser = !loginExpired && page && !page.isClosed();
      if (!retainBrowser) await closeBrowser(browser);
      this.log(`[${platform.name}/${job.account}] 图文任务失败：${error.message}${retainBrowser ? "；浏览器保留供检查" : ""}`);
    } finally {
      windowCloseGuard?.dispose();
    }
  }
}
