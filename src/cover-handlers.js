import fs from "node:fs";
import { CoverUploadError, mediaSignature, safeClick, visibleUploadError, waitForMediaChange } from "./browser-utils.js";
import { douyinCoverRatios } from "./platforms.js";

async function waitLoop(page, timeoutMs, action, timeoutMessage, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new CoverUploadError("浏览器已关闭");
    const error = await visibleUploadError(page);
    if (error) throw new CoverUploadError(error);
    const result = await action().catch(() => null);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new CoverUploadError(timeoutMessage);
}

async function uploadDouyin(page, job, platform, log) {
  const vertical = job.covers["3:4"];
  const horizontal = job.covers["4:3"];
  if (!vertical || !horizontal || !fs.existsSync(vertical) || !fs.existsSync(horizontal)) throw new CoverUploadError("抖音缺少 3:4 或 4:3 封面文件");
  const covers = { "3:4": vertical, "4:3": horizontal };
  const [firstRatio, secondRatio] = douyinCoverRatios(job.videoWidth, job.videoHeight);
  const coverName = ratio => ratio === "4:3" ? "横封面" : "竖封面";
  let stage = "等待视频上传完成";
  try {
    const verticalCard = page.locator('div.coverControl-CjlzqC:has-text("竖封面")').first();
    const horizontalCard = page.locator('div.coverControl-CjlzqC:has-text("横封面")').first();
    const entry = page.locator('xpath=//div[@class="filter-k_CjvJ"]').first();
    await waitLoop(page, 180_000, async () => await verticalCard.isVisible({ timeout: 150 }) && await horizontalCard.isVisible({ timeout: 150 }) && await entry.isVisible({ timeout: 150 }), "等待抖音视频上传完成及封面入口就绪超时", 350);
    const beforeVertical = await mediaSignature(verticalCard);
    const beforeHorizontal = await mediaSignature(horizontalCard);
    stage = "打开封面设置弹窗";
    await safeClick(entry, "打开抖音封面设置弹窗");
    const modal = page.locator("#dy-creator-content-modal-body").first();
    await modal.waitFor({ state: "visible", timeout: 10_000 });
    stage = `上传${coverName(firstRatio)}`;
    let inputs = modal.locator('xpath=.//div[@class="semi-upload upload-BvM5FF"]//input[@class="semi-upload-hidden-input"]');
    await inputs.first().waitFor({ state: "attached", timeout: 10_000 });
    if (await inputs.count() !== 1) throw new CoverUploadError(`${coverName(firstRatio)}上传 input 数量异常：${await inputs.count()}`);
    const beforeModal = await mediaSignature(modal);
    await inputs.first().setInputFiles(covers[firstRatio]);
    await waitForMediaChange(page, modal, beforeModal, 30_000);
    log(`[${platform.name}/${job.account}] ${coverName(firstRatio)}已真正上传：${covers[firstRatio]}`);
    stage = `切换${coverName(secondRatio)}标签`;
    const steps = modal.locator('xpath=.//div[contains(concat(" ", normalize-space(@class), " "), " step-dXVbPX ")]');
    if (await steps.count() < 2) throw new CoverUploadError(`${coverName(secondRatio)}选项数量不足`);
    await safeClick(steps.nth(1), `切换到抖音${coverName(secondRatio)}标签`);
    await page.waitForTimeout(300);
    stage = `上传${coverName(secondRatio)}`;
    inputs = modal.locator('xpath=.//div[@class="semi-upload upload-BvM5FF"]//input[@class="semi-upload-hidden-input"]');
    await inputs.first().waitFor({ state: "attached", timeout: 10_000 });
    const beforeSecondModal = await mediaSignature(modal);
    await inputs.first().setInputFiles(covers[secondRatio]);
    await waitForMediaChange(page, modal, beforeSecondModal, 30_000);
    log(`[${platform.name}/${job.account}] ${coverName(secondRatio)}已真正上传：${covers[secondRatio]}`);
    stage = "确认封面设置";
    const complete = page.locator('button[class="semi-button semi-button-primary primary-RstHX_"], button:has-text("完成")').last();
    await complete.waitFor({ state: "visible", timeout: 10_000 });
    await safeClick(complete, "完成抖音封面设置");
    await modal.waitFor({ state: "hidden", timeout: 10_000 });
    await waitForMediaChange(page, verticalCard, beforeVertical, 15_000);
    await waitForMediaChange(page, horizontalCard, beforeHorizontal, 15_000);
  } catch (error) { throw new CoverUploadError(`抖音${stage}失败：${error.message}`); }
}

async function confirmDefaultDouyin(page, job, platform, log) {
  let stage = "等待视频上传完成";
  try {
    const verticalCard = page.locator('div.coverControl-CjlzqC:has-text("竖封面")').first();
    const horizontalCard = page.locator('div.coverControl-CjlzqC:has-text("横封面")').first();
    const entry = page.locator('xpath=//div[@class="filter-k_CjvJ"]').first();
    await waitLoop(page, 180_000, async () => await verticalCard.isVisible({ timeout: 150 }) && await horizontalCard.isVisible({ timeout: 150 }) && await entry.isVisible({ timeout: 150 }), "等待抖音视频上传完成及默认封面入口就绪超时", 350);
    stage = "打开平台默认封面弹窗";
    await safeClick(entry, "打开抖音默认封面弹窗");
    const modal = page.locator("#dy-creator-content-modal-body").first();
    await modal.waitFor({ state: "visible", timeout: 10_000 });
    const steps = modal.locator('div.step-dXVbPX');
    if (await steps.count() !== 2) throw new CoverUploadError(`封面比例标签数量异常：${await steps.count()}`);
    const verticalStep = modal.locator('xpath=.//div[contains(concat(" ", normalize-space(@class), " "), " step-dXVbPX ")][.//span[normalize-space(.)="设置竖封面"]]');
    const horizontalStep = modal.locator('xpath=.//div[contains(concat(" ", normalize-space(@class), " "), " step-dXVbPX ")][.//span[normalize-space(.)="设置横封面"]]');
    if (await verticalStep.count() !== 1 || await horizontalStep.count() !== 1) throw new CoverUploadError("无法按文字唯一识别竖封面和横封面标签");
    const stepByRatio = { "3:4": verticalStep, "4:3": horizontalStep };
    const coverName = ratio => ratio === "4:3" ? "横封面" : "竖封面";
    const [primaryRatio, secondaryRatio] = douyinCoverRatios(job.videoWidth, job.videoHeight);
    const primaryStep = stepByRatio[primaryRatio];
    const secondaryStep = stepByRatio[secondaryRatio];
    const setSecondary = modal.locator(`xpath=.//button[.//span[contains(@class,"semi-button-content") and normalize-space(.)="设置${coverName(secondaryRatio)}"]]`);
    stage = `使用${coverName(primaryRatio)}同步设置${coverName(secondaryRatio)}`;
    await safeClick(primaryStep, `切换到抖音${coverName(primaryRatio)}页面`);
    await waitLoop(page, 10_000, async () => {
      if (!(await primaryStep.getAttribute("class"))?.includes("step-active-AWDV7U")) return false;
      return await setSecondary.count() === 1 && await setSecondary.isVisible({ timeout: 150 });
    }, `切换到${coverName(primaryRatio)}页面后，“设置${coverName(secondaryRatio)}”按钮未就绪`, 200);
    await safeClick(setSecondary, `使用平台默认素材设置抖音${coverName(secondaryRatio)}`, { force: true });
    await waitLoop(page, 10_000, async () => (await secondaryStep.getAttribute("class"))?.includes("step-active-AWDV7U"), `设置${coverName(secondaryRatio)}后未进入对应页面`, 200);
    if (primaryRatio === "3:4") {
      stage = "返回竖封面页面并确认";
      await safeClick(primaryStep, "返回抖音竖封面页面");
      await waitLoop(page, 10_000, async () => (await primaryStep.getAttribute("class"))?.includes("step-active-AWDV7U"), "返回竖封面页面超时", 200);
    }
    stage = `在${coverName(primaryRatio === "4:3" ? secondaryRatio : primaryRatio)}页面点击最终完成按钮`;
    const complete = modal.locator('xpath=.//button[.//span[contains(@class,"semi-button-content") and normalize-space(.)="完成"]]');
    await waitLoop(page, 15_000, async () => await complete.count() === 1 && await complete.isVisible({ timeout: 150 }) && await complete.isEnabled(), `封面弹窗内最终“完成”按钮未就绪，匹配数量：${await complete.count()}`, 200);
    await safeClick(complete, "确认抖音平台默认封面", { force: true });
    await modal.waitFor({ state: "hidden", timeout: 15_000 });
    log(`[${platform.name}/${job.account}] 已按${job.videoWidth > job.videoHeight ? "横屏" : "竖屏"}视频方向确认平台生成的竖封面和横封面，未上传自定义文件`);
  } catch (error) { throw new CoverUploadError(`抖音${stage}失败：${error.message}`); }
}

async function uploadBilibili(page, job, platform, log) {
  const covers = [job.covers["4:3"], job.covers["16:9"]];
  if (covers.some(cover => !cover || !fs.existsSync(cover))) throw new CoverUploadError("B站缺少 4:3 或 16:9 封面文件");
  let stage = "等待视频上传完成";
  try {
    const entry = await waitLoop(page, 300_000, async () => {
      for (const selector of ['div.cover-main div.cover-empty-pill', 'div.cover-main div.cover-slot', 'div.cover-main div.cover-img']) {
        const candidate = page.locator(selector).first();
        if (await candidate.isVisible({ timeout: 150 }).catch(() => false)) return candidate;
      }
      return null;
    }, "等待 B 站视频上传完成及封面入口出现超时", 350);
    stage = "打开封面编辑器";
    await safeClick(entry, "打开 B 站封面编辑器");
    const canvases = page.locator('xpath=//div[@class="canvas-container"]');
    await canvases.first().waitFor({ state: "visible", timeout: 10_000 });
    if (await canvases.count() !== 2) throw new CoverUploadError(`预期 2 个封面画布，实际找到 ${await canvases.count()} 个`);
    for (let i = 0; i < 2; i += 1) {
      const ratio = i === 0 ? "4:3" : "16:9";
      stage = `上传 ${ratio} 封面`;
      const canvas = canvases.nth(i);
      await safeClick(canvas, `选择 B 站 ${ratio} 封面画布`);
      await page.waitForTimeout(250);
      const input = page.locator('xpath=//div[@class="bcc-upload cover-upload cover-editor-panel-select-item"]//input[@type="file"]').first();
      const area = page.locator('xpath=//div[@class="bcc-upload cover-upload cover-editor-panel-select-item"]//input[@type="file"]/preceding-sibling::div[contains(@class,"upload-area")]').first();
      await input.waitFor({ state: "attached", timeout: 10_000 });
      const before = await mediaSignature(canvas);
      const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
      await safeClick(area, `打开 B 站 ${ratio} 封面文件选择器`);
      await (await chooserPromise).setFiles(covers[i]);
      await waitForMediaChange(page, canvas, before, 60_000);
      log(`[${platform.name}/${job.account}] ${ratio} 封面画布已更新`);
    }
    stage = "确认封面编辑";
    const done = page.locator('xpath=//div[contains(@class,"button") and normalize-space(.)="完成"]').first();
    await done.waitFor({ state: "visible", timeout: 10_000 });
    await safeClick(done, "完成 B 站双比例封面编辑");
    await done.waitFor({ state: "hidden", timeout: 10_000 });
  } catch (error) { throw new CoverUploadError(`B站${stage}失败：${error.message}`); }
}

async function confirmDefaultBilibili(page, job, platform, log) {
  let stage = "等待视频上传完成";
  try {
    const entry = await waitLoop(page, 300_000, async () => {
      for (const selector of ['div.cover-main div.cover-empty-pill', 'div.cover-main div.cover-slot', 'div.cover-main div.cover-img']) {
        const candidate = page.locator(selector).first();
        if (await candidate.isVisible({ timeout: 150 }).catch(() => false)) return candidate;
      }
      return null;
    }, "等待 B 站视频上传完成及默认封面入口出现超时", 350);
    stage = "打开平台默认封面弹窗";
    await safeClick(entry, "打开 B 站默认封面弹窗");
    const canvases = page.locator('xpath=//div[@class="canvas-container"]');
    await canvases.first().waitFor({ state: "visible", timeout: 10_000 });
    stage = "确认平台默认封面";
    const done = page.locator('xpath=//div[contains(@class,"button") and normalize-space(.)="完成"]').first();
    await done.waitFor({ state: "visible", timeout: 10_000 });
    await safeClick(done, "确认 B 站平台默认封面");
    await done.waitFor({ state: "hidden", timeout: 10_000 });
    log(`[${platform.name}/${job.account}] 已确认平台生成的默认封面，未上传自定义文件`);
  } catch (error) { throw new CoverUploadError(`B站${stage}失败：${error.message}`); }
}

async function visibleInFrames(page, selector) {
  const matches = [];
  for (const frame of page.frames()) {
    try {
      const nodes = frame.locator(selector);
      for (let i = 0; i < await nodes.count(); i += 1) if (await nodes.nth(i).isVisible({ timeout: 100 })) matches.push(nodes.nth(i));
    } catch {}
  }
  return matches;
}

async function attachedInFrames(page, selector) {
  const matches = [];
  for (const frame of page.frames()) {
    try {
      const nodes = frame.locator(selector);
      for (let i = 0; i < await nodes.count(); i += 1) matches.push(nodes.nth(i));
    } catch {}
  }
  return matches;
}

export class ChannelsVideoUploadMonitor {
  constructor(page, videoPath, log) {
    this.page = page; this.log = log; this.requests = new Map(); this.started = false; this.lastActivity = 0; this.enabled = true;
    const size = fs.statSync(videoPath).size;
    this.threshold = Math.min(512 * 1024, Math.max(64 * 1024, Math.floor(size / 50)));
    this.handlers = {
      request: request => this.#onRequest(request), response: response => this.#onResponse(response),
      requestfinished: request => this.#finish(request, ""), requestfailed: request => this.#finish(request, request.failure()?.errorText ?? "请求失败")
    };
    for (const [event, handler] of Object.entries(this.handlers)) page.on(event, handler);
  }
  #onRequest(request) {
    if (!this.enabled || !["POST", "PUT", "PATCH"].includes(request.method())) return;
    const url = request.url().toLowerCase();
    const type = (request.headers()["content-type"] ?? "").toLowerCase();
    let body = 0; try { body = request.postDataBuffer()?.length ?? 0; } catch {}
    const strong = ["upload", "video", "media", "vod", "finder", "weixin", "tencent"].some(key => url.includes(key));
    if (!(type.startsWith("video/") || body >= this.threshold || strong && (request.method() === "PUT" || type.includes("octet-stream") || type.includes("multipart")))) return;
    this.requests.set(request, { url: request.url(), done: false, status: null, failure: "" });
    this.started = true; this.lastActivity = Date.now();
  }
  #onResponse(response) { const item = this.requests.get(response.request()); if (item) { item.status = response.status(); this.lastActivity = Date.now(); } }
  #finish(request, failure) { const item = this.requests.get(request); if (item) { item.done = true; item.failure = failure; this.lastActivity = Date.now(); } }
  async wait(timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.page.isClosed()) throw new CoverUploadError("浏览器已关闭");
      const values = [...this.requests.values()];
      const failed = values.find(item => item.failure); if (failed) throw new CoverUploadError(`视频上传请求失败：${failed.failure}`);
      const bad = values.find(item => item.status >= 400); if (bad) throw new CoverUploadError(`视频上传接口返回 HTTP ${bad.status}：${bad.url}`);
      if (this.started && values.length && values.every(item => item.done) && Date.now() - this.lastActivity >= 3_000) {
        await this.page.evaluate(() => { window.__channelsVideoUploadConfirmed = true; });
        this.log(`视频上传请求已全部完成并稳定结束，共监测到 ${values.length} 个传输请求`); return;
      }
      await this.page.waitForTimeout(200);
    }
    throw new CoverUploadError(this.started ? "等待视频号视频上传请求完成超时" : "未监测到视频号真实视频上传请求");
  }
  stop() { if (!this.enabled) return; this.enabled = false; for (const [event, handler] of Object.entries(this.handlers)) this.page.off(event, handler); }
}

async function uploadChannelsHorizontalCover(page, cover, setStage) {
  setStage("等待 4:3 分享卡片封面入口");
  const entry = await waitLoop(page, 60_000, async () => {
    const items = await visibleInFrames(page, "div.horizon-cover-wrap div.horizon-img-wrap");
    return items.length === 1 ? items[0] : null;
  }, "3:4 封面已完成，但等待视频号 4:3 分享卡片封面入口出现超时", 350);
  setStage("打开 4:3 分享卡片封面编辑器");
  await safeClick(entry, "打开视频号 4:3 分享卡片封面编辑器");
  setStage("选择直接编辑 4:3 分享卡片封面");
  const directEdit = await waitLoop(page, 30_000, async () => {
    const items = await visibleInFrames(page, 'button.weui-desktop-btn_default.weui-desktop-btn_mini:has-text("直接编辑")');
    return items.length === 1 ? items[0] : null;
  }, "点击 4:3 分享卡片后，等待“直接编辑”确认按钮超时", 250);
  await safeClick(directEdit, "直接编辑视频号 4:3 分享卡片封面");
  const editor = await waitLoop(page, 60_000, async () => {
    const items = await visibleInFrames(page, "div.finder-common-dialog.edit-cover-dialog > div.weui-desktop-dialog__wrp");
    return items.length === 1 ? items[0] : null;
  }, "打开 4:3 分享卡片封面编辑 UI 后，上传控件未就绪", 250);
  const inputMatches = await attachedInFrames(page, "div.single-cover-uploader-wrap > input[type='file']");
  const triggers = await visibleInFrames(page, "div.single-cover-uploader-wrap > div.wrap");
  if (inputMatches.length !== 1 || triggers.length !== 1) throw new CoverUploadError("视频号 4:3 封面上传控件数量异常");
  const before = await mediaSignature(editor);
  setStage("上传 4:3 分享卡片封面");
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
  await safeClick(triggers[0], "打开视频号 4:3 封面文件选择器");
  await (await chooserPromise).setFiles(cover);
  const uploadResult = await waitLoop(page, 60_000, async () => {
    const cropConfirms = await visibleInFrames(page, "div.single-cover-uploader-wrap div.finder-common-dialog button.weui-desktop-btn_primary");
    if (cropConfirms.length === 1) return { cropConfirm: cropConfirms[0] };
    const current = await mediaSignature(editor);
    return current && current !== before ? { direct: true } : null;
  }, "4:3 文件已传入，但分享卡片封面预览没有更新", 250);
  if (uploadResult.cropConfirm) {
    await safeClick(uploadResult.cropConfirm, "确认视频号 4:3 封面裁剪");
    await waitForMediaChange(page, editor, before, 60_000);
  }
  setStage("确认 4:3 分享卡片封面");
  const outer = await waitLoop(page, 60_000, async () => {
    const items = await visibleInFrames(page, "div.finder-common-dialog.edit-cover-dialog > div.weui-desktop-dialog__wrp button.weui-desktop-btn_primary");
    return items.length === 1 ? items[0] : null;
  }, "等待视频号 4:3 外层封面确认按钮超时", 250);
  await safeClick(outer, "确认视频号 4:3 分享卡片封面");
}

async function uploadChannels(page, job, platform, log) {
  const cover = job.covers["3:4"];
  const horizontalVideo = Number(job.videoWidth) > Number(job.videoHeight);
  const horizontal = job.covers["4:3"];
  if (!cover || !fs.existsSync(cover)) throw new CoverUploadError("视频号缺少 3:4 封面文件");
  if (horizontalVideo && (!horizontal || !fs.existsSync(horizontal))) throw new CoverUploadError("视频号横屏视频缺少 4:3 封面文件");
  let stage = "等待视频上传完成";
  try {
    if (!(await page.evaluate(() => Boolean(window.__channelsVideoUploadConfirmed)))) throw new CoverUploadError("尚未确认视频文件真实上传完成，拒绝提前编辑封面");
    const entry = await waitLoop(page, 300_000, async () => { const items = await visibleInFrames(page, "div.cover-preview-wrap div.vertical-img-wrap"); return items.length === 1 ? items[0] : null; }, "视频已上传完成，但等待视频号封面编辑入口出现超时", 350);
    stage = "打开封面编辑器";
    await safeClick(entry, "打开视频号封面编辑器");
    const editor = await waitLoop(page, 60_000, async () => { const items = await visibleInFrames(page, "div.finder-common-dialog.edit-cover-dialog > div.weui-desktop-dialog__wrp"); return items.length === 1 ? items[0] : null; }, "打开编辑封面 UI 后，上传封面控件未就绪", 250);
    const inputMatches = await attachedInFrames(page, "div.single-cover-uploader-wrap > input[type='file']");
    const triggers = await visibleInFrames(page, "div.single-cover-uploader-wrap > div.wrap");
    if (inputMatches.length !== 1 || triggers.length !== 1) throw new CoverUploadError("视频号封面上传控件数量异常");
    const before = await mediaSignature(editor);
    stage = "上传 3:4 封面";
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 10_000 });
    await safeClick(triggers[0], "打开视频号封面文件选择器");
    await (await chooserPromise).setFiles(cover);
    const uploadResult = await waitLoop(page, 60_000, async () => {
      const cropConfirms = await visibleInFrames(page, "div.single-cover-uploader-wrap div.finder-common-dialog button.weui-desktop-btn_primary");
      if (cropConfirms.length === 1) return { cropConfirm: cropConfirms[0] };
      const current = await mediaSignature(editor);
      return current && current !== before ? { direct: true } : null;
    }, "文件已传入，但封面预览没有更新", 250);
    if (uploadResult.cropConfirm) {
      await safeClick(uploadResult.cropConfirm, "确认视频号封面裁剪");
      await waitForMediaChange(page, editor, before, 60_000);
    }
    stage = "确认封面";
    const outer = await waitLoop(page, 60_000, async () => { const items = await visibleInFrames(page, "div.finder-common-dialog.edit-cover-dialog > div.weui-desktop-dialog__wrp button.weui-desktop-btn_primary"); return items.length === 1 ? items[0] : null; }, "等待视频号外层封面确认按钮超时", 250);
    await safeClick(outer, "确认视频号封面");
    log(`[${platform.name}/${job.account}] 3:4 封面上传并确认完成`);
    if (horizontalVideo) {
      await uploadChannelsHorizontalCover(page, horizontal, value => { stage = value; });
      log(`[${platform.name}/${job.account}] 4:3 分享卡片封面上传并确认完成`);
    }
    log(`[${platform.name}/${job.account}] 视频号所需封面全部完成；最终“发表”按钮保留给人工操作`);
  } catch (error) { throw new CoverUploadError(`视频号${stage}失败：${error.message}`); }
}

async function confirmDefaultChannels(page, job, platform, log) {
  let stage = "等待视频上传完成";
  try {
    if (!(await page.evaluate(() => Boolean(window.__channelsVideoUploadConfirmed)))) throw new CoverUploadError("尚未确认视频文件真实上传完成，拒绝提前确认默认封面");
    const entry = await waitLoop(page, 300_000, async () => {
      const items = await visibleInFrames(page, "div.cover-preview-wrap div.vertical-img-wrap");
      return items.length === 1 ? items[0] : null;
    }, "视频已上传完成，但等待视频号默认封面入口出现超时", 350);
    stage = "打开平台默认封面弹窗";
    await safeClick(entry, "打开视频号默认封面弹窗");
    await waitLoop(page, 60_000, async () => {
      const items = await visibleInFrames(page, "div.finder-common-dialog.edit-cover-dialog > div.weui-desktop-dialog__wrp");
      return items.length === 1 ? items[0] : null;
    }, "打开视频号默认封面弹窗超时", 250);
    stage = "确认平台生成的 3:4 默认封面";
    const outer = await waitLoop(page, 60_000, async () => {
      const items = await visibleInFrames(page, "div.finder-common-dialog.edit-cover-dialog > div.weui-desktop-dialog__wrp button.weui-desktop-btn_primary");
      return items.length === 1 ? items[0] : null;
    }, "等待视频号 3:4 默认封面确认按钮超时", 250);
    await safeClick(outer, "确认视频号平台生成的 3:4 默认封面");
    log(`[${platform.name}/${job.account}] 已打开封面编辑并直接确认平台默认封面，未上传自定义文件；最终“发表”按钮保留给人工操作`);
  } catch (error) { throw new CoverUploadError(`视频号${stage}失败：${error.message}`); }
}

async function clickKuaishouCoverApplyCancelInFrame(frame) {
  const clicked = await frame.evaluate(() => {
    const groups = document.querySelectorAll("#microSupport .ant-modal-confirm-btns, .ant-modal-confirm-btns");
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const btnGroup = groups[index];
      const root = btnGroup.closest(".ant-modal-wrap")
        || btnGroup.closest(".ant-modal-confirm")
        || btnGroup.closest(".ant-modal-root");
      if (!root) continue;
      if (!/默认封面|将此封面应用/.test((root.textContent || "").replace(/\s+/g, ""))) continue;
      const cancelButton = btnGroup.querySelector("button.ant-btn-text")
        || Array.from(btnGroup.querySelectorAll("button")).find(button => (button.textContent || "").replace(/\s+/g, "") === "取消");
      if (!cancelButton) continue;
      cancelButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      cancelButton.click();
      return true;
    }
    return false;
  }).catch(() => false);
  if (clicked) {
    await frame.waitForTimeout(120);
    return true;
  }

  const cancel = frame.locator(
    "#microSupport .ant-modal-confirm-btns button.ant-btn-text, .ant-modal-confirm-btns button.ant-btn-text"
  ).filter({ hasText: /取\s*消/ }).last();
  if (!(await cancel.count())) return false;
  await cancel.click({ force: true, timeout: 3_000 });
  await frame.waitForTimeout(120);
  return true;
}

async function dismissKuaishouCoverApplyPromptInFrame(frame) {
  if (!(await isKuaishouCoverApplyPromptVisibleInFrame(frame))) return false;
  return clickKuaishouCoverApplyCancelInFrame(frame);
}

async function isKuaishouCoverApplyPromptVisibleInFrame(frame) {
  return frame.evaluate(() => {
    const roots = document.querySelectorAll("#microSupport .ant-modal-wrap, #microSupport .ant-modal-confirm, .ant-modal-wrap, .ant-modal-confirm");
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      const root = roots[index];
      const style = window.getComputedStyle(root);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (!/默认封面|将此封面应用/.test((root.textContent || "").replace(/\s+/g, ""))) continue;
      if (root.querySelector(".ant-modal-confirm-btns button.ant-btn-text, .ant-modal-confirm-btns button")) return true;
    }
    return false;
  }).catch(() => false);
}

async function isKuaishouCoverApplyPromptVisible(page) {
  for (const frame of page.frames()) {
    if (await isKuaishouCoverApplyPromptVisibleInFrame(frame)) return true;
  }
  return false;
}

export async function isKuaishouScheduleRadioReady(page) {
  const label = page.locator('[class*="publish-time-container"] label.ant-radio-wrapper:has(input.ant-radio-input[value="2"])').first();
  if (!(await label.count())) return false;
  if (!(await label.isVisible({ timeout: 150 }).catch(() => false))) return false;
  const radio = label.locator('input.ant-radio-input[value="2"]').first();
  return !(await radio.isDisabled().catch(() => true));
}

export async function waitForKuaishouPublishReady(page, log = () => {}, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let waitingLogged = false;
  while (Date.now() < deadline) {
    const error = await visibleUploadError(page);
    if (error) throw new CoverUploadError(error);
    await dismissKuaishouCoverApplyPrompt(page, log).catch(() => false);

    const processing = await page.evaluate(() => /上传中|处理中|转码中|正在上传|视频解析/.test(document.body?.innerText || "")).catch(() => false);
    if (processing) {
      if (!waitingLogged) {
        log("正在等待快手视频上传/处理完成");
        waitingLogged = true;
      }
      await page.waitForTimeout(200);
      continue;
    }

    if (await isKuaishouScheduleRadioReady(page)) {
      log("快手视频已处理完成，发布设置（含定时发布）已可操作");
      return true;
    }

    const publishSettingsVisible = await page.locator('text="发布设置"').first().isVisible({ timeout: 100 }).catch(() => false);
    const publishTimeVisible = await page.locator('text="发布时间"').first().isVisible({ timeout: 100 }).catch(() => false);
    if (publishSettingsVisible && publishTimeVisible) {
      if (!waitingLogged) {
        log("发布设置已显示，正在等待定时发布选项变为可点击");
        waitingLogged = true;
      }
      await page.waitForTimeout(200);
      continue;
    }

    if (!waitingLogged) {
      log("正在等待快手发布页加载完成");
      waitingLogged = true;
    }
    await page.waitForTimeout(200);
  }
  throw new CoverUploadError("等待快手视频处理完成及发布设置就绪超时");
}

const KUAISHOU_COVER_ENTRY_SELECTORS = [
  '[class*="_high-cover-editor-main"] [class*="_default-cover"] [class*="_cover-full-editor"]',
  '[class*="_default-cover"] [class*="_cover-full-editor"]',
  '[class*="_high-cover-editor-main"] [class*="_default-cover"]',
  '[class*="_high-cover-editor"] [class*="_default-cover"]',
  '[class*="_high-cover-editor"]',
  'button:has-text("上传封面")',
  'div:has-text("上传封面")',
  '[class*="preview"]:has-text("上传封面")',
  'button:has-text("设置封面")',
  'button:has-text("更换封面")',
  'text="设置封面"',
  'text="更换封面"',
  'text="上传封面"',
  '[class*="cover"]:has-text("设置封面")',
  '[class*="cover"]:has-text("更换封面")',
  '[class*="cover"]:has-text("上传封面")'
];

export async function findKuaishouCoverEntry(page, timeoutMs = 180_000) {
  return waitLoop(page, timeoutMs, async () => {
    for (const selector of KUAISHOU_COVER_ENTRY_SELECTORS) {
      const candidates = page.locator(selector);
      for (let index = 0; index < Math.min(await candidates.count(), 8); index += 1) {
        const candidate = candidates.nth(index);
        if (!(await candidate.isVisible({ timeout: 120 }).catch(() => false))) continue;
        return candidate;
      }
    }
    return null;
  }, "等待快手封面入口就绪超时", 350);
}

function kuaishouCoverModal(page) {
  return page.locator(".ant-modal-content").filter({ has: page.locator('[class*="_header-title"]') }).last();
}

export async function waitForKuaishouCoverModal(page, timeoutMs = 15_000) {
  const modal = kuaishouCoverModal(page);
  await modal.waitFor({ state: "visible", timeout: timeoutMs });
  return modal;
}

export async function switchKuaishouCoverToUploadTab(modal) {
  const uploadTab = modal.locator('[class*="_header-title-item"]').filter({ hasText: /^上传封面$/ }).first();
  await uploadTab.waitFor({ state: "visible", timeout: 10_000 });
  const active = await uploadTab.evaluate(element => /_header-title-item-active/.test(element.className)).catch(() => false);
  if (!active) {
    await safeClick(uploadTab, "切换快手上传封面标签");
    await modal.page().waitForTimeout(300);
  }
  await modal.locator('[class*="_cropper-upload"]').first().waitFor({ state: "visible", timeout: 10_000 });
}

async function findKuaishouCoverUploadInput(modal) {
  const scoped = modal.locator('[class*="_cropper-upload"] input[type="file"]').first();
  if (await scoped.count()) {
    await scoped.waitFor({ state: "attached", timeout: 10_000 });
    return scoped;
  }
  const uploadButton = modal.locator('button[class*="_upload-btn"]').filter({ hasText: /^上传图片$/ }).first();
  await uploadButton.waitFor({ state: "visible", timeout: 10_000 });
  await safeClick(uploadButton, "打开快手封面文件选择");
  const fallback = modal.locator('input[type="file"][accept*="image"], input[type="file"]').first();
  await fallback.waitFor({ state: "attached", timeout: 10_000 });
  return fallback;
}

async function waitForKuaishouCoverPreviewReady(modal, page, timeoutMs = 60_000) {
  const preview = modal.locator('[class*="_cutter-raw"], [class*="_cropper-main"] canvas, [class*="_cropper-upload"] img').first();
  const confirm = modal.locator('button[class*="_footer-btn"]').filter({ hasText: /^确认$/ }).first();
  const deadline = Date.now() + timeoutMs;
  let before = "";
  if (await preview.count()) before = await mediaSignature(preview).catch(() => "");
  while (Date.now() < deadline) {
    if (before && await preview.count()) {
      const after = await mediaSignature(preview).catch(() => "");
      if (after && after !== before) return;
    }
    if (await confirm.isEnabled().catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  if (!(await confirm.isEnabled().catch(() => false))) throw new Error("封面预览未就绪或确认按钮不可点击");
}

async function confirmKuaishouCoverModal(modal, page) {
  const confirm = modal.locator('button[class*="_footer-btn"]').filter({ hasText: /^确认$/ }).first();
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await waitForKuaishouCoverPreviewReady(modal, page, 30_000);
  if (!(await confirm.isEnabled().catch(() => false))) throw new Error("封面确认按钮当前不可点击");
  await safeClick(confirm, "确认快手封面");
  await modal.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
}

export async function dismissKuaishouCoverApplyPrompt(page, log = () => {}) {
  for (const frame of page.frames()) {
    if (!(await dismissKuaishouCoverApplyPromptInFrame(frame))) continue;
    log("已取消快手默认封面应用提示，继续设置定时发布");
    return true;
  }
  return false;
}

export async function ensureKuaishouCoverApplyPromptDismissed(page, log = () => {}, timeoutMs = 3_000, options = {}) {
  const appearanceGraceMs = options.appearanceGraceMs ?? Math.min(400, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const start = Date.now();
  let seenPrompt = false;
  while (Date.now() < deadline) {
    const visible = await isKuaishouCoverApplyPromptVisible(page);
    if (visible) {
      seenPrompt = true;
      log("检测到快手默认封面确认弹窗，正在点击取消");
      if (await dismissKuaishouCoverApplyPrompt(page, log)) {
        await page.waitForTimeout(80);
        if (!(await isKuaishouCoverApplyPromptVisible(page))) return true;
      }
    } else if (seenPrompt) {
      return true;
    } else if (Date.now() - start >= appearanceGraceMs) {
      return true;
    }
    await page.waitForTimeout(80);
  }
  if (await isKuaishouCoverApplyPromptVisible(page)) {
    log("快手默认封面确认弹窗仍未关闭");
    return false;
  }
  return true;
}

export async function waitAndDismissKuaishouCoverApplyPrompt(page, timeoutMs = 5_000, log = () => {}) {
  const deadline = Date.now() + timeoutMs;
  const start = Date.now();
  const appearanceWaitMs = Math.min(1_000, timeoutMs);
  let seenPrompt = false;
  while (Date.now() < deadline) {
    const visible = await isKuaishouCoverApplyPromptVisible(page);
    if (visible) {
      seenPrompt = true;
      log("检测到快手默认封面确认弹窗，正在点击取消");
      if (await dismissKuaishouCoverApplyPrompt(page, log)) {
        await page.waitForTimeout(80);
        if (!(await isKuaishouCoverApplyPromptVisible(page))) return true;
      }
    } else if (seenPrompt) {
      return true;
    } else if (Date.now() - start >= appearanceWaitMs) {
      return true;
    }
    await page.waitForTimeout(80);
  }
  if (await isKuaishouCoverApplyPromptVisible(page)) {
    log("快手默认封面确认弹窗仍未关闭");
    return false;
  }
  return true;
}

async function uploadKuaishou(page, job, platform, log) {
  const cover = job.covers["3:4"];
  if (!cover || !fs.existsSync(cover)) throw new CoverUploadError("快手缺少 3:4 封面文件");
  let stage = "打开封面入口";
  try {
    const entry = await findKuaishouCoverEntry(page);
    stage = "打开设置封面弹窗";
    await safeClick(entry, "打开快手设置封面弹窗");
    const modal = await waitForKuaishouCoverModal(page);
    stage = "切换上传封面标签";
    await switchKuaishouCoverToUploadTab(modal);
    const input = await findKuaishouCoverUploadInput(modal);
    stage = "上传 3:4 封面";
    await input.setInputFiles(cover);
    log(`[${platform.name}/${job.account}] 已选择封面文件：${cover}`);
    await waitForKuaishouCoverPreviewReady(modal, page, 60_000);
    stage = "确认封面";
    await confirmKuaishouCoverModal(modal, page);
    stage = "关闭默认封面应用提示";
    await waitAndDismissKuaishouCoverApplyPrompt(page, 5_000, message => log(`[${platform.name}/${job.account}] ${message}`));
    log(`[${platform.name}/${job.account}] 已上传并确认 3:4 封面`);
  } catch (error) { throw new CoverUploadError(`快手${stage}失败：${error.message}`); }
}

export async function uploadCovers(page, job, platform, log) {
  if (platform.key === "douyin") return uploadDouyin(page, job, platform, log);
  if (platform.key === "kuaishou") return uploadKuaishou(page, job, platform, log);
  if (platform.key === "channels") return uploadChannels(page, job, platform, log);
  if (platform.key === "bilibili") return uploadBilibili(page, job, platform, log);
}

export async function confirmDefaultCover(page, job, platform, log) {
  if (platform.key === "douyin") return confirmDefaultDouyin(page, job, platform, log);
  if (platform.key === "channels") return confirmDefaultChannels(page, job, platform, log);
  if (platform.key === "bilibili") return confirmDefaultBilibili(page, job, platform, log);
}

const COVER_SIGNATURE_SELECTORS = {
  douyin: ["div.coverControl-CjlzqC"],
  kuaishou: [
    '[class*="_high-cover-editor-main"] [class*="_default-cover"] img',
    '[class*="_default-cover"] img',
    '[class*="cover"] img',
    "text=设置封面",
    "text=更换封面",
    "text=上传封面"
  ],
  channels: ["div.cover-preview-wrap div.vertical-img-wrap", "text=设置封面", "text=更换封面", "text=上传封面"],
  bilibili: ["div.cover-main", "div.cover-empty", "div.cover-slot"]
};

export async function platformCoverSignature(page, key) {
  const pieces = [];
  for (const selector of COVER_SIGNATURE_SELECTORS[key]) {
    try {
      const nodes = page.locator(selector);
      for (let i = 0; i < Math.min(await nodes.count(), 12); i += 1) {
        const node = nodes.nth(i);
        if (await node.isVisible({ timeout: 100 })) pieces.push(await node.evaluate(element => element.outerHTML.slice(0, 5_000)));
      }
    } catch {}
  }
  return pieces.join("\n");
}

export async function waitForPlatformCoverChange(page, key, before, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const after = await platformCoverSignature(page, key);
    if (after && after !== before) return true;
    await page.waitForTimeout(350);
  }
  return false;
}
