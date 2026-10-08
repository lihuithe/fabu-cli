import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { chromePath } from "../src/account-binding.js";
import { channelsImageTextContent, IMAGE_TEXT_PLATFORM_KEYS, IMAGE_TEXT_PLATFORMS, isImageTextPlatform } from "../src/image-text-platforms.js";
import { IMAGE_TEXT_SUBMIT_PLATFORMS, ImageTextChromeRunner, openImageTextMode } from "../src/image-text-runner.js";
import { CAPABILITIES, normalizeTargets, parseTask } from "../src/task-schema.js";
import { submitAndVerify, verifySubmission } from "../src/submission.js";
import { DateTime } from "luxon";

test("图文发布只包含抖音、快手和视频号", () => {
  assert.deepEqual(IMAGE_TEXT_PLATFORM_KEYS, ["douyin", "kuaishou", "channels"]);
  assert.deepEqual(Object.keys(IMAGE_TEXT_PLATFORMS), ["douyin", "kuaishou", "channels"]);
  assert.equal(isImageTextPlatform("douyin"), true);
  assert.equal(isImageTextPlatform("bilibili"), false);
});

test("三个图文平台均配置独立入口和图片上传选择器", () => {
  for (const platform of Object.values(IMAGE_TEXT_PLATFORMS)) {
    assert.match(platform.url, /^https:\/\//);
    assert.equal(platform.modeSelectors.length > 0, true);
    assert.equal(platform.imageInputs.length > 0, true);
    assert.equal(platform.imageInputs.every(selector => !selector.includes("video")), true);
  }
  assert.equal(IMAGE_TEXT_PLATFORMS.channels.titleRequired, true);
  assert.equal(IMAGE_TEXT_PLATFORMS.channels.titles[0], 'input[placeholder*="填写标题"][placeholder*="22"]');
  assert.equal(IMAGE_TEXT_PLATFORMS.channels.titles.some(selector => selector.includes("post-short-title-wrap")), false);
});

test("视频号图文描述不写标题且标签单独成行", () => {
  assert.equal(channelsImageTextContent("正文"), "正文");
  assert.equal(channelsImageTextContent(""), "");
  assert.equal(
    channelsImageTextContent("正文", ["小黑日报助手", "#小黑444", "小黑"]),
    "正文\n#小黑日报助手 #小黑444 #小黑"
  );
  assert.equal(channelsImageTextContent("", ["默认标签", "其他标签"]), "#默认标签 #其他标签");
});

test("图文模式会跳过隐藏的重复标签并点击真实可见入口", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="creator-tab" aria-hidden="true" style="position:absolute;inset:0;z-index:-1"><span>发布图文</span></div>
      <div class="creator-tab" id="real-tab"><span>发布图文</span></div>
      <script>
        document.getElementById('real-tab').addEventListener('click', () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = '.jpg,.jpeg,.png,.webp';
          document.body.appendChild(input);
        });
      </script>
    `);
    const input = await openImageTextMode(page, IMAGE_TEXT_PLATFORMS.kuaishou);
    assert.ok(input);
    assert.equal(await input.getAttribute("accept"), ".jpg,.jpeg,.png,.webp");
    assert.equal(await page.locator('input[type="file"]').count(), 1);
  } finally {
    await browser.close();
  }
});

test("视频号侧栏折叠为图标时仍会点击图文入口并复用上传区域", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <ul><li class="finder-ui-desktop-menu__item finder-ui-desktop-menu__sub__wrp" id="content-root">
        <a class="finder-ui-desktop-menu__link finder-ui-desktop-menu__sub__link" id="content-nav" style="display:block;width:48px;height:48px">
          <span class="finder-ui-desktop-menu__name"><span>内容管理</span></span>
        </a>
        <ul class="finder-ui-desktop-sub-menu" id="content-submenu" style="display:none">
          <li class="finder-ui-desktop-sub-menu__item">
            <a class="finder-ui-desktop-menu__link finder-ui-desktop-menu__only-icon" id="channels-image-nav" href="javascript:;" style="display:block;width:48px;height:48px">
              <span class="finder-ui-desktop-menu__name"><span>图文</span></span>
            </a>
          </li>
        </ul>
      </li></ul>
      <div id="page-content"></div>
      <script>
        let contentClicks = 0;
        let imageClicks = 0;
        let createClicks = 0;
        document.getElementById('content-nav').addEventListener('click', () => {
          contentClicks += 1;
        });
        document.getElementById('channels-image-nav').addEventListener('click', () => {
          imageClicks += 1;
          document.getElementById('channels-image-nav').classList.add('finder-ui-desktop-menu__link_current');
          document.getElementById('page-content').innerHTML = '<button id="create-image">发表图文</button>';
          document.getElementById('create-image').addEventListener('click', () => {
            createClicks += 1;
            const upload = document.createElement('div');
            upload.className = 'ant-upload ant-upload-drag';
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = 'image/*';
            upload.appendChild(input);
            document.body.appendChild(upload);
          });
        });
        window.channelsNavigationClicks = () => ({ contentClicks, imageClicks, createClicks });
      </script>
    `);
    const input = await openImageTextMode(page, IMAGE_TEXT_PLATFORMS.channels);
    assert.ok(input);
    assert.equal(await input.getAttribute("multiple"), "");
    assert.equal(await page.locator(".ant-upload.ant-upload-drag input[type=file]").count(), 1);
    assert.deepEqual(await page.evaluate(() => window.channelsNavigationClicks()), { contentClicks: 1, imageClicks: 1, createClicks: 1 });
  } finally {
    await browser.close();
  }
});

test("视频页和图文页上传框相同时必须先确认图文模式再上传", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <ul><li class="finder-ui-desktop-menu__item finder-ui-desktop-menu__sub__wrp" id="content-root">
        <a class="finder-ui-desktop-menu__link finder-ui-desktop-menu__sub__link" id="content-nav"><span class="finder-ui-desktop-menu__name"><span>内容管理</span></span></a>
        <ul class="finder-ui-desktop-sub-menu" id="content-submenu" style="display:none">
          <li class="finder-ui-desktop-sub-menu__item"><a class="finder-ui-desktop-menu__link finder-ui-desktop-menu__link_current" id="video-nav"><span class="finder-ui-desktop-menu__name"><span>视频</span></span></a></li>
          <li class="finder-ui-desktop-sub-menu__item"><a class="finder-ui-desktop-menu__link finder-ui-desktop-menu__only-icon" id="image-nav"><span class="finder-ui-desktop-menu__name"><span>图文</span></span></a></li>
        </ul>
      </li></ul>
      <div id="page-content"><div class="ant-upload ant-upload-drag"><input id="shared-upload" type="file" accept="video/*" multiple></div></div>
      <script>
        let contentClicks = 0;
        let imageClicks = 0;
        let createClicks = 0;
        document.getElementById('content-nav').addEventListener('click', () => {
          contentClicks += 1;
          document.getElementById('content-submenu').style.display = 'block';
        });
        document.getElementById('image-nav').addEventListener('click', () => {
          imageClicks += 1;
          document.getElementById('video-nav').classList.remove('finder-ui-desktop-menu__link_current');
          document.getElementById('image-nav').classList.add('finder-ui-desktop-menu__link_current');
          document.getElementById('page-content').innerHTML = '<button id="create-image">发表图文</button>';
          document.getElementById('create-image').addEventListener('click', () => {
            createClicks += 1;
            document.getElementById('page-content').innerHTML = '<div class="ant-upload ant-upload-drag"><input id="shared-upload" type="file" accept="image/*" multiple></div>';
          });
        });
        window.navigationClicks = () => ({ contentClicks, imageClicks, createClicks });
      </script>
    `);
    const input = await openImageTextMode(page, IMAGE_TEXT_PLATFORMS.channels);
    assert.ok(input);
    assert.equal(await input.getAttribute("id"), "shared-upload");
    assert.deepEqual(await page.evaluate(() => window.navigationClicks()), { contentClicks: 1, imageClicks: 1, createClicks: 1 });
    assert.equal(await page.locator("#image-nav").evaluate(element => element.classList.contains("finder-ui-desktop-menu__link_current")), true);
  } finally {
    await browser.close();
  }
});

// ---- 抖音图文自动最终发布（本地改动）----

const accounts = { getAccount: (platform, id) => ({ nickname: `${platform}-${id}` }) };
const imageTask = (target, extra = {}) => parseTask({ type: "image_text", action: "submit", media: { images: ["a.png"] }, content: { title: "图文标题", description: "图文正文内容" }, targets: [target], ...extra });

test("能力表只对抖音图文开放 submit，快手、视频号仍只支持 prepare，B站不支持图文", () => {
  assert.deepEqual(IMAGE_TEXT_SUBMIT_PLATFORMS, ["douyin"]);
  assert.equal(CAPABILITIES.douyin.image_text.submit, true);
  assert.equal(CAPABILITIES.douyin.image_text.prepare, true);
  assert.equal(CAPABILITIES.douyin.image_text.submission_verification, "visible_platform_receipt");
  for (const key of ["kuaishou", "channels"]) {
    assert.equal(CAPABILITIES[key].image_text.prepare, true);
    assert.equal(CAPABILITIES[key].image_text.submit, false);
  }
  assert.equal(CAPABILITIES.bilibili.image_text.prepare, false);
  assert.equal(CAPABILITIES.bilibili.image_text.submit, false);
});

test("抖音图文 submit 任务被规范化为 directPublish，其他平台的图文 submit 明确拒绝", () => {
  const [job] = normalizeTargets(imageTask({ platform: "douyin", account_id: "a" }), accounts);
  assert.equal(job.action, "submit");
  assert.equal(job.directPublish, true);
  assert.equal(job.closeAfterSubmit, true);
  const [kept] = normalizeTargets(imageTask({ platform: "douyin", account_id: "a" }, { close_after_submit: false }), accounts);
  assert.equal(kept.closeAfterSubmit, false);
  for (const platform of ["kuaishou", "channels"]) {
    assert.throws(() => normalizeTargets(imageTask({ platform, account_id: "a" }), accounts), { code: "UNSUPPORTED_CAPABILITY" });
  }
  const [prepared] = normalizeTargets(imageTask({ platform: "kuaishou", account_id: "a", action: "prepare" }), accounts);
  assert.equal(prepared.directPublish, false);
});

test("图文执行器拒绝为未开放的平台点击最终发布，且不会启动浏览器", async () => {
  const results = [];
  const runner = new ImageTextChromeRunner(() => {}, (...args) => results.push(args), () => {});
  await runner.run({ platformKey: "kuaishou", account: "测试", accountId: "a", directPublish: true, images: ["/tmp/a.png"], artifactDir: "/tmp" });
  assert.equal(results.length, 1);
  const [, success, , code, result] = results[0];
  assert.equal(success, false);
  assert.equal(code, "UNSUPPORTED_CAPABILITY");
  assert.equal(result.outcome, "failed");
  assert.equal(runner.hasOpenWindows(), false);
});

const shanghaiNow = (format, offsetMinutes = 0) => DateTime.now().setZone("Asia/Shanghai").plus({ minutes: offsetMinutes }).toFormat(format);
const managePage = rows => `<main><h1>作品管理</h1>${rows.map(row => `<div class="video-card"><div class="info"><p class="title">${row.title}</p><span class="time">${row.time}</span><span class="status">${row.status || "审核中"}</span></div></div>`).join("")}</main>`;
const MANAGE_URL = "https://creator.douyin.com/creator-micro/content/manage?enter_from=publish";
const UPLOAD_URL = "https://creator.douyin.com/creator-micro/content/upload?default-tab=3";

async function withDouyinRoutes(callback) {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const context = await browser.newContext();
    const pages = { upload: "<button>发布</button>", manage: managePage([]) };
    await context.route("https://creator.douyin.com/**", route => {
      const url = new URL(route.request().url());
      const body = url.pathname.startsWith("/creator-micro/content/manage") ? pages.manage : pages.upload;
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
    });
    const page = await context.newPage();
    await callback(page, pages);
  } finally {
    await browser.close();
  }
}

test("抖音图文点击一次发布后，以成功提示作为回执，与视频相同", async () => {
  await withDouyinRoutes(async (page, pages) => {
    pages.upload = `<button onclick="window.clicks=(window.clicks||0)+1;window.clickedAfterCheckpoint=window.checkpoint;document.querySelector('#toast').textContent='发布成功'">发布</button><div id="toast"></div>`;
    await page.goto(UPLOAD_URL);
    const context = { contentType: "image_text" };
    const result = await submitAndVerify(page, IMAGE_TEXT_PLATFORMS.douyin, async () => { await page.evaluate(() => { window.checkpoint = true; }); }, { timeoutMs: 1_000, expected: { title: "图文标题", description: "图文正文内容" }, context });
    assert.equal(result.outcome, "submitted");
    assert.equal(result.evidence.source, "platform_receipt");
    assert.equal(result.evidence.text, "发布成功");
    assert.ok(context.submittedAt);
    assert.equal(await page.evaluate(() => window.clicks), 1);
    assert.equal(await page.evaluate(() => window.clickedAfterCheckpoint), true);
  });
});

test("抖音图文跳转作品管理页后，以同标题且发布时间不早于点击的记录作为回执，只点击一次", async () => {
  await withDouyinRoutes(async (page, pages) => {
    pages.upload = `<button onclick="window.parent.clicks=(window.parent.clicks||0)+1;location.href='${MANAGE_URL}'">发布</button>`;
    pages.manage = managePage([{ title: "更早的作品", time: shanghaiNow("yyyy年MM月dd日 HH:mm", -600) }, { title: "图文标题", time: shanghaiNow("yyyy年MM月dd日 HH:mm") }]);
    await page.goto(UPLOAD_URL);
    let clicks = 0;
    const context = { contentType: "image_text" };
    const result = await submitAndVerify(page, IMAGE_TEXT_PLATFORMS.douyin, () => { clicks++; }, { timeoutMs: 5_000, expected: { title: "图文标题", description: "图文正文内容" }, context });
    assert.equal(clicks, 1);
    assert.equal(result.outcome, "submitted");
    assert.equal(result.evidence.verification, "new_post_record");
    assert.equal(result.evidence.matched_by, "title");
    // 已在作品管理页时不会再次点击发布。
    await assert.rejects(submitAndVerify(page, IMAGE_TEXT_PLATFORMS.douyin, () => { clicks++; }, { timeoutMs: 200, expected: { title: "图文标题" }, context: { contentType: "image_text" } }), { code: "STALE_SUBMISSION_RECEIPT" });
    assert.equal(clicks, 1);
  });
});

test("作品管理页的旧记录、仅跳转、跨行时间、定时发布或视频任务都不算抖音图文回执", async () => {
  await withDouyinRoutes(async (page, pages) => {
    const expected = { title: "图文标题", description: "图文正文内容" };
    const submittedAt = new Date().toISOString();
    const verify = (ctx = { contentType: "image_text", submittedAt }, exp = expected) => verifySubmission(page, "douyin", { timeoutMs: 300, expected: exp, context: ctx });

    pages.manage = managePage([{ title: "图文标题", time: shanghaiNow("yyyy-MM-dd HH:mm", -120) }]);
    await page.goto(MANAGE_URL);
    await assert.rejects(verify(), { code: "SUBMISSION_UNKNOWN" });

    pages.manage = managePage([{ title: "其他作品", time: shanghaiNow("yyyy-MM-dd HH:mm") }]);
    await page.goto(MANAGE_URL);
    await assert.rejects(verify(), { code: "SUBMISSION_UNKNOWN" });

    pages.manage = `<div><p>图文标题</p><span>${shanghaiNow("yyyy-MM-dd HH:mm")}</span><span>${shanghaiNow("yyyy-MM-dd HH:mm", -60)}</span></div>`;
    await page.goto(MANAGE_URL);
    await assert.rejects(verify(), { code: "SUBMISSION_UNKNOWN" });

    pages.manage = managePage([{ title: "图文标题", time: shanghaiNow("yyyy-MM-dd HH:mm") }]);
    await page.goto(MANAGE_URL);
    await assert.rejects(verify({ submittedAt }), { code: "SUBMISSION_UNKNOWN" }, "视频任务不使用列表回执");
    await assert.rejects(verify({ contentType: "image_text", submittedAt }, { ...expected, scheduledAt: "2026-10-10T12:00" }), { code: "SUBMISSION_UNKNOWN" });
    await assert.rejects(verify({ contentType: "image_text" }), { code: "SUBMISSION_UNKNOWN" }, "没有提交时刻时无法判断是否为本次记录");
    const ok = await verify();
    assert.equal(ok.outcome, "submitted");
  });
});

test("抖音图文点击后没有明确回执时返回待核实，绝不自动重试点击", async () => {
  await withDouyinRoutes(async (page, pages) => {
    pages.upload = `<button onclick="window.clicks=(window.clicks||0)+1;this.textContent='发布中'">发布</button>`;
    await page.goto(UPLOAD_URL);
    let attempts = 0;
    await assert.rejects(submitAndVerify(page, IMAGE_TEXT_PLATFORMS.douyin, () => { attempts++; }, { timeoutMs: 500, expected: { title: "图文标题" }, context: { contentType: "image_text" } }), { code: "SUBMISSION_UNKNOWN" });
    assert.equal(attempts, 1);
    assert.equal(await page.evaluate(() => window.clicks), 1);
  });
});
