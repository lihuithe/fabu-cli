import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { bindingManager, chromePath, hasVisibleLoginPrompt, LOGIN_INVALID_MESSAGE } from "./account-binding.js";
import { appendTopics, dismissKuaishouPublishGuide, fillFirst, findVideoInput, setChannelsLocationHidden, setChannelsOriginalIfAvailable, setPublishLocation, setRights, visibleFirst } from "./browser-utils.js";
import { ChannelsVideoUploadMonitor, confirmDefaultCover, platformCoverSignature, uploadCovers, waitForPlatformCoverChange } from "./cover-handlers.js";
import { PLATFORMS } from "./platforms.js";
import { normalizePlatformWindowError } from "./platform-window.js";
import { setScheduledPublish } from "./schedule-publish.js";
import { submitAndVerify, verifySubmission } from './submission.js';

const activeBrowsers = new Set();
const closingBrowsers = new WeakSet();

class LoginExpiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoginExpiredError";
    this.code = "LOGIN_EXPIRED";
  }
}

async function closeTrackedBrowser(browser) {
  if (!browser || closingBrowsers.has(browser)) return;
  closingBrowsers.add(browser);
  activeBrowsers.delete(browser);
  await browser.close().catch(() => {});
}

export function trackBrowserWindow(browser, page, log = () => {}) {
  activeBrowsers.add(browser);
  browser.on("disconnected", () => activeBrowsers.delete(browser));
  page.once("close", () => {
    log("Chrome 窗口已关闭，正在释放对应浏览器进程");
    void closeTrackedBrowser(browser);
  });
}

export async function closeActiveBrowsers() {
  await Promise.allSettled([...activeBrowsers].map(browser => closeTrackedBrowser(browser)));
}

export async function centerPublishWindow(page) {
  try {
    await page.evaluate(() => {
      const width = Math.round(screen.availWidth * 0.58);
      const height = Math.round(screen.availHeight * 0.82);
      const left = Math.max(0, Math.round((screen.availWidth - width) / 2));
      const top = Math.max(0, Math.round((screen.availHeight - height) / 2));
      window.resizeTo(width, height);
      window.moveTo(left, top);
    });
  } catch {}
}

export function channelsDescription(job) {
  const topics = job.topics
    .map(topic => String(topic).replace(/^#+/, "").trim())
    .filter(Boolean)
    .map(topic => `#${topic}`)
    .join(" ");
  return [String(job.title ?? "").trim(), topics].filter(Boolean).join("\n");
}

export function kuaishouDescription(job) {
  return String(job.content ?? "").trim();
}

export async function fillChannelsShortTitle(page, platform, shortTitle) {
  if (!shortTitle) return true;
  return fillFirst(page, platform.shortTitles || [], shortTitle);
}

export class SharedChromeRunner {
  constructor(log, completed, progress = () => {}) {
    this.log = log;
    this.completed = completed;
    this.progress = progress;
    this.reported = new WeakSet();
    this.jobBrowsers = new Map();
    this.cancelled = false;
  }

  start(jobs) {
    this.log(`正在并行启动 ${jobs.length} 个独立 Chrome 窗口`);
    for (const job of jobs) void this.#runJob(job);
  }

  run(job) { return this.#runJob(job); }
  hasOpenWindows() { return this.jobBrowsers.size > 0; }
  async verifySubmission(job) {
    if (!this.page || this.page.isClosed()) throw new Error('原任务窗口已经关闭，请到平台核实并记录结果');
    try {
      const result = await verifySubmission(this.page, job.platformKey, { timeoutMs: 5_000, expected: { title: job.title, description: job.content, scheduledAt: job.scheduledAt }, context: job.submissionContext });
      this.#submissionDiagnostic(job, { result });
      return result;
    } catch (error) {
      this.#submissionDiagnostic(job, { error: { code: error.code, message: error.message } });
      throw error;
    }
  }

  async closeWindows() {
    await Promise.allSettled([...new Set(this.jobBrowsers.values())].map(browser => closeTrackedBrowser(browser)));
    this.jobBrowsers.clear();
  }

  async closeJobs(jobs) {
    const selected = jobs.map(job => this.jobBrowsers.get(job)).filter(Boolean);
    await Promise.allSettled([...new Set(selected)].map(browser => closeTrackedBrowser(browser)));
    for (const job of jobs) this.jobBrowsers.delete(job);
  }

  async cancel() {
    this.cancelled = true;
    await this.closeWindows();
  }

  #stage(job, status, message) {
    this.progress(job, status, message);
  }

  #throwIfCancelled() {
    if (this.cancelled) throw new Error("任务已取消");
  }

  #report(job, success, reason = "", errorCode = "", result = {}) {
    if (this.reported.has(job)) return;
    this.reported.add(job);
    this.completed(job, success, reason, errorCode, result);
  }

  async #snapshot(page, job, prefix) {
    try {
      const folder = job.artifactDir || path.dirname(job.video);
      await page.screenshot({ path: path.join(folder, `${prefix}_${job.platformKey}.png`), fullPage: true });
      fs.writeFileSync(path.join(folder, `${prefix}_${job.platformKey}.html`), await page.content(), "utf8");
    } catch {}
  }

  #submissionDiagnostic(job, detail) {
    try {
      const folder = job.artifactDir || path.dirname(job.video);
      fs.writeFileSync(path.join(folder, `submission_diagnostic_${job.platformKey}.json`), JSON.stringify({
        observed_at: new Date().toISOString(), platform: job.platformKey, title: job.title,
        scheduled_at: job.scheduledAt || null, context: job.submissionContext || null, ...detail
      }, null, 2), 'utf8');
    } catch (error) { this.log(`[${job.account}] 提交诊断日志保存失败：${error.message}`); }
  }

  async #saveLoginState(context, platform, job, stage) {
    if (platform.key !== "channels" && platform.key !== "kuaishou") return;
    try {
      const saved = await bindingManager.saveRuntimeState(context, platform.key, job.accountId);
      this.log(`[${platform.name}/${job.account}] 登录状态已保存（${stage}）：${path.basename(saved)}`);
    } catch (error) { this.log(`[${platform.name}/${job.account}] 登录状态保存失败（${stage}）：${error.message}`); }
  }

  async #markExpiredLogin(page, platform, job) {
    if (!(await hasVisibleLoginPrompt(page, platform.key))) return false;
    const reason = LOGIN_INVALID_MESSAGE;
    bindingManager.markLoginInvalid(platform.key, job.accountId, reason);
    throw new LoginExpiredError(reason);
  }

  async #dismissKuaishouGuide(page, platform, job, timeoutMs = 250) {
    if (platform.key !== "kuaishou") return false;
    if (!(await dismissKuaishouPublishGuide(page, timeoutMs))) return false;
    this.log(`[${platform.name}/${job.account}] 已关闭首次发布作品指引`);
    return true;
  }

  async #waitForForm(page, platform, job, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    const selectors = platform.key === "kuaishou"
      ? platform.contents
      : [...platform.titles, ...platform.contents];
    while (Date.now() < deadline) {
      this.#throwIfCancelled();
      if (page.isClosed()) throw new Error('Target page has been closed');
      await this.#markExpiredLogin(page, platform, job);
      await this.#dismissKuaishouGuide(page, platform, job);
      if (await visibleFirst(page, selectors, 80)) return true;
      await page.waitForTimeout(platform.key === "kuaishou" ? 200 : 350);
    }
    return false;
  }

  async #findVideoInputOrExpiredLogin(page, platform, job, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#throwIfCancelled();
      if (page.isClosed()) throw new Error('Target page has been closed');
      await this.#markExpiredLogin(page, platform, job);
      const field = await findVideoInput(page, platform, Math.min(600, Math.max(1, deadline - Date.now())));
      if (field) {
        await this.#markExpiredLogin(page, platform, job);
        return field;
      }
    }
    return null;
  }

  async #fillReady(page, platform, job, monitor) {
    this.#throwIfCancelled();
    this.#stage(job, "filling", "正在填写标题、话题与简介");
    if (platform.key === "channels") {
      await fillFirst(page, platform.contents, channelsDescription(job));
      if (!(await fillChannelsShortTitle(page, platform, job.shortTitle))) throw new Error("视频号短标题填写失败");
    } else if (platform.key === "kuaishou") {
      this.#stage(job, "filling", "正在填写简介与话题");
      await this.#dismissKuaishouGuide(page, platform, job, 4_000);
      if (!(await fillFirst(page, platform.contents, kuaishouDescription(job), true))) throw new Error("快手作品描述填写失败");
      if (!(await appendTopics(page, platform, job.topics, topic => {
        this.log(`[${platform.name}/${job.account}] 平台拒绝添加标签“${topic}”，已跳过并继续处理后续标签`);
      }))) throw new Error("快手用户标签处理失败");
      await this.#dismissKuaishouGuide(page, platform, job, 1_500);
    } else {
      if (!(await fillFirst(page, platform.titles, job.title))) throw new Error(`${platform.name}标题填写失败`);
      if (!(await fillFirst(page, platform.contents, job.content))) throw new Error(`${platform.name}简介填写失败`);
      if (platform.key === "bilibili") await setRights(page, job, this.log, platform);
      if (!(await appendTopics(page, platform, job.topics, topic => {
        this.log(`[${platform.name}/${job.account}] 平台拒绝添加标签“${topic}”，已跳过并继续处理后续标签`);
      }))) throw new Error(`${platform.name}用户标签处理失败`);
    }
    if (monitor) {
      this.log(`[${platform.name}/${job.account}] 标题、话题和简介已填写；等待视频文件真实上传完成${job.useCustomCover ? "后再设置封面" : ""}`);
      await monitor.wait();
    }
    this.#throwIfCancelled();
    if (job.useCustomCover) {
      this.#stage(job, "cover", "正在设置封面与内容声明");
      const before = await platformCoverSignature(page, platform.key);
      await uploadCovers(page, job, platform, this.log);
      const coverVerifyTimeout = platform.key === "kuaishou" ? 12_000 : 8_000;
      if (!(await waitForPlatformCoverChange(page, platform.key, before, coverVerifyTimeout))) throw new Error("平台自己的封面卡片未出现新预览，封面上传不算成功");
      await this.#snapshot(page, job, "cover_verified");
    } else if (platform.key === "kuaishou") {
      this.#stage(job, "cover", "未上传封面，使用快手自动推荐封面");
      this.log(`[${platform.name}/${job.account}] 本次未上传封面，已跳过设置封面`);
    } else {
      this.#stage(job, "cover", "正在确认平台默认封面与内容声明");
      await confirmDefaultCover(page, job, platform, this.log);
      await this.#snapshot(page, job, "cover_default_confirmed");
    }
    if (platform.key !== "bilibili") await setRights(page, job, this.log, platform);
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
    } else if (job.location) {
      this.#stage(job, "location", `正在搜索发布位置：${job.location}`);
      if (!(await setPublishLocation(page, platform, job.location))) throw new Error(`${platform.name}位置设置失败：未能搜索并选择第一条位置结果`);
      this.log(`[${platform.name}/${job.account}] 已搜索“${job.location}”并选择第一条位置结果`);
    }
    if (job.scheduledAt) {
      this.#stage(job, "scheduling", `正在选择定时发布时间：${job.scheduledAt.replace("T", " ")}`);
      this.log(`[${platform.name}/${job.account}] 已收到定时发布时间参数：${job.scheduledAt}`);
      if (platform.key === "kuaishou") {
        await this.#dismissKuaishouGuide(page, platform, job, 800);
      }
      await setScheduledPublish(page, platform, job.scheduledAt, message => this.log(`[${platform.name}/${job.account}] ${message}`), { timezone: 'Asia/Shanghai' });
      await this.#snapshot(page, job, "schedule_verified");
    }
    if (job.directPublish) {
      this.#throwIfCancelled();
      job.submissionContext = {};
      this.#stage(job, "publishing", `正在准备${platform.name}提交及结果核验`);
      job.submissionResult = await submitAndVerify(page, platform, () => {
        this.#throwIfCancelled();
        job.submissionStarted = true;
        this.#stage(job, 'submitting', '即将点击最终发布，已记录提交边界');
      }, { expected: { title: job.title, description: job.content, scheduledAt: job.scheduledAt }, context: job.submissionContext });
      this.#submissionDiagnostic(job, { result: job.submissionResult });
      await this.#snapshot(page, job, 'submission_receipt');
      this.log(`[${platform.name}/${job.account}] 已检测到平台接受提交的明确回执`);
    }
  }

  // B站上传框在页面刚开始加载时就已存在，但前端初始化后会重建上传区域，
  // 过早写入的文件会被丢弃、页面停在“上传视频”。等页面加载完且按钮可见后再重新定位上传框。
  async #waitForBilibiliUploader(page, platform, job) {
    await page.waitForLoadState("load", { timeout: 60_000 }).catch(() => {});
    await page.getByText("上传视频", { exact: true }).first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
    return this.#findVideoInputOrExpiredLogin(page, platform, job, 30_000);
  }

  async #runJob(job) {
    const platform = PLATFORMS[job.platformKey];
    let browser;
    let page;
    let monitor;
    try {
      this.#throwIfCancelled();
      this.#stage(job, "launching", "正在启动独立 Chrome 窗口");
      browser = await chromium.launch({ executablePath: chromePath(), headless: false, chromiumSandbox: false, args: ["--disable-blink-features=AutomationControlled", "--window-size=1040,780", "--window-position=440,120"] });
      this.jobBrowsers.set(job, browser);
      browser.on("disconnected", () => { this.jobBrowsers.delete(job); this.onWindowClosed?.(); });
      const context = await browser.newContext({ storageState: bindingManager.storageState(job.platformKey, job.accountId), viewport: null });
      page = await context.newPage();
      this.page = page;
      trackBrowserWindow(browser, page, message => this.log(`[${platform.name}/${job.account}] ${message}`));
      await centerPublishWindow(page);
      this.#stage(job, "browser_opened", "Chrome 已打开，正在进入平台上传页");
      this.log(`[${platform.name}/${job.account}] 独立 Chrome 窗口已启动`);
      this.#throwIfCancelled();
      this.#stage(job, "navigating", "正在定位视频上传位置");
      await page.goto(platform.url, { waitUntil: "commit", timeout: 90_000 });
      const field = await this.#findVideoInputOrExpiredLogin(page, platform, job);
      if (!field) throw new Error("登录后仍未检测到视频上传框");
      await this.#saveLoginState(context, platform, job, "上传页已就绪");
      if (platform.key === "channels") monitor = new ChannelsVideoUploadMonitor(page, job.video, message => this.log(`[${platform.name}/${job.account}] ${message}`));
      this.#throwIfCancelled();
      this.#stage(job, "uploading", "正在上传视频并等待平台处理");
      const uploadField = platform.key === "bilibili" ? await this.#waitForBilibiliUploader(page, platform, job) : field;
      if (!uploadField) throw new Error("B站上传页加载完成后未找到视频上传框");
      await uploadField.setInputFiles(job.video);
      this.log(`[${platform.name}/${job.account}] 视频已开始上传，并行填写流程继续`);
      if (!(await this.#waitForForm(page, platform, job))) throw new Error("等待视频处理/资料表单超时");
      await this.#fillReady(page, platform, job, monitor);
      await this.#saveLoginState(context, platform, job, job.directPublish ? "已点击发布按钮" : (job.scheduledAt ? "资料、封面和定时时间处理完成" : "资料和封面处理完成"));
      this.#stage(job, "ready", job.directPublish ? "平台已确认接受提交" : (job.scheduledAt ? "资料与定时时间已填写，等待人工检查并发布" : "资料填写完成，等待人工检查并发布"));
      await this.#snapshot(page, job, 'ready');
      this.#report(job, true, job.directPublish ? '平台已确认接受提交，审核与公开状态以平台为准' : '', '', job.submissionResult || { outcome: 'prepared' });
      if (job.directPublish && job.closeAfterSubmit) await closeTrackedBrowser(browser);
      this.log(`[${platform.name}/${job.account}] 并行任务已完成${job.scheduledAt ? "，定时时间已选择" : ""}${job.directPublish ? "，已点击发布按钮" : "；浏览器保留，请人工检查后发布"}`);
    } catch (caughtError) {
      const error = normalizePlatformWindowError(caughtError);
      const loginExpired = error.code === "LOGIN_EXPIRED";
      if (job.submissionStarted) {
        this.#submissionDiagnostic(job, { error: { code: error.code, message: error.message } });
        this.log(`[${platform.name}/${job.account}] 未能核实提交，已保存 submission_diagnostic_${job.platformKey}.json 和提交现场截图；请核实原任务，不要重新发布`);
      }
      if (page && !loginExpired) await this.#snapshot(page, job, job.submissionStarted ? "submission_unknown" : "cover_failure");
      const cancelled = this.cancelled || error.message === "任务已取消";
      this.#stage(job, cancelled ? "cancelled" : "failed", cancelled ? "任务已取消" : error.message);
      this.#report(job, false, cancelled ? "任务已取消" : error.message, job.submissionStarted ? 'SUBMISSION_UNKNOWN' : error.code || (loginExpired ? "LOGIN_EXPIRED" : 'AUTOMATION_FAILED'), { outcome: job.submissionStarted ? 'submission_unknown' : 'failed' });
      if (loginExpired) {
        await closeTrackedBrowser(browser);
        this.log(`[${platform.name}/${job.account}] 检测到登录页面，已关闭该账号浏览器并标记登录失效`);
        return;
      }
      const canRetainBrowser = page && !page.isClosed();
      if (!canRetainBrowser) await closeTrackedBrowser(browser);
      this.log(`[${platform.name}/${job.account}] 并行任务失败：${error.message}${canRetainBrowser ? "；浏览器保留，请检查失败现场" : "；浏览器进程已释放"}`);
      if (!browser) this.log(`[${platform.name}/${job.account}] Chrome 启动失败：${error.message}`);
    } finally {
      monitor?.stop();
      // 成功和失败现场都保留；用户关闭窗口后 Playwright 会自行释放进程。
    }
  }
}
