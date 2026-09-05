import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { chromePath } from "../src/account-binding.js";
import { channelsImageTextContent, IMAGE_TEXT_PLATFORM_KEYS, IMAGE_TEXT_PLATFORMS, isImageTextPlatform } from "../src/image-text-platforms.js";
import { openImageTextMode, setXiaohongshuImageDeclaration } from "../src/image-text-runner.js";

test("图文发布只包含抖音、小红书和视频号", () => {
  assert.deepEqual(IMAGE_TEXT_PLATFORM_KEYS, ["douyin", "xiaohongshu", "channels"]);
  assert.deepEqual(Object.keys(IMAGE_TEXT_PLATFORMS), ["douyin", "xiaohongshu", "channels"]);
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
      <div class="creator-tab" aria-hidden="true" style="position:absolute;inset:0;z-index:-1"><span>上传图文</span></div>
      <div class="creator-tab" id="real-tab"><span>上传图文</span></div>
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
    const input = await openImageTextMode(page, IMAGE_TEXT_PLATFORMS.xiaohongshu);
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

test("小红书图文内容类型声明会点击对应选项行并验证选中结果", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="d-select-wrapper d-inline-block custom-select-44">
        <div class="d-select-main"><div class="d-select-content"><div class="d-select-placeholder">添加内容类型声明</div></div></div>
      </div>
      <div class="declaration-drop-down" style="display:none">
        <div class="d-grid-item" style="grid-area: 1 / 1 / auto / -1"><div class="d-option-handler" id="ai-handler" style="width:220px;height:32px"></div></div>
        <div class="d-grid-item" style="grid-area: 1 / 2 / auto / -1"><div class="d-option-name" id="ai-option"><span>笔记含AI合成内容</span></div></div>
      </div>
      <script>
        const dropdown = document.querySelector('.declaration-drop-down');
        document.querySelector('.d-select-main').addEventListener('click', () => { dropdown.style.display = 'block'; });
        document.getElementById('ai-option').addEventListener('click', () => {
          document.querySelector('.d-select-content').textContent = '笔记含AI合成内容';
          dropdown.style.display = 'none';
        });
      </script>
    `);
    assert.equal(await setXiaohongshuImageDeclaration(page, "笔记含AI合成内容"), true);
    assert.equal((await page.locator(".d-select-content").innerText()).trim(), "笔记含AI合成内容");
  } finally {
    await browser.close();
  }
});
