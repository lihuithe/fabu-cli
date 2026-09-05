import { APP_VERSION } from "../src/app-meta.js";
import assert from "node:assert/strict";
import http from "node:http";
import test, { after } from "node:test";
import { chromium } from "playwright";
import { chromePath } from "../src/account-binding.js";

const portProbe = http.createServer();
await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
const testPort = portProbe.address().port;
await new Promise(resolve => portProbe.close(() => resolve()));
process.env.PORT = String(testPort);
const { server } = await import("../server.js");

const testAccounts = Object.fromEntries([
  ["douyin", "抖音测试账号"],
  ["xiaohongshu", "小红书测试账号"],
  ["channels", "视频号测试账号"],
  ["bilibili", "B站测试账号"]
].map(([key, nickname]) => [key, [{ id: `test-${key}`, platform_key: key, nickname, remark: "", avatar: "", bound: true, login_status: "valid" }]]));

async function routeTestAccounts(page) {
  await page.route("**/api/accounts", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, accounts: testAccounts })
  }));
}

if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
after(async () => {
  if (server.listening) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

test("服务可启动且健康接口返回四个平台", async () => {
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${testPort}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.name, "Publish Ready");
  assert.equal(body.version, APP_VERSION);
  assert.equal(body.runtime, `node ${process.version}`);
  assert.deepEqual(body.platforms, ["douyin", "xiaohongshu", "channels", "bilibili"]);
});

test("账号 API 可读取迁移后的四个平台状态", async () => {
  const response = await fetch(`http://127.0.0.1:${testPort}/api/accounts`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.deepEqual(Object.keys(body.accounts), ["douyin", "xiaohongshu", "channels", "bilibili"]);
  assert.equal(Object.values(body.accounts).every(Array.isArray), true);
});

test("Windows 文件选择器小窗准备接口可用", async () => {
  const response = await fetch(`http://127.0.0.1:${testPort}/api/ui/prepare-file-dialog`, { method: "POST" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.watcher_started, "boolean");
});

test("账号页与发布页使用多账号列表而不是固定坑位", async () => {
  const [accountsResponse, publishResponse, shellResponse, platformLinkResponse, platformLinkCssResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${testPort}/accounts`),
    fetch(`http://127.0.0.1:${testPort}/publish`),
    fetch(`http://127.0.0.1:${testPort}/static/core-shell.js`),
    fetch(`http://127.0.0.1:${testPort}/static/platform-link.js`),
    fetch(`http://127.0.0.1:${testPort}/static/platform-link.css`)
  ]);
  const accountsHtml = await accountsResponse.text();
  const publishHtml = await publishResponse.text();
  const shellScript = await shellResponse.text();
  const platformLinkScript = await platformLinkResponse.text();
  const platformLinkCss = await platformLinkCssResponse.text();
  assert.equal((accountsHtml.match(/绑定新账号/g) || []).length, 4);
  assert.match(accountsHtml, /自动采集真实昵称与头像/);
  assert.match(accountsHtml, /<body data-page="accounts">/);
  assert.doesNotMatch(accountsHtml, /id="publishForm"/);
  assert.match(publishHtml, /id="accountTargetList"/);
  assert.match(publishHtml, /<h1>发布Ready<\/h1>/);
  assert.match(publishHtml, /id="fixedTopic"[^>]*><small class="topic-field-hint">长期保留 · 发布时排第一<\/small>/);
  assert.match(platformLinkCss, /\.platform-title-modal\[hidden\]\{display:none\}/);
  assert.match(platformLinkCss, /\.platform-title-grid\{display:grid;grid-template-columns:1fr/);
  assert.match(publishHtml, /id="openPlatformTitles"/);
  assert.match(publishHtml, /id="platformTitleModal"[^>]*hidden/);
  assert.match(publishHtml, /data-small-file-dialog="(?:true|false)"/);
  assert.match(publishHtml, /href="\/accounts">管理平台账号<\/a>/);
  assert.doesNotMatch(publishHtml, /id="accountModal"/);
  assert.doesNotMatch(publishHtml, /class="target-card"/);
  assert.equal((publishHtml.match(/class="remove-cover"/g) || []).length, 3);
  assert.match(publishHtml, /点击或拖拽上传视频文件/);
  assert.match(publishHtml, /id="originalContent"[^>]*name="original"/);
  assert.match(publishHtml, /小红书声明原创/);
  assert.match(publishHtml, /勾选后，仅同步至小红书的原创声明/);
  assert.match(publishHtml, /id="channelsHideLocation"[^>]*name="channels_hide_location"/);
  assert.match(publishHtml, /视频号不显示位置/);
  assert.match(publishHtml, /id="channelsOriginal"[^>]*name="channels_original"/);
  assert.match(publishHtml, /视频号声明原创/);
  assert.match(publishHtml, /id="titleChannelsShort"[^>]*name="short_title_channels"[^>]*maxlength="16"/);
  assert.match(publishHtml, /id="scheduleEnabled"/);
  assert.match(publishHtml, /id="douyinScheduleDate"/);
  assert.match(publishHtml, /id="douyinScheduleHour"/);
  assert.match(publishHtml, /id="douyinScheduleMinute"/);
  assert.match(publishHtml, /id="xiaohongshuScheduleDate"[^>]*type="date"/);
  assert.match(publishHtml, /id="xiaohongshuScheduleTime"[^>]*type="hidden"/);
  assert.match(publishHtml, /id="channelsScheduleTime"[^>]*step="60"/);
  assert.match(publishHtml, /id="bilibiliScheduleMinute"/);
  assert.doesNotMatch(shellScript, /人工确认发布/);
  assert.match(platformLinkScript, /remove\.hidden=!file/);
});

test("平台独立标题通过小窗口编辑并默认继承通用标题", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);
    await page.goto(`http://127.0.0.1:${testPort}/publish`);

    assert.equal(await page.locator('.publish-fields .platform-title-field').count(), 0);
    assert.equal(await page.locator('#platformTitleSummary').innerText(), '默认使用通用标题');
    await page.click('#openPlatformTitles');
    await page.locator('#platformTitleModal').dispatchEvent('click');
    assert.equal(await page.locator('#platformTitleModal').evaluate(element => element.hidden), false);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#platformTitleModal').evaluate(element => element.hidden), true);
    await page.click('#openPlatformTitles');
    await page.fill('#titleDouyin', '抖音自定义标题');
    await page.click('#cancelPlatformTitles');
    assert.equal(await page.inputValue('#titleDouyin'), '');

    await page.click('#openPlatformTitles');
    await page.fill('#titleDouyin', '抖音自定义标题');
    await page.click('#savePlatformTitles');
    assert.equal(await page.locator('#platformTitleModal').evaluate(element => element.hidden), true);
    assert.equal(await page.locator('#platformTitleSummary').innerText(), '已自定义 1 项，其余使用通用标题');
    assert.equal(await page.inputValue('#titleDouyin'), '抖音自定义标题');
  } finally {
    await browser.close();
  }
});

test("每次选择、绑定或重新登录小红书账号都会提示风险", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    const accounts = structuredClone(testAccounts);
    accounts.xiaohongshu.push({
      id: "test-xiaohongshu-second",
      platform_key: "xiaohongshu",
      nickname: "小红书测试账号二",
      remark: "",
      avatar: "",
      bound: true,
      login_status: "valid"
    });
    await page.route("**/api/accounts", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, accounts })
    }));
    let bindingRequests = 0;
    await page.route("**/api/accounts/xiaohongshu/bind", route => {
      bindingRequests += 1;
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: "测试停止绑定" }) });
    });

    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    const xhsAccounts = page.locator('.publish-account-option input[data-platform="xiaohongshu"]:not(:disabled)');
    await xhsAccounts.nth(0).evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#xhsRiskModal').waitFor({ state: 'visible' });
    await page.click('#xhsRiskContinue');
    await xhsAccounts.nth(1).evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#xhsRiskModal').waitFor({ state: 'visible' });
    await page.click('#xhsRiskContinue');
    assert.equal(await xhsAccounts.nth(1).isChecked(), true);

    await page.goto(`http://127.0.0.1:${testPort}/accounts`);
    const firstBindingRequest = page.waitForRequest(request => request.url().endsWith('/api/accounts/xiaohongshu/bind'));
    await page.locator('.account-platform[data-key="xiaohongshu"] .add-account').click();
    await page.locator('#xhsRiskModal').waitFor({ state: 'visible' });
    await page.click('#xhsRiskContinue');
    await firstBindingRequest;
    assert.equal(bindingRequests, 1);
    assert.equal(await page.locator('#xhsRiskModal').evaluate(element => element.hidden), true);
    const secondBindingRequest = page.waitForRequest(request => request.url().endsWith('/api/accounts/xiaohongshu/bind'));
    await page.locator('.account-platform[data-key="xiaohongshu"] .rebind-account').first().click();
    await page.locator('#xhsRiskModal').waitFor({ state: 'visible' });
    await page.click('#xhsRiskContinue');
    await secondBindingRequest;
    assert.equal(bindingRequests, 2);
    assert.equal(await page.locator('#xhsRiskModal').evaluate(element => element.hidden), true);
  } finally {
    await browser.close();
  }
});

test("发布页可将拖入视频写入文件框并显示预览", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    const transfer = await page.evaluateHandle(() => {
      const value = new DataTransfer();
      value.items.add(new File([new Uint8Array([0, 0, 0, 24])], "拖拽测试.mp4", { type: "video/mp4" }));
      return value;
    });
    await page.dispatchEvent("#videoDrop", "dragenter", { dataTransfer: transfer });
    assert.equal(await page.locator("#videoDrop").evaluate(element => element.classList.contains("is-dragging")), true);
    await page.dispatchEvent("#videoDrop", "drop", { dataTransfer: transfer });
    await page.waitForFunction(() => document.querySelector("#video")?.files?.[0]?.name === "拖拽测试.mp4");
    assert.equal(await page.locator("#videoDrop").evaluate(element => element.classList.contains("is-dragging")), false);
    assert.equal(await page.locator("#videoDrop").evaluate(element => element.classList.contains("has-file")), true);
    assert.match(await page.locator("#videoPreviewName").innerText(), /^拖拽测试\.mp4 · (本地预览|已保存到本机临时草稿)$/);
    assert.equal(await page.locator("#videoPreviewState").evaluate(element => element.hidden), false);
    await page.locator("#video").evaluate(input => {
      input.files = new DataTransfer().files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await page.locator("#video").evaluate(input => input.files?.[0]?.name), "拖拽测试.mp4");
    assert.equal(await page.locator("#videoPreviewState").evaluate(element => element.hidden), false);
  } finally {
    await browser.close();
  }
});

test("文件选择器仅在 Windows 请求小窗准备，不依赖浏览器 UA", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const context = await browser.newContext({ userAgent: "CodexWebPreview/1.0" });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    const requests = [];
    page.on('request', request => { if (request.url().endsWith('/api/ui/prepare-file-dialog')) requests.push(request); });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#videoEmptyState").click();
    await chooserPromise;
    assert.equal(requests.length, process.platform === 'win32' ? 1 : 0);
  } finally {
    await browser.close();
  }
});

test("视频发布和图文发布使用统一的平台声明下拉组件", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);

    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    assert.equal(await page.locator(".declaration-card .ui-select").count(), 4);
    assert.equal(await page.locator(".declaration-card select.ui-select-native").count(), 4);
    const videoDouyinAccount = page.locator('.publish-account-option input[data-platform="douyin"]:not(:disabled)').first();
    await videoDouyinAccount.check({ force: true });
    const videoTrigger = page.locator('.declaration-card[data-platform="douyin"] .ui-select-trigger');
    await videoTrigger.click();
    assert.equal(await videoTrigger.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator('.declaration-card[data-platform="douyin"]').evaluate(card => card.classList.contains("select-open")), true);
    await page.locator('.declaration-card[data-platform="douyin"] .ui-select-option').filter({ hasText: "内容由AI生成" }).click();
    assert.equal(await page.inputValue('select[name="declaration_douyin"]'), "内容由AI生成");
    assert.match(await videoTrigger.innerText(), /内容由AI生成/);

    await page.goto(`http://127.0.0.1:${testPort}/image-text-publish`);
    assert.equal(await page.locator(".declaration-card .ui-select").count(), 3);
    assert.equal(await page.locator(".declaration-card select.ui-select-native").count(), 3);
    const imageDouyinAccount = page.locator('.publish-account-option input[data-platform="douyin"]:not(:disabled)').first();
    await imageDouyinAccount.check({ force: true });
    const imageTrigger = page.locator('.declaration-card[data-platform="douyin"] .ui-select-trigger');
    await imageTrigger.click();
    await page.locator('.declaration-card[data-platform="douyin"] .ui-select-option').filter({ hasText: "虚构演绎，仅供娱乐" }).click();
    assert.equal(await page.inputValue("#imageTextDouyinDeclaration"), "虚构演绎，仅供娱乐");
    assert.match(await imageTrigger.innerText(), /虚构演绎，仅供娱乐/);
  } finally {
    await browser.close();
  }
});

test("发布页清空按钮可重置本次内容并保留账号选择和固定标签", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);
    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    await page.fill("#title", "待清空标题");
    await page.fill("#fixedTopic", "小黑日报助手");
    await page.fill("#topics", "待清空话题");
    await page.fill("#intro", "待清空简介");
    await page.click('label[for="originalContent"]');
    await page.click('label[for="channelsHideLocation"]');
    const douyinAccount = page.locator('.publish-account-option input[data-platform="douyin"]:not(:disabled)').first();
    await douyinAccount.waitFor();
    await douyinAccount.evaluate((input) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('label[for="scheduleEnabled"]');
    const douyinMinimum = await page.locator("#douyinScheduleTime").evaluate(input => input.dataset.minimum);
    const [douyinDate, douyinClock] = douyinMinimum.split("T");
    const [douyinHour, douyinMinute] = douyinClock.split(":");
    await page.fill("#douyinScheduleDate", douyinDate);
    await page.selectOption("#douyinScheduleHour", douyinHour);
    await page.selectOption("#douyinScheduleMinute", douyinMinute);
    await page.locator('.declaration-card select').first().evaluate(select => {
      select.disabled = false;
      select.selectedIndex = 1;
    });
    await page.locator("#video").evaluate(input => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([0, 0, 0, 24])], "待清空.mp4", { type: "video/mp4" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator('.cover-card input').first().evaluate(input => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1, 2, 3])], "待清空.png", { type: "image/png" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await page.click("#clearPublishButton");
    await page.waitForFunction(() => document.querySelector('#clearPublishButton')?.textContent === '清空');

    assert.equal(await page.inputValue("#title"), "");
    assert.equal(await page.inputValue("#fixedTopic"), "小黑日报助手");
    assert.equal(await page.inputValue("#topics"), "");
    assert.equal(await page.inputValue("#intro"), "");
    assert.equal(await page.isChecked("#originalContent"), false);
    assert.equal(await page.isChecked("#channelsHideLocation"), false);
    assert.equal(await page.isChecked("#scheduleEnabled"), false);
    assert.equal(await page.inputValue("#douyinScheduleTime"), "");
    assert.equal(await page.inputValue("#xiaohongshuScheduleTime"), "");
    assert.equal(await page.inputValue("#channelsScheduleTime"), "");
    assert.equal(await page.isDisabled("#douyinScheduleTime"), true);
    assert.equal(await page.inputValue("#douyinScheduleDate"), "");
    assert.equal(await page.inputValue("#douyinScheduleHour"), "");
    assert.equal(await page.inputValue("#douyinScheduleMinute"), "");
    assert.equal(await page.inputValue("#bilibiliScheduleTime"), "");
    assert.equal(await page.isDisabled("#bilibiliScheduleTime"), true);
    assert.equal(await page.inputValue("#bilibiliScheduleDate"), "");
    assert.equal(await page.inputValue("#bilibiliScheduleHour"), "");
    assert.equal(await page.inputValue("#bilibiliScheduleMinute"), "");
    assert.equal(await page.locator("#titleCount").innerText(), "0 / 100");
    assert.equal(await page.locator("#introCount").innerText(), "0 / 1000");
    assert.equal(await page.locator("#video").evaluate(input => input.files.length), 0);
    assert.equal(await page.locator("#videoPreviewState").evaluate(element => element.hidden), true);
    assert.equal(await page.locator('.cover-card input').first().evaluate(input => input.files.length), 0);
    assert.equal(await page.locator('.cover-card').first().evaluate(card => card.classList.contains('has-file')), false);
    assert.equal(await page.locator('.declaration-card select').first().evaluate(select => select.selectedIndex), 0);
    assert.equal(await page.locator('.publish-account-option input:checked').count(), 1);
    assert.equal(await douyinAccount.isChecked(), true);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('publishFormDraftV1')), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('publishVideoDraftMetaV1')), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('publishFixedTopicV1')), "小黑日报助手");
    await page.reload();
    assert.equal(await page.inputValue("#fixedTopic"), "小黑日报助手");
  } finally {
    await browser.close();
  }
});

test("原创和视频号位置开关状态会随发布草稿恢复", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);
    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    assert.equal(await page.isChecked("#originalContent"), false);
    assert.equal(await page.isChecked("#channelsHideLocation"), false);
    await page.click('label[for="originalContent"]');
    await page.click('label[for="channelsHideLocation"]');
    await page.waitForFunction(() => {
      const draft = JSON.parse(sessionStorage.getItem("publishFormDraftV1") || "null");
      return draft?.original === true && draft?.channels_hide_location === true;
    });
    await page.reload();
    assert.equal(await page.isChecked("#originalContent"), true);
    assert.equal(await page.isChecked("#channelsHideLocation"), true);
  } finally {
    await browser.close();
  }
});

test("定时时间输入框整块点击都会打开原生时间选择器", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);
    await page.addInitScript(() => {
      window.schedulePickerOpenCount = 0;
      HTMLInputElement.prototype.showPicker = function showPicker() {
        if (this.id === "xiaohongshuScheduleDate") window.schedulePickerOpenCount += 1;
        if (this.id === "bilibiliScheduleDate") window.bilibiliSchedulePickerOpenCount = (window.bilibiliSchedulePickerOpenCount || 0) + 1;
      };
    });
    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    const xhsAccount = page.locator('.publish-account-option input[data-platform="xiaohongshu"]:not(:disabled)').first();
    await xhsAccount.waitFor();
    await xhsAccount.evaluate((input) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#xhsRiskContinue');
    await page.click('label[for="scheduleEnabled"]');
    await page.evaluate(() => { window.schedulePickerOpenCount = 0; });
    await page.click("#xiaohongshuScheduleDate", { position: { x: 20, y: 15 } });
    assert.equal(await page.evaluate(() => window.schedulePickerOpenCount), 1);
  } finally {
    await browser.close();
  }
});

test("勾选B站并开启定时发布时显示B站专用五分钟时间框", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);
    await page.addInitScript(() => {
      window.bilibiliSchedulePickerOpenCount = 0;
      HTMLInputElement.prototype.showPicker = function showPicker() {
        if (this.id === "bilibiliScheduleDate") window.bilibiliSchedulePickerOpenCount += 1;
      };
    });
    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    const biliAccount = page.locator('.publish-account-option input[data-platform="bilibili"]:not(:disabled)').first();
    await biliAccount.waitFor();
    await biliAccount.evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('.schedule-switch-copy');
    assert.equal(await page.isChecked('#scheduleEnabled'), false);
    await page.click('label[for="scheduleEnabled"]');
    assert.equal(await page.isChecked('#scheduleEnabled'), true);
    assert.equal(await page.locator('#scheduleFields').evaluate(element => element.hidden), false);
    assert.equal(await page.locator('.schedule-time-field').count(), 5);
    assert.equal(await page.locator('#scheduleFields').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
    assert.equal(await page.isDisabled('#bilibiliScheduleDate'), false);
    assert.equal(await page.isDisabled('#bilibiliScheduleHour'), false);
    assert.equal(await page.isDisabled('#bilibiliScheduleMinute'), false);
    assert.deepEqual(await page.locator('#bilibiliScheduleMinute option').evaluateAll(options => options.map(option => option.value)), ['', '00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
    assert.equal(await page.isDisabled('#douyinScheduleTime'), true);
    assert.equal(await page.isDisabled('#xiaohongshuScheduleTime'), true);
    assert.equal(await page.isDisabled('#channelsScheduleTime'), true);
    assert.equal(await page.evaluate(() => window.bilibiliSchedulePickerOpenCount), 0);
    await page.click('#bilibiliScheduleDate');
    assert.equal(await page.evaluate(() => window.bilibiliSchedulePickerOpenCount), 1);
    await page.fill('#bilibiliScheduleDate', '2026-08-11');
    await page.selectOption('#bilibiliScheduleHour', '16');
    await page.selectOption('#bilibiliScheduleMinute', '25');
    assert.equal(await page.inputValue('#bilibiliScheduleTime'), '2026-08-11T16:25');
  } finally {
    await browser.close();
  }
});

test("勾选抖音后独立发布时间只能选择两小时后至十四天内", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);
    await page.goto(`http://127.0.0.1:${testPort}/publish`);
    const douyinAccount = page.locator('.publish-account-option input[data-platform="douyin"]:not(:disabled)').first();
    await douyinAccount.waitFor();
    await douyinAccount.evaluate((input) => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('label[for="scheduleEnabled"]');
    const limits = await page.locator('#douyinScheduleTime').evaluate((input) => ({ min: input.dataset.minimum, max: input.dataset.maximum }));
    const minimumLead = new Date(limits.min).getTime() - Date.now();
    const maximumLead = new Date(limits.max).getTime() - Date.now();
    assert.equal(minimumLead >= 2 * 60 * 60 * 1000, true);
    assert.equal(minimumLead < 2 * 60 * 60 * 1000 + 2 * 60 * 1000, true);
    assert.equal(maximumLead <= 14 * 24 * 60 * 60 * 1000, true);
    assert.equal(maximumLead > 14 * 24 * 60 * 60 * 1000 - 2 * 60 * 1000, true);
    const [minimumDate, minimumClock] = limits.min.split('T');
    const [minimumHour, minimumMinute] = minimumClock.split(':');
    await page.fill('#douyinScheduleDate', minimumDate);
    const hourStates = await page.locator('#douyinScheduleHour option').evaluateAll(options => options.filter(option => option.value).map(option => ({ value: option.value, disabled: option.disabled, text: option.textContent })));
    assert.equal(hourStates.filter(option => Number(option.value) < Number(minimumHour)).every(option => option.disabled), true);
    assert.equal(hourStates.find(option => option.value === minimumHour).disabled, false);
    await page.selectOption('#douyinScheduleHour', minimumHour);
    const minuteStates = await page.locator('#douyinScheduleMinute option').evaluateAll(options => options.filter(option => option.value).map(option => ({ value: option.value, disabled: option.disabled, text: option.textContent })));
    assert.equal(minuteStates.filter(option => Number(option.value) < Number(minimumMinute)).every(option => option.disabled), true);
    assert.equal(minuteStates.find(option => option.value === minimumMinute).disabled, false);
    await page.selectOption('#douyinScheduleMinute', minimumMinute);
    assert.equal(await page.inputValue('#douyinScheduleTime'), limits.min);
    for (const selector of ['#xiaohongshuScheduleTime', '#channelsScheduleTime']) {
      const otherLimits = await page.locator(selector).evaluate((input) => ({ min: input.dataset.minimum || input.min, max: input.dataset.maximum || input.max }));
      const otherMinimumLead = new Date(otherLimits.min).getTime() - Date.now();
      const otherMaximumLead = new Date(otherLimits.max).getTime() - Date.now();
      const expectedMinimum = selector.includes('xiaohongshu') ? 60 * 60 * 1000 : 5 * 60 * 1000;
      assert.equal(otherMinimumLead >= expectedMinimum, true);
      assert.equal(otherMinimumLead < expectedMinimum + 2 * 60 * 1000, true);
      assert.equal(otherMaximumLead <= 15 * 24 * 60 * 60 * 1000, true);
      assert.equal(otherMaximumLead > 15 * 24 * 60 * 60 * 1000 - 2 * 60 * 1000, true);
    }
  } finally {
    await browser.close();
  }
});

test("任务控制页面已删除", async () => {
  const response = await fetch(`http://127.0.0.1:${testPort}/tasks`);
  assert.equal(response.status, 404);
});

test("发布任务列表 API 默认返回任务列表", async () => {
  const response = await fetch(`http://127.0.0.1:${testPort}/api/tasks`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(Array.isArray(body.tasks), true);
});

test("图文发布使用独立页面和独立任务命名空间", async () => {
  const [pageResponse, tasksResponse] = await Promise.all([
    fetch(`http://127.0.0.1:${testPort}/image-text-publish`),
    fetch(`http://127.0.0.1:${testPort}/api/image-text/tasks`)
  ]);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /data-page="image-text-publish"/);
  assert.equal(tasksResponse.status, 200);
  const tasks = await tasksResponse.json();
  assert.equal(tasks.success, true);
  assert.deepEqual(tasks.tasks, []);
});

test("图文发布页支持多图预览、标题填写、账号选择和独立任务提交", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await routeTestAccounts(page);
    let submittedBody = "";
    await page.route("**/api/image-text/tasks", async route => {
      submittedBody = route.request().postDataBuffer()?.toString("utf8") || "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, task_id: "mock-image-text-task", total: 3, image_count: 2 })
      });
    });
    await page.route("**/api/image-text/tasks/mock-image-text-task", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "mock-image-text-task",
        status: "completed",
        total: 3,
        finished: 3,
        failed: 0,
        message: "图文资料填写完成",
        results: [
          { platform_key: "douyin", platform: "抖音", account_id: "test-douyin", account: "抖音测试账号", success: true },
          { platform_key: "xiaohongshu", platform: "小红书", account_id: "test-xiaohongshu", account: "小红书测试账号", success: true },
          { platform_key: "channels", platform: "视频号", account_id: "test-channels", account: "视频号测试账号", success: true }
        ]
      })
    }));
    await page.goto(`http://127.0.0.1:${testPort}/image-text-publish`);
    assert.equal(await page.getAttribute("#images", "multiple"), "");
    assert.equal(await page.locator("#imageTextDouyinCover").count(), 0);
    assert.equal(await page.locator(".image-text-cover-section").count(), 0);
    const imageColumnBox = await page.locator(".image-column").boundingBox();
    const publishFieldsBox = await page.locator(".publish-fields").boundingBox();
    assert.ok(publishFieldsBox.y >= imageColumnBox.y + imageColumnBox.height, "图片上传区应位于内容输入区上方");
    assert.ok(Math.abs(publishFieldsBox.width - imageColumnBox.width) < 1, "图片上传区与内容输入区应保持等宽");
    await page.setInputFiles("#images", [
      { name: "first.png", mimeType: "image/png", buffer: Buffer.from("first-image") },
      { name: "second.jpg", mimeType: "image/jpeg", buffer: Buffer.from("second-image") },
      { name: "third.png", mimeType: "image/png", buffer: Buffer.from("third-image") },
      { name: "fourth.jpg", mimeType: "image/jpeg", buffer: Buffer.from("fourth-image") },
      { name: "fifth.png", mimeType: "image/png", buffer: Buffer.from("fifth-image") }
    ]);
    assert.equal(await page.locator(".image-preview-card").count(), 5);
    assert.equal(await page.locator(".image-add-tile").count(), 1);
    assert.deepEqual(await page.locator(".image-preview-order").allInnerTexts(), ["1", "2", "3", "4", "5"]);
    assert.match(await page.locator(".image-preview-card img").nth(1).getAttribute("alt"), /second\.jpg/);
    assert.deepEqual(await page.locator(".image-preview-strip").evaluate(element => ({
      wrap: getComputedStyle(element).flexWrap,
      overflowX: getComputedStyle(element).overflowX
    })), { wrap: "wrap", overflowX: "visible" });
    assert.equal(await page.locator("#imageCount").innerText(), "5 / 18");
    await page.click("#clearImageTextButton");
    assert.equal(await page.locator(".image-preview-card").count(), 0);
    assert.match(await page.locator("#toast").innerText(), /已清空本次图文内容/);
    assert.deepEqual(await page.evaluate(() => ({
      form: sessionStorage.getItem("imageTextFormDraftV1"),
      images: sessionStorage.getItem("imageTextImageDraftMetaV1")
    })), { form: null, images: null });
    const portraitImage = Buffer.from((await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 400;
      canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    })).split(",")[1], "base64");
    await page.setInputFiles("#images", [
      { name: "first.png", mimeType: "image/png", buffer: portraitImage },
      { name: "second.jpg", mimeType: "image/jpeg", buffer: Buffer.from("second-image") }
    ]);
    await page.fill("#imageTextTitle", "通用图文标题");
    await page.fill("#imageTextFixedTopic", "长期固定标签");
    await page.fill("#imageTextTopics", "#本次标签");
    await page.fill("#imageTextContent", "图文正文内容");
    await page.click("#openImageTextPlatformTitles");
    await page.locator("#imageTextPlatformTitleModal").dispatchEvent("click");
    assert.equal(await page.locator("#imageTextPlatformTitleModal").evaluate(element => element.hidden), false);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#imageTextPlatformTitleModal").evaluate(element => element.hidden), true);
    await page.click("#openImageTextPlatformTitles");
    await page.fill("#imageTextTitleDouyin", "抖音图文标题");
    await page.fill("#imageTextTitleChannelsShort", "视频号短标题");
    await page.click("#saveImageTextPlatformTitles");
    assert.match(await page.locator("#imageTextPlatformTitleSummary").innerText(), /已自定义 1 个平台标题/);
    assert.equal(await page.locator(".image-text-account-groups .publish-account-group").count(), 3);
    assert.equal(await page.locator('.publish-account-group[data-platform="bilibili"]').count(), 0);
    assert.equal(await page.isDisabled("#imageTextDouyinDeclaration"), true);
    assert.equal(await page.isDisabled("#imageTextXhsDeclaration"), true);
    assert.equal(await page.isDisabled("#imageTextChannelsDeclaration"), true);
    assert.equal(await page.inputValue("#imageTextXhsDeclaration"), "虚构演绎，仅供娱乐");
    assert.deepEqual(await page.locator("#imageTextXhsDeclaration option:not([disabled])").allInnerTexts(), [
      "虚构演绎，仅供娱乐",
      "笔记含AI合成内容",
      "内容包含营销广告",
      "内容来源声明"
    ]);
    await page.click('.publish-account-option:has(input[data-platform="douyin"])');
    await page.click('.publish-account-option:has(input[data-platform="xiaohongshu"])');
    await page.click("#imageTextXhsRiskContinue");
    await page.click('.publish-account-option:has(input[data-platform="channels"])');
    assert.equal(await page.isDisabled("#imageTextDouyinDeclaration"), false);
    assert.equal(await page.isDisabled("#imageTextXhsDeclaration"), false);
    assert.equal(await page.isDisabled("#imageTextChannelsDeclaration"), false);
    assert.equal(await page.isDisabled("#imageTextXhsOriginal"), false);
    assert.equal(await page.isDisabled("#imageTextChannelsHideLocation"), false);
    assert.equal(await page.isDisabled("#imageTextChannelsOriginal"), false);
    await page.selectOption("#imageTextDouyinDeclaration", "内容由AI生成");
    await page.selectOption("#imageTextXhsDeclaration", "笔记含AI合成内容");
    await page.selectOption("#imageTextChannelsDeclaration", "含AI生成内容");
    await page.click('label[for="imageTextXhsOriginal"]');
    await page.click('label[for="imageTextChannelsHideLocation"]');
    await page.click('label[for="imageTextChannelsOriginal"]');
    await page.click('label[for="imageTextScheduleEnabled"]');
    const imageTextScheduleLimits = await page.evaluate(() => ({
      common: {
        min: document.getElementById("imageTextCommonScheduleTime").dataset.minimum,
        max: document.getElementById("imageTextCommonScheduleTime").dataset.maximum,
        dateMin: document.getElementById("imageTextCommonScheduleDate").min,
        dateMax: document.getElementById("imageTextCommonScheduleDate").max,
        minutes: [...document.getElementById("imageTextCommonScheduleMinute").options].filter(option => option.value).map(option => option.value),
      },
      douyin: {
        min: document.getElementById("imageTextDouyinScheduleTime").dataset.minimum,
        max: document.getElementById("imageTextDouyinScheduleTime").dataset.maximum,
        minutes: [...document.getElementById("imageTextDouyinScheduleMinute").options].filter(option => option.value).map(option => option.value),
      },
      xiaohongshu: {
        min: document.getElementById("imageTextXhsScheduleTime").dataset.minimum,
        max: document.getElementById("imageTextXhsScheduleTime").dataset.maximum,
        minutes: [...document.getElementById("imageTextXhsScheduleMinute").options].filter(option => option.value).map(option => option.value),
      },
      channels: {
        min: document.getElementById("imageTextChannelsScheduleTime").dataset.minimum,
        max: document.getElementById("imageTextChannelsScheduleTime").dataset.maximum,
        dateMin: document.getElementById("imageTextChannelsScheduleDate").min,
        dateMax: document.getElementById("imageTextChannelsScheduleDate").max,
        minutes: [...document.getElementById("imageTextChannelsScheduleMinute").options].filter(option => option.value).map(option => option.value),
      },
    }));
    assert.deepEqual(imageTextScheduleLimits.common.minutes, ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
    assert.equal(imageTextScheduleLimits.douyin.minutes.length, 60);
    assert.equal(imageTextScheduleLimits.xiaohongshu.minutes.length, 60);
    assert.equal(imageTextScheduleLimits.channels.minutes.length, 60);
    assert.equal(imageTextScheduleLimits.common.dateMin, imageTextScheduleLimits.common.min.slice(0, 10));
    assert.equal(imageTextScheduleLimits.common.dateMax, imageTextScheduleLimits.common.max.slice(0, 10));
    assert.equal(new Date(imageTextScheduleLimits.common.min).getTime() - Date.now() >= 2 * 60 * 60 * 1000, true);
    assert.equal(new Date(imageTextScheduleLimits.douyin.min).getTime() - Date.now() >= 2 * 60 * 60 * 1000, true);
    assert.equal(new Date(imageTextScheduleLimits.xiaohongshu.min).getTime() - Date.now() >= 60 * 60 * 1000, true);
    assert.equal(new Date(imageTextScheduleLimits.channels.min).getTime() - Date.now() >= 5 * 60 * 1000, true);
    assert.equal(imageTextScheduleLimits.channels.dateMin, imageTextScheduleLimits.channels.min.slice(0, 10));
    assert.equal(imageTextScheduleLimits.channels.dateMax, imageTextScheduleLimits.channels.max.slice(0, 10));
    const [channelsMinimumDate, channelsMinimumClock] = imageTextScheduleLimits.channels.min.split("T");
    const [channelsMinimumHour] = channelsMinimumClock.split(":");
    await page.fill("#imageTextChannelsScheduleDate", channelsMinimumDate);
    await page.selectOption("#imageTextChannelsScheduleHour", channelsMinimumHour);
    const channelsPastOptionsDisabled = await page.evaluate((minimum) => {
      const minimumTimestamp = new Date(minimum).getTime();
      const date = document.getElementById("imageTextChannelsScheduleDate").value;
      const hourOptions = [...document.getElementById("imageTextChannelsScheduleHour").options].filter(option => option.value);
      const minuteOptions = [...document.getElementById("imageTextChannelsScheduleMinute").options].filter(option => option.value);
      const selectedHour = document.getElementById("imageTextChannelsScheduleHour").value;
      return hourOptions.every(option => {
        const hourEnd = new Date(`${date}T${option.value}:59`).getTime();
        return hourEnd >= minimumTimestamp || option.disabled;
      }) && minuteOptions.every(option => {
        const timestamp = new Date(`${date}T${selectedHour}:${option.value}`).getTime();
        return timestamp >= minimumTimestamp || option.disabled;
      });
    }, imageTextScheduleLimits.channels.min);
    assert.equal(channelsPastOptionsDisabled, true);
    const scheduledDate = new Date(Math.ceil((Date.now() + 3 * 60 * 60 * 1000) / (5 * 60 * 1000)) * 5 * 60 * 1000);
    const pad = value => String(value).padStart(2, "0");
    const scheduledValue = `${scheduledDate.getFullYear()}-${pad(scheduledDate.getMonth() + 1)}-${pad(scheduledDate.getDate())}T${pad(scheduledDate.getHours())}:${pad(scheduledDate.getMinutes())}`;
    const [scheduledDay, scheduledClock] = scheduledValue.split("T");
    const [scheduledHour, scheduledMinute] = scheduledClock.split(":");
    await page.fill("#imageTextCommonScheduleDate", scheduledDay);
    await page.selectOption("#imageTextCommonScheduleHour", scheduledHour);
    await page.selectOption("#imageTextCommonScheduleMinute", scheduledMinute);
    assert.equal(await page.inputValue("#imageTextCommonScheduleTime"), scheduledValue);
    await page.waitForFunction((expectedSchedule) => {
      const draft = JSON.parse(sessionStorage.getItem("imageTextFormDraftV1") || "null");
      const images = JSON.parse(sessionStorage.getItem("imageTextImageDraftMetaV1") || "[]");
      return draft?.fields?.imageTextCommonScheduleTime === expectedSchedule && images.length === 2;
    }, scheduledValue);
    await page.getByRole("link", { name: "视频发布", exact: true }).click();
    await page.getByRole("link", { name: "图文发布", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".image-preview-card").length === 2
      && document.querySelectorAll(".publish-account-option input:checked").length === 3);
    assert.deepEqual(await page.locator(".image-preview-card img").evaluateAll(images => images.map(image => image.alt)), [
      "第 1 张图片：first.png",
      "第 2 张图片：second.jpg"
    ]);
    assert.equal(await page.inputValue("#imageTextTitle"), "通用图文标题");
    assert.equal(await page.inputValue("#imageTextFixedTopic"), "长期固定标签");
    assert.equal(await page.inputValue("#imageTextTopics"), "#本次标签");
    assert.equal(await page.inputValue("#imageTextContent"), "图文正文内容");
    assert.equal(await page.inputValue("#imageTextTitleDouyin"), "抖音图文标题");
    assert.equal(await page.inputValue("#imageTextTitleChannelsShort"), "视频号短标题");
    assert.equal(await page.inputValue("#imageTextDouyinDeclaration"), "内容由AI生成");
    assert.equal(await page.inputValue("#imageTextXhsDeclaration"), "笔记含AI合成内容");
    assert.equal(await page.inputValue("#imageTextChannelsDeclaration"), "含AI生成内容");
    assert.equal(await page.isChecked("#imageTextXhsOriginal"), true);
    assert.equal(await page.isChecked("#imageTextChannelsHideLocation"), true);
    assert.equal(await page.isChecked("#imageTextChannelsOriginal"), true);
    assert.equal(await page.isChecked("#imageTextScheduleEnabled"), true);
    assert.equal(await page.inputValue("#imageTextCommonScheduleTime"), scheduledValue);
    const invalidFields = await page.locator("#imageTextForm").evaluate(form => [...form.elements].filter(element => typeof element.checkValidity === "function" && !element.checkValidity()).map(element => ({ id: element.id, name: element.name, message: element.validationMessage })));
    assert.deepEqual(invalidFields, []);
    await page.click("#startButton");
    await page.waitForTimeout(250);
    assert.notEqual(submittedBody, "", await page.locator("#submitHint").innerText());
    await page.locator("#imageTextCompletionModal").waitFor({ state: "visible" });
    assert.match(submittedBody, /first\.png/);
    assert.match(submittedBody, /second\.jpg/);
    assert.doesNotMatch(submittedBody, /cover_douyin/);
    assert.match(submittedBody, /test-douyin/);
    assert.match(submittedBody, /test-xiaohongshu/);
    assert.match(submittedBody, /test-channels/);
    assert.match(submittedBody, /抖音图文标题/);
    assert.match(submittedBody, /视频号短标题/);
    assert.match(submittedBody, /内容由AI生成/);
    assert.match(submittedBody, /笔记含AI合成内容/);
    assert.match(submittedBody, /含AI生成内容/);
    assert.match(submittedBody, /name="original"/);
    assert.match(submittedBody, /name="channels_hide_location"/);
    assert.match(submittedBody, /name="channels_original"/);
    assert.match(submittedBody, /name="schedule_enabled"/);
    assert.match(submittedBody, new RegExp(scheduledValue.replace(/[-:]/g, "[-:]*")));
    assert.equal(await page.locator("#imageTextCompletionTitle").innerText(), "图文资料处理完成");
  } finally {
    await browser.close();
  }
});

test("图文任务明确拒绝B站目标", async () => {
  const form = new FormData();
  form.append("images", new Blob(["image"], { type: "image/png" }), "test.png");
  form.append("targets", JSON.stringify([{ platform_key: "bilibili", account_id: "test-bilibili" }]));
  form.append("title", "测试标题");
  const response = await fetch(`http://127.0.0.1:${testPort}/api/image-text/tasks`, { method: "POST", body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).detail, /仅支持抖音、小红书和视频号/);
});

test("发布任务按平台和账号 ID 校验目标", async () => {
  const form = new FormData();
  form.append("video", new Blob(["video"]), "test.mp4");
  form.append("targets", JSON.stringify([{ platform_key: "douyin", account_id: "missing-test-account" }]));
  form.append("title", "测试标题");
  form.append("declaration_douyin", "无需添加自主声明");
  const response = await fetch(`http://127.0.0.1:${testPort}/api/tasks`, { method: "POST", body: form });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.detail, /账号不存在|登录状态已丢失/);
});


test("Web版移除登录、订阅与更新接口，视频和图文直接进入业务校验", async () => {
  for (const [method, route] of [
    ['GET', '/login'], ['GET', '/subscription'], ['GET', '/api/session'],
    ['POST', '/api/auth/login'], ['POST', '/api/auth/register'], ['POST', '/api/auth/logout'],
    ['GET', '/api/payments'], ['POST', '/api/payments'], ['GET', '/api/app/version']
  ]) {
    assert.equal((await fetch(`http://127.0.0.1:${testPort}${route}`, { method })).status, 404, route);
  }
  for (const [route, message] of [['/api/tasks', /请选择视频文件/], ['/api/image-text/tasks', /请至少选择一张图文图片/]]) {
    const create = await fetch(`http://127.0.0.1:${testPort}${route}`, { method: 'POST' });
    assert.equal(create.status, 400);
    assert.match((await create.json()).detail, message);
    const retry = await fetch(`http://127.0.0.1:${testPort}${route}/missing/retry-failed`, { method: 'POST' });
    assert.equal(retry.status, 404);
    assert.match((await retry.json()).detail, /任务不存在/);
  }
});

test("三个工作台页面直接打开，没有软件登录更新请求和残留控件", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    const errors = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['/accounts', '/publish', '/image-text-publish']) {
      await page.goto(`http://127.0.0.1:${testPort}${route}`, { waitUntil: 'networkidle' });
      assert.equal(new URL(page.url()).pathname, route);
      assert.equal(await page.locator('.sidebar .nav-link').count(), 3);
      assert.equal(await page.locator('#shellLogout, #shellEmail, #versionButton, #updateBanner, #subscriptionRequiredModal').count(), 0);
      if (route !== '/accounts') {
        assert.equal(await page.locator('#startButton').getAttribute('data-subscription-locked'), null);
        await page.locator('form').first().evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await page.locator('#toast').waitFor({ state: 'visible' });
      }
    }
    assert.deepEqual(requests.filter(route => /\/api\/(session|auth|payments|app\/version)/.test(route)), []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
