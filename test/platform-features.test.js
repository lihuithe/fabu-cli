import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { chromePath } from "../src/account-binding.js";
import { appendTopics, setChannelsLocationHidden, setChannelsOriginal, setChannelsOriginalIfAvailable, setRights, setXiaohongshuOriginal, shouldSkipDeclaration } from "../src/browser-utils.js";
import { confirmDefaultCover, findXiaohongshuCoverEntry } from "../src/cover-handlers.js";
import { channelsCoverRatios, channelsShortTitleStatus, coverSetStatus, douyinCoverRatios, normalizeChannelsShortTitle, originalForPlatform, PLATFORMS, scheduledTimeStatus, xiaohongshuCoverRatio } from "../src/platforms.js";
import { channelsDescription, fillChannelsShortTitle } from "../src/runner.js";
import { setScheduledPublish } from "../src/schedule-publish.js";

function futureScheduleValue(days = 1) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test("视频号描述只包含平台标题和用户话题", () => {
  const description = channelsDescription({
    title: "视频号独立标题",
    topics: ["话题一", "#话题二"],
    content: "这段通用简介不能出现"
  });
  assert.equal(description, "视频号独立标题\n#话题一 #话题二");
  assert.equal(description.includes("通用简介"), false);
});

test("视频号短标题只填写独立的短标题输入框", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<input placeholder="填写短标题有机会获得更多流量" maxlength="16">');
    assert.equal(await fillChannelsShortTitle(page, PLATFORMS.channels, "十六字以内短标题"), true);
    assert.equal(await page.locator("input").inputValue(), "十六字以内短标题");
  } finally {
    await browser.close();
  }
});

test("视频号短标题会替换逗号并限制特殊字符", () => {
  assert.equal(normalizeChannelsShortTitle("新品，首发,限时"), "新品 首发 限时");
  assert.equal(channelsShortTitleStatus('《新品》：“热”+?%℃').valid, true);
  assert.equal(channelsShortTitleStatus("普通文字123").valid, true);
  assert.equal(channelsShortTitleStatus("不支持！句号。").valid, false);
  assert.match(channelsShortTitleStatus("不支持！句号。").message, /特殊字符/);
  assert.match(channelsShortTitleStatus("一二三四五六七八九十一二三四五六七").message, /16个字/);
});

test("原创勾选只传给小红书", () => {
  assert.equal(originalForPlatform("xiaohongshu", true), true);
  assert.equal(originalForPlatform("douyin", true), false);
  assert.equal(originalForPlatform("channels", true), false);
  assert.equal(originalForPlatform("bilibili", true), false);
  assert.equal(originalForPlatform("xiaohongshu", false), false);
});

test("小红书原创声明会先勾选协议再点击声明原创", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="original-row">
        <span>原创声明</span>
        <div class="custom-switch-switch">
          <div id="original-switch" class="d-switch d-clickable d-switch-default d-inline-block">
            <div class="d-switch-box"><div class="d-switch-top">
              <span class="d-switch-simulator unchecked --color-bg-fill">
                <input id="original" type="checkbox" value="true">
                <span class="d-switch-indicator"></span>
              </span>
            </div></div>
          </div>
        </div>
      </div>
      <div id="original-modal" hidden>
        <div class="d-grid d-checkbox d-checkbox-main-label d-clickable bg-red">
          <span class="d-checkbox-simulator unchecked"></span>
          <input id="agreement" type="checkbox">
          <span>我已阅读并同意《原创声明须知》，如滥用声明，平台将驳回并予以相关处置</span>
        </div>
        <button id="confirm" type="button" class="d-button disabled" disabled>
          <span>声明原创</span>
        </button>
      </div>
      <script>
        window.originalActions = [];
        const originalSwitch = document.querySelector("#original-switch");
        const original = document.querySelector("#original");
        const modal = document.querySelector("#original-modal");
        const agreementControl = document.querySelector(".d-checkbox-main-label");
        const agreement = document.querySelector("#agreement");
        const confirm = document.querySelector("#confirm");
        originalSwitch.addEventListener("click", () => {
          window.originalActions.push("打开原创声明");
          modal.hidden = false;
        });
        agreementControl.addEventListener("click", event => {
          if (event.target !== agreement) agreement.checked = !agreement.checked;
          window.originalActions.push("勾选协议");
          confirm.disabled = !agreement.checked;
          confirm.classList.toggle("disabled", confirm.disabled);
        });
        confirm.addEventListener("click", () => {
          window.originalActions.push("声明原创");
          original.checked = true;
          modal.hidden = true;
        });
      </script>
    `);

    assert.equal(await setXiaohongshuOriginal(page, true), true);
    assert.equal(await page.isChecked("#original"), true);
    assert.equal(await page.isChecked("#agreement"), true);
    assert.deepEqual(await page.evaluate(() => window.originalActions), ["打开原创声明", "勾选协议", "声明原创"]);
  } finally {
    await browser.close();
  }
});

test("小红书账号未提供原创声明控件时会跳过并继续", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="publish-form"><span>定时发布</span></div>');
    const logs = [];
    await setRights(page, {
      account: "无原创控件账号",
      declaration: "无需内容标注",
      original: true
    }, message => logs.push(message), PLATFORMS.xiaohongshu);
    assert.equal(logs.some(message => message.includes("当前账号未提供原创声明控件，已跳过")), true);
  } finally {
    await browser.close();
  }
});

test("视频号原创声明会先打开弹窗、勾选协议再确认声明", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="form-item-body">
        <div class="declare-original-checkbox">
          <label id="channels-original-control" class="ant-checkbox-wrapper">
            <span class="ant-checkbox"><input id="channels-original" type="checkbox" class="ant-checkbox-input"><span class="ant-checkbox-inner"></span></span>
            <span>声明后，作品将展示原创标记，有机会获得广告收入。</span>
          </label>
        </div>
      </div>
      <div id="channels-original-modal" class="weui-desktop-dialog" hidden>
        <div class="weui-desktop-dialog__hd"><h3 class="weui-desktop-dialog__title">原创权益</h3></div>
        <div class="weui-desktop-dialog__bd"><div class="original-proto-wrapper">
          <label id="channels-agreement-control" class="ant-checkbox-wrapper">
            <span class="ant-checkbox"><input id="channels-agreement" type="checkbox" class="ant-checkbox-input"><span class="ant-checkbox-inner"></span></span>
          </label>
          <div class="protocol-text">我已阅读并同意《原创声明须知》和《使用条款》。</div>
        </div></div>
        <div class="weui-desktop-dialog__ft">
          <div class="weui-desktop-btn_wrp cancel-btn"><button type="button" class="weui-desktop-btn weui-desktop-btn_default">取消</button></div>
          <div class="weui-desktop-btn_wrp"><button id="channels-confirm" type="button" class="weui-desktop-btn weui-desktop-btn_primary weui-desktop-btn_disabled" disabled>声明原创</button></div>
        </div>
      </div>
      <script>
        window.channelsOriginalActions = [];
        const original = document.querySelector('#channels-original');
        const agreement = document.querySelector('#channels-agreement');
        const modal = document.querySelector('#channels-original-modal');
        const confirm = document.querySelector('#channels-confirm');
        original.addEventListener('change', () => {
          window.channelsOriginalActions.push('打开原创声明');
          modal.hidden = false;
        });
        agreement.addEventListener('change', () => {
          window.channelsOriginalActions.push('勾选协议');
          confirm.disabled = !agreement.checked;
          confirm.classList.toggle('weui-desktop-btn_disabled', confirm.disabled);
        });
        confirm.addEventListener('click', () => {
          window.channelsOriginalActions.push('声明原创');
          modal.hidden = true;
        });
      </script>
    `);

    assert.equal(await setChannelsOriginal(page), true);
    assert.equal(await page.isChecked("#channels-original"), true);
    assert.equal(await page.isChecked("#channels-agreement"), true);
    assert.deepEqual(await page.evaluate(() => window.channelsOriginalActions), ["打开原创声明", "勾选协议", "声明原创"]);
  } finally {
    await browser.close();
  }
});

test("视频号账号未提供原创声明控件时会跳过并继续", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="post-form"><span>位置</span><span>定时发布</span></div>');
    assert.equal(await setChannelsOriginalIfAvailable(page), "unavailable");
  } finally {
    await browser.close();
  }
});

test("视频号位置设置会打开位置下拉框并选择不显示位置", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="form-item">
        <div class="label">位置</div>
        <div class="form-item-body">
          <div class="post-position-wrap">
            <div class="position-display"><div class="position-display-wrap"><span class="location-name">上海市</span></div></div>
            <div class="location-filter-wrap" style="display:none">
              <div class="common-option-list-wrap">
                <div class="option-item"><div class="location-item"><div class="location-item-info"><div class="name">不显示位置</div></div></div></div>
                <div class="option-item"><div class="location-item"><div class="location-item-info"><div class="name">上海新天地</div><div class="desc">上海市黄浦区马当路119号</div></div></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <script>
        window.locationActions = [];
        const display = document.querySelector('.position-display-wrap');
        const filter = document.querySelector('.location-filter-wrap');
        display.addEventListener('click', () => {
          window.locationActions.push('打开位置');
          filter.style.display = 'block';
        });
        document.querySelectorAll('.option-item').forEach(option => option.addEventListener('click', () => {
          const name = option.querySelector('.name').textContent.trim();
          window.locationActions.push(name);
          filter.style.display = 'none';
        }));
      </script>
    `);

    assert.equal(await setChannelsLocationHidden(page), true);
    assert.equal(await page.locator(".location-name").innerText(), "上海市");
    assert.equal(await page.locator(".location-filter-wrap").isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.locationActions), ["打开位置", "不显示位置"]);
  } finally {
    await browser.close();
  }
});

test("定时发布时间只接受未来 5 分钟至 15 天内的本地时间", () => {
  const now = new Date(2026, 7, 10, 12, 0, 0).getTime();
  assert.equal(scheduledTimeStatus("2026-08-10T12:05", now).valid, true);
  assert.match(scheduledTimeStatus("2026-08-10T12:04", now).message, /5 分钟/);
  assert.match(scheduledTimeStatus("2026-08-25T12:01", now).message, /15 天/);
  assert.equal(scheduledTimeStatus("2026-02-30T12:00", now).valid, false);
});

test("抖音先开启定时发布，再按 yyyy-MM-dd HH:mm 填入日期时间", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    const value = futureScheduleValue();
    const [targetDate, targetTime] = value.split("T");
    const [targetHour, targetMinute] = targetTime.split(":");
    const otherHour = String((Number(targetHour) + 1) % 24).padStart(2, "0");
    const otherMinute = String((Number(targetMinute) + 1) % 60).padStart(2, "0");
    await page.setContent(`
      <style>body{min-width:1000px;min-height:720px}.semi-datepicker{width:285px;margin-left:260px}</style>
      <label id="private-only" class="radio-d4zkru one-line-pe7juM" data-checked="false"><input type="checkbox" class="radio-native-p6VBGt" value="1"><span>仅自己可见</span></label>
      <label class="radio-d4zkru one-line-pe7juM" data-checked="false">
        <input type="checkbox" class="radio-native-p6VBGt" value="1"><span>定时发布</span>
      </label>
      <input format="yyyy-MM-dd HH:mm" class="semi-input semi-input-default" type="text" placeholder="日期和时间" hidden>
      <div class="semi-datepicker" hidden>
        <div class="semi-datepicker-month"><div class="semi-datepicker-weeks"><div class="semi-datepicker-day" title="${targetDate}"><div class="semi-datepicker-day-main"><span>${Number(targetDate.slice(-2))}</span></div></div></div></div>
        <div class="semi-datepicker-switch-time"><span class="semi-datepicker-switch-text">${otherHour}:${otherMinute}</span></div>
        <div class="semi-scrolllist-body" hidden>
          <div class="semi-scrolllist-item-wheel undefined-list-hour"><div class="semi-scrolllist-selector"></div><ul><li class="semi-scrolllist-item-selected">${otherHour}时</li><li>${targetHour}时</li><li>${targetHour}时</li></ul></div>
          <div class="semi-scrolllist-item-wheel undefined-list-minute"><div class="semi-scrolllist-selector"></div><ul><li class="semi-scrolllist-item-selected">${otherMinute}分</li><li>${targetMinute}分</li><li>${targetMinute}分</li></ul></div>
        </div>
      </div>
      <script>
        const label = [...document.querySelectorAll('label')].find(item => item.textContent.includes('定时发布'));
        const privateOnly = document.querySelector('#private-only');
        const picker = document.querySelector('.semi-datepicker');
        const dateInput = document.querySelector('input[placeholder="日期和时间"]');
        const targetDay = document.querySelector('.semi-datepicker-day');
        const scrollBody = document.querySelector('.semi-scrolllist-body');
        let chosenHour = '';
        let chosenMinute = '';
        window.douyinScheduleActions = [];
        window.scheduleToggleClicks = 0;
        window.douyinOutsideClicks = 0;
        window.privateOnlyClicks = 0;
        privateOnly.addEventListener('click', () => { window.privateOnlyClicks += 1; privateOnly.dataset.checked = 'true'; });
        label.addEventListener('click', () => {
          window.scheduleToggleClicks += 1;
          window.douyinScheduleActions.push('toggle');
          label.dataset.checked = 'true';
          label.querySelector('input').checked = true;
          dateInput.hidden = false;
        });
        dateInput.onclick = () => { picker.hidden = false; window.douyinScheduleActions.push('open-date'); };
        targetDay.onclick = () => { targetDay.classList.add('semi-datepicker-day-selected'); window.douyinScheduleActions.push('date'); };
        document.querySelector('.semi-datepicker-switch-time').onclick = () => { scrollBody.hidden = false; window.douyinScheduleActions.push('open-time'); };
        document.querySelectorAll('.undefined-list-hour li').forEach(item => item.onclick = () => {
          document.querySelectorAll('.undefined-list-hour li').forEach(option => option.classList.remove('semi-scrolllist-item-selected'));
          item.classList.add('semi-scrolllist-item-selected'); chosenHour = item.textContent.replace(/\\D/g, '').padStart(2, '0'); window.douyinScheduleActions.push('hour');
        });
        document.querySelectorAll('.undefined-list-minute li').forEach(item => item.onclick = () => {
          document.querySelectorAll('.undefined-list-minute li').forEach(option => option.classList.remove('semi-scrolllist-item-selected'));
          item.classList.add('semi-scrolllist-item-selected'); chosenMinute = item.textContent.replace(/\\D/g, '').padStart(2, '0'); dateInput.value = '${targetDate} ' + chosenHour + ':' + chosenMinute; window.douyinScheduleActions.push('minute');
        });
        document.body.addEventListener('click', event => {
          if (picker.contains(event.target) || dateInput.contains(event.target) || label.contains(event.target) || privateOnly.contains(event.target)) return;
          window.douyinOutsideClicks += 1;
          picker.hidden = true;
          scrollBody.hidden = true;
        });
      </script>
    `);
    const logs = [];
    await setScheduledPublish(page, PLATFORMS.douyin, value, message => logs.push(message));
    const scheduleLabel = page.locator('label.radio-d4zkru:has-text("定时发布")');
    assert.equal(await scheduleLabel.getAttribute("data-checked"), "true");
    assert.equal(await page.locator("#private-only").getAttribute("data-checked"), "false");
    assert.equal(await page.evaluate(() => window.privateOnlyClicks), 0);
    assert.equal(await page.inputValue('input[format="yyyy-MM-dd HH:mm"]'), value.replace("T", " "));
    assert.equal(logs.includes("已点击并选中定时发布选择框"), true);
    assert.equal(await page.evaluate(() => window.douyinOutsideClicks), 1);
    assert.equal(await page.locator('.semi-datepicker').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.douyinScheduleActions), ["toggle", "open-date", "date", "open-time", "hour", "minute"]);

    await page.evaluate(() => { window.scheduleToggleClicks = 0; [...document.querySelectorAll('label')].find(item => item.textContent.includes('定时发布')).querySelector('input').checked = false; });
    await setScheduledPublish(page, PLATFORMS.douyin, value);
    assert.equal(await page.evaluate(() => window.scheduleToggleClicks), 0);
    assert.equal(await page.inputValue('input[format="yyyy-MM-dd HH:mm"]'), value.replace("T", " "));
  } finally {
    await browser.close();
  }
});

test("小红书、B站和视频号会在开启后填入用户选择的时间", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const value = futureScheduleValue();
  const [targetDate, targetTime] = value.split("T");
  const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
  const [targetHour, targetMinute] = targetTime.split(":");
  const previousMonth = new Date(targetYear, targetMonth - 2, 1);
  const otherHour = String((Number(targetHour) + 1) % 24).padStart(2, "0");
  const otherMinute = String((Number(targetMinute) + 1) % 60).padStart(2, "0");
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>body{min-width:1000px;min-height:720px}.post-time-date-picker-popover-class{width:520px;margin-left:220px}</style>
      <div class="post-time-wrapper">
        <div class="post-time-switch-container">定时发布 <span class="d-switch-simulator unchecked --color-bg-fill"><input type="checkbox" value="true"><span class="d-switch-indicator"></span></span></div>
        <input class="d-text" hidden value="">
      </div>
      <div class="d-popover post-time-date-picker-popover-class" hidden>
        <div class="d-datepicker-header">
          <div class="--space-p-extra-small"><span class="d-clickable">上年</span></div>
          <div class="--space-p-extra-small"><span class="d-clickable">上月</span></div>
          <div class="d-datepicker-header-main"><div class="d-datepicker-selector"><h6>${previousMonth.getFullYear()}年</h6><h6>${previousMonth.getMonth() + 1}月</h6></div></div>
          <div class="--space-p-extra-small"><span id="xhs-next-month" class="d-clickable">下月</span></div>
          <div class="--space-p-extra-small"><span class="d-clickable">下年</span></div>
        </div>
        <div class="d-datepicker-dates"><div id="xhs-target-day" class="d-datepicker-cell d-clickable disabled"><span class="d-text">${targetDay}</span></div></div>
        <div class="d-timepicker-body">
          <div class="d-timepicker-timebar"><div class="d-timepicker-time d-clickable active"><span>${otherHour}</span><span>时</span></div><div class="d-timepicker-time d-clickable"><span>${targetHour}</span></div></div>
          <div class="d-timepicker-timebar"><div class="d-timepicker-time d-clickable active"><span>${otherMinute}</span><span>分</span></div><div class="d-timepicker-time d-clickable"><span>${targetMinute}</span></div></div>
        </div>
      </div>
      <script>
        const xhsSwitch = document.querySelector('.d-switch-simulator');
        const xhsInput = document.querySelector('.post-time-wrapper input.d-text');
        const xhsPopover = document.querySelector('.post-time-date-picker-popover-class');
        const xhsLabels = document.querySelectorAll('.d-datepicker-selector h6');
        const xhsDay = document.querySelector('#xhs-target-day');
        const xhsColumns = document.querySelectorAll('.d-timepicker-timebar');
        let xhsHour = '';
        let xhsMinute = '';
        window.xhsScheduleActions = [];
        window.xhsOutsideClicks = 0;
        xhsSwitch.onclick = () => { xhsSwitch.querySelector('input').checked = true; xhsSwitch.classList.remove('unchecked'); xhsSwitch.classList.add('checked'); xhsInput.hidden = false; window.xhsScheduleActions.push('toggle'); };
        xhsInput.onclick = () => { xhsPopover.hidden = false; window.xhsScheduleActions.push('open'); };
        document.querySelector('#xhs-next-month').onclick = () => { xhsLabels[0].textContent = '${targetYear}年'; xhsLabels[1].textContent = '${targetMonth}月'; xhsDay.classList.remove('disabled'); window.xhsScheduleActions.push('month'); };
        xhsDay.onclick = () => { xhsDay.classList.add('picked'); window.xhsScheduleActions.push('date'); };
        xhsColumns[0].querySelectorAll('.d-timepicker-time').forEach(item => item.onclick = () => { xhsColumns[0].querySelectorAll('.d-timepicker-time').forEach(option => option.classList.remove('active')); item.classList.add('active'); xhsHour = item.innerText.replace(/\\D/g, '').padStart(2, '0'); window.xhsScheduleActions.push('hour'); });
        xhsColumns[1].querySelectorAll('.d-timepicker-time').forEach(item => item.onclick = () => { xhsColumns[1].querySelectorAll('.d-timepicker-time').forEach(option => option.classList.remove('active')); xhsMinute = item.innerText.replace(/\\D/g, '').padStart(2, '0'); xhsInput.value = '${targetDate} ' + xhsHour + ':' + xhsMinute; xhsPopover.remove(); window.xhsScheduleActions.push('minute'); });
        document.body.addEventListener('click', event => { if (xhsPopover.contains(event.target) || xhsInput.contains(event.target) || xhsSwitch.contains(event.target)) return; if (!xhsPopover.hidden) { window.xhsOutsideClicks += 1; xhsPopover.hidden = true; } });
      </script>
    `);
    await setScheduledPublish(page, PLATFORMS.xiaohongshu, value);
    assert.equal(await page.inputValue('.post-time-wrapper input.d-text'), value.replace("T", " "));
    assert.deepEqual(await page.evaluate(() => window.xhsScheduleActions), ["toggle", "open", "month", "date", "hour", "minute"]);
    assert.equal(await page.evaluate(() => window.xhsOutsideClicks), 0);
    assert.equal(await page.locator('.post-time-date-picker-popover-class').count(), 0);

    await page.setContent(`
      <style>body{min-width:1000px;min-height:720px}.date-picker-date-wrp{display:inline-block;width:170px}.date-picker-time-panel{width:130px}</style>
      <div class="time-container"><span>定时发布</span><button type="button" class="switch-container">开启</button></div>
      <label id="bili-safe-surface" style="display:block;width:900px;min-height:300px">
      <div id="bili-timezone">(UTC+08:00) Beijing, Chongqing</div>
      <div class="date-picker-date-wrp"><div class="date-picker-date"><p class="date-show">2026-08-10</p><i class="date-show-icon"></i></div></div>
      <div class="date-picker-date-wrp"><div class="date-picker-timer"><p class="date-show">00:00</p><i class="date-show-icon"></i></div></div>
      <div class="date-picker-container" hidden><div class="date-picker-nav-wrp"><svg class="prev-btn-month date-select-disabled"></svg><p class="date-picker-nav-title">${previousMonth.getFullYear()}年${previousMonth.getMonth() + 1}月</p><svg id="bili-next-month" class="next-btn-month"></svg></div><div class="date-wrp"><div id="bili-disabled-day" class="date-picker-body-item date-item-disabled"> ${targetDay} </div><div id="bili-target-day" class="date-picker-body-item date-item-disabled"> ${targetDay} </div></div></div>
      <div class="date-picker-time-panel" hidden><div class="time-picker-panel-select-wrp"><span class="time-picker-panel-select-item">${targetHour}</span></div><div class="time-picker-panel-select-wrp"><span class="time-picker-panel-select-item">${targetMinute}</span></div></div>
      </label>
      <script>
        window.biliScheduleActions = [];
        window.biliOutsideClicks = 0;
        window.biliOutsidePoint = null;
        window.biliDisabledDateClicks = 0;
        const biliDate = document.querySelector('.date-picker-date');
        const biliTime = document.querySelector('.date-picker-timer');
        const biliDatePanel = document.querySelector('.date-picker-container');
        const biliTimePanel = document.querySelector('.date-picker-time-panel');
        document.querySelector('.switch-container').onclick = () => window.biliScheduleActions.push('toggle');
        biliDate.onclick = () => { biliDatePanel.hidden = false; window.biliScheduleActions.push('open-date'); };
        document.querySelector('#bili-next-month').onclick = () => { biliDatePanel.querySelector('.date-picker-nav-title').textContent = '${targetYear}年${targetMonth}月'; document.querySelector('#bili-target-day').className = 'date-picker-body-item date-item'; window.biliScheduleActions.push('month'); };
        document.querySelector('#bili-disabled-day').onclick = () => { window.biliDisabledDateClicks += 1; };
        document.querySelector('#bili-target-day').onclick = () => { biliDate.querySelector('.date-show').textContent = '${targetDate}'; biliDatePanel.hidden = true; window.biliScheduleActions.push('date'); };
        biliTime.onclick = () => { biliTimePanel.hidden = false; const rect = biliTimePanel.getBoundingClientRect(); window.biliPanelRight = rect.right; window.biliPanelBottom = rect.bottom; window.biliScheduleActions.push('open-time'); };
        let biliHour = '';
        let biliMinute = '';
        const biliTimeColumns = biliTimePanel.querySelectorAll('.time-picker-panel-select-wrp');
        biliTimeColumns[0].querySelector('.time-picker-panel-select-item').onclick = event => { event.target.classList.add('time-selected'); biliHour = event.target.textContent.trim(); window.biliScheduleActions.push('hour'); };
        biliTimeColumns[1].querySelector('.time-picker-panel-select-item').onclick = event => { event.target.classList.add('time-selected'); biliMinute = event.target.textContent.trim(); biliTime.querySelector('.date-show').textContent = biliHour + ':' + biliMinute; window.biliScheduleActions.push('minute'); };
        document.body.addEventListener('click', event => { if (biliTimePanel.contains(event.target) || biliTime.contains(event.target)) return; if (!biliTimePanel.hidden) { window.biliOutsideClicks += 1; window.biliOutsidePoint = { x: event.clientX, y: event.clientY }; biliTimePanel.hidden = true; } });
      </script>
    `);
    await setScheduledPublish(page, PLATFORMS.bilibili, value);
    assert.equal(await page.locator('.date-picker-date .date-show').innerText(), targetDate);
    assert.equal(await page.locator('.date-picker-timer .date-show').innerText(), targetTime);
    assert.equal(await page.locator('#bili-timezone').innerText(), "(UTC+08:00) Beijing, Chongqing");
    assert.equal(await page.evaluate(() => window.biliDisabledDateClicks), 0);
    assert.deepEqual(await page.evaluate(() => window.biliScheduleActions), ["toggle", "open-date", "month", "date", "open-time", "hour", "minute"]);
    assert.equal(await page.evaluate(() => window.biliOutsideClicks), 1);
    const biliOutsidePoint = await page.evaluate(() => window.biliOutsidePoint);
    assert.equal(biliOutsidePoint.x > await page.evaluate(() => window.biliPanelRight + 100), true);
    assert.equal(biliOutsidePoint.y > await page.evaluate(() => window.biliPanelBottom), true);
    assert.equal(await page.locator('.date-picker-time-panel').isVisible(), false);

    await page.setContent("<iframe></iframe>");
    const frame = page.frames().find(item => item !== page.mainFrame());
    await frame.setContent(`
      <style>body{min-width:900px;min-height:700px}.weui-desktop-picker__panel_day{width:260px;margin-left:180px}</style>
      <label><input type="radio" value="1">定时</label>
      <dl class="weui-desktop-picker__date weui-desktop-picker__date-time" hidden><dt class="weui-desktop-picker__dt"><input type="text" readonly placeholder="请选择发表时间" class="weui-desktop-form__input"></dt></dl>
      <div class="weui-desktop-picker__panel weui-desktop-picker__panel_day" hidden>
        <div class="weui-desktop-picker__panel__hd">
          <button type="button" class="weui-desktop-btn__icon weui-desktop-btn__icon__left" hidden></button>
          <span class="weui-desktop-picker__panel__label">${previousMonth.getFullYear()}年</span>
          <span class="weui-desktop-picker__panel__label">${String(previousMonth.getMonth() + 1).padStart(2, "0")}月</span>
          <button type="button" class="weui-desktop-btn__icon weui-desktop-btn__icon__right">下一月</button>
        </div>
        <div class="weui-desktop-picker__panel__bd"><table class="weui-desktop-picker__table"><tbody><tr><td><a id="target-day" class="weui-desktop-picker__faded">${targetDay}</a></td></tr></tbody></table></div>
        <div class="weui-desktop-picker__panel-fd">
          <input type="text" placeholder="请选择时间" class="weui-desktop-form__input">
          <ol class="weui-desktop-picker__time__panel weui-desktop-picker__time__hour"><li>${targetHour}</li></ol>
          <ol class="weui-desktop-picker__time__panel weui-desktop-picker__time__minute"><li>${targetMinute}</li></ol>
        </div>
      </div>
      <script>
        const panel = document.querySelector('.weui-desktop-picker__panel_day');
        const labels = document.querySelectorAll('.weui-desktop-picker__panel__label');
        const day = document.querySelector('#target-day');
        const timeInput = document.querySelector('input[placeholder="请选择时间"]');
        let selectedHour = '';
        let selectedMinute = '';
        window.publishTimeTriggerClicks = 0;
        window.publishTimeOutsideClicks = 0;
        const publishTimeTrigger = document.querySelector('input[placeholder="请选择发表时间"]');
        document.querySelector('label').onclick = () => { document.querySelector('input[type="radio"]').checked = true; document.querySelector('.weui-desktop-picker__date-time').hidden = false; };
        publishTimeTrigger.onclick = () => { window.publishTimeTriggerClicks += 1; panel.hidden = false; };
        document.querySelector('.weui-desktop-btn__icon__right').onclick = () => { labels[0].textContent = '${targetYear}年'; labels[1].textContent = '${String(targetMonth).padStart(2, "0")}月'; day.className = ''; };
        day.onclick = () => day.classList.add('weui-desktop-picker__selected');
        document.querySelector('.weui-desktop-picker__time__hour li').onclick = event => { selectedHour = event.target.textContent.trim(); event.target.classList.add('weui-desktop-picker__selected'); };
        document.querySelector('.weui-desktop-picker__time__minute li').onclick = event => { selectedMinute = event.target.textContent.trim(); event.target.classList.add('weui-desktop-picker__selected'); timeInput.value = selectedHour + ':' + selectedMinute; };
        document.body.addEventListener('click', event => {
          if (panel.contains(event.target) || publishTimeTrigger.contains(event.target) || document.querySelector('label').contains(event.target)) return;
          window.publishTimeOutsideClicks += 1;
          panel.hidden = true;
        });
      </script>
    `);
    await frame.waitForLoadState();
    await setScheduledPublish(page, PLATFORMS.channels, value);
    assert.equal(await frame.evaluate(() => window.publishTimeTriggerClicks), 1);
    assert.equal(await frame.evaluate(() => window.publishTimeOutsideClicks), 1);
    assert.equal(await frame.locator('#target-day').evaluate(element => element.classList.contains('weui-desktop-picker__selected')), true);
    assert.equal(await frame.locator('input[placeholder="请选择时间"]').inputValue(), targetTime);
    assert.equal(await frame.locator('.weui-desktop-picker__panel_day').isVisible(), false);
  } finally {
    await browser.close();
  }
});

test("小红书选择无需内容标注时跳过平台声明操作", () => {
  assert.equal(shouldSkipDeclaration("xiaohongshu", "无需内容标注"), true);
  assert.equal(shouldSkipDeclaration("xiaohongshu", "内容包含营销广告"), false);
  assert.equal(shouldSkipDeclaration("douyin", "无需内容标注"), false);
});

test("小红书根据视频方向选择封面比例", () => {
  assert.equal(xiaohongshuCoverRatio(1280, 720), "4:3");
  assert.equal(xiaohongshuCoverRatio(1080, 1440), "3:4");
  assert.equal(xiaohongshuCoverRatio(1080, 1080), "3:4");
  assert.equal(xiaohongshuCoverRatio(0, 0), "3:4");
});

test("视频号横屏视频同时使用竖版和横版封面", () => {
  assert.deepEqual(channelsCoverRatios(1280, 720), ["3:4", "4:3"]);
  assert.deepEqual(channelsCoverRatios(1080, 1440), ["3:4"]);
  assert.deepEqual(channelsCoverRatios(1080, 1080), ["3:4"]);
});

test("抖音根据视频方向决定两张封面的上传顺序", () => {
  assert.deepEqual(douyinCoverRatios(1280, 720), ["4:3", "3:4"]);
  assert.deepEqual(douyinCoverRatios(1080, 1440), ["3:4", "4:3"]);
  assert.deepEqual(douyinCoverRatios(1080, 1080), ["3:4", "4:3"]);
});

test("双封面平台只允许整套上传或全部使用默认封面", () => {
  assert.deepEqual(coverSetStatus(["3:4", "4:3"], []), { mode: "default", missing: [] });
  assert.deepEqual(coverSetStatus(["3:4", "4:3"], ["3:4"]), { mode: "incomplete", missing: ["4:3"] });
  assert.deepEqual(coverSetStatus(["3:4", "4:3"], ["3:4", "4:3"]), { mode: "custom", missing: [] });
});

test("小红书横屏视频使用 row 布局时也能找到封面入口", async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section class="publish-page-content-cover">
        <div class="publish-page-content-cover-content">
          <div class="cover">
            <div class="operator default row center noCover pointer">修改封面</div>
          </div>
        </div>
      </section>
    `);
    const entry = await findXiaohongshuCoverEntry(page, 1_000);
    assert.equal(await entry.innerText(), "修改封面");
    assert.equal(await entry.evaluate(element => element.classList.contains("row")), true);
  } finally {
    await browser.close();
  }
});

test("抖音默认封面按文字设置横封面后返回竖封面完成", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="coverControl-CjlzqC">竖封面<div class="filter-k_CjvJ">选择封面</div></div>
      <div class="coverControl-CjlzqC">横封面</div>
      <div id="dy-creator-content-modal-body" style="display:none">
        <div class="steps-cgzd9T">
          <div id="horizontal" class="step-dXVbPX step-active-AWDV7U"><span>设置横封面</span></div>
          <div id="vertical" class="step-dXVbPX"><span>设置竖封面</span></div>
        </div>
        <button id="set-other" class="semi-button semi-button-primary primary-RstHX_"><span class="semi-button-content">设置竖封面</span></button>
        <button id="complete" class="semi-button semi-button-primary semi-button-light secondary-zU1YLr"><span class="semi-button-content">完成</span></button>
      </div>
      <script>
        window.coverActions = [];
        const modal = document.getElementById('dy-creator-content-modal-body');
        const vertical = document.getElementById('vertical');
        const horizontal = document.getElementById('horizontal');
        const other = document.getElementById('set-other');
        document.querySelector('.filter-k_CjvJ').onclick = () => { modal.style.display = 'block'; window.coverActions.push('open'); };
        vertical.onclick = () => {
          vertical.classList.add('step-active-AWDV7U'); horizontal.classList.remove('step-active-AWDV7U');
          other.querySelector('span').textContent = '设置横封面'; window.coverActions.push('vertical');
        };
        other.onclick = () => {
          horizontal.classList.add('step-active-AWDV7U'); vertical.classList.remove('step-active-AWDV7U');
          other.querySelector('span').textContent = '设置竖封面'; window.coverActions.push('set-horizontal');
        };
        document.getElementById('complete').onclick = () => { modal.style.display = 'none'; window.coverActions.push('complete'); };
      </script>
    `);
    await confirmDefaultCover(page, { account: "测试账号", videoWidth: 1080, videoHeight: 1920 }, { key: "douyin", name: "抖音" }, () => {});
    assert.deepEqual(await page.evaluate(() => window.coverActions), ["open", "vertical", "set-horizontal", "vertical", "complete"]);
  } finally {
    await browser.close();
  }
});

test("抖音横屏视频使用默认首帧时从横封面同步设置竖封面", async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="coverControl-CjlzqC">竖封面<div class="filter-k_CjvJ">选择封面</div></div>
      <div class="coverControl-CjlzqC">横封面</div>
      <div id="dy-creator-content-modal-body" style="display:none">
        <div class="steps-cgzd9T">
          <div id="vertical" class="step-dXVbPX"><span>设置竖封面</span></div>
          <div id="horizontal" class="step-dXVbPX step-active-AWDV7U"><span>设置横封面</span></div>
        </div>
        <button id="set-other" class="semi-button semi-button-primary primary-RstHX_"><span class="semi-button-content">设置竖封面</span></button>
        <button id="complete" class="semi-button semi-button-primary semi-button-light secondary-zU1YLr"><span class="semi-button-content">完成</span></button>
      </div>
      <script>
        window.coverActions = [];
        const modal = document.getElementById('dy-creator-content-modal-body');
        const vertical = document.getElementById('vertical');
        const horizontal = document.getElementById('horizontal');
        const other = document.getElementById('set-other');
        document.querySelector('.filter-k_CjvJ').onclick = () => { modal.style.display = 'block'; window.coverActions.push('open'); };
        horizontal.onclick = () => {
          horizontal.classList.add('step-active-AWDV7U'); vertical.classList.remove('step-active-AWDV7U');
          other.querySelector('span').textContent = '设置竖封面'; window.coverActions.push('horizontal');
        };
        other.onclick = () => {
          vertical.classList.add('step-active-AWDV7U'); horizontal.classList.remove('step-active-AWDV7U');
          other.querySelector('span').textContent = '设置横封面'; window.coverActions.push('set-vertical');
        };
        document.getElementById('complete').onclick = () => { modal.style.display = 'none'; window.coverActions.push('complete'); };
      </script>
    `);
    await confirmDefaultCover(page, { account: "测试账号", videoWidth: 1920, videoHeight: 1080 }, { key: "douyin", name: "抖音" }, () => {});
    assert.deepEqual(await page.evaluate(() => window.coverActions), ["open", "horizontal", "set-vertical", "complete"]);
  } finally {
    await browser.close();
  }
});

test("抖音保留正文并用回车确认前五个话题", async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`
      <div class="zone-container editor-kit-container" contenteditable="true" style="width:420px;padding:8px">
        <div class="ace-line">第一段正文保持不变</div>
        <div class="ace-line">最后一段正文保持不变</div>
      </div>
    `);
    const editor = page.locator(".zone-container.editor-kit-container");
    const before = await editor.innerText();
    assert.equal(await appendTopics(page, PLATFORMS.douyin, ["一", "二", "三", "四", "五", "六"]), true);
    const after = (await editor.innerText()).replaceAll("\u00a0", " ");
    assert.equal(after.startsWith(before), true);
    for (const topic of ["一", "二", "三", "四", "五"]) assert.equal(after.includes(`#${topic}`), true);
    assert.equal(after.includes("#六"), false);
  } finally {
    await browser.close();
  }
});

test("B站清理默认标签并等待填满十个用户标签", async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="input-container">
        <div class="tag-pre-wrp" id="chips"></div>
        <input type="text" placeholder="按回车键Enter创建标签">
      </div>
      <script>
        const chips = document.querySelector("#chips");
        const input = document.querySelector("input");
        function addChip(value) {
          if ([...chips.querySelectorAll(".label-item-v2-content")].some(item => item.textContent === value)) return;
          const chip = document.createElement("div");
          chip.className = "label-item-v2-container";
          chip.innerHTML = '<p class="label-item-v2-content">' + value + '</p><button type="button" class="close">×</button>';
          chips.appendChild(chip);
        }
        ["默认一", "默认二", "默认三"].forEach(addChip);
        input.addEventListener("keydown", event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const value = input.value.trim();
          input.value = "";
          setTimeout(() => addChip(value), 45);
        });
        chips.addEventListener("click", event => {
          if (event.target.classList.contains("close")) event.target.parentElement.remove();
        });
      </script>
    `);
    const requested = Array.from({ length: 10 }, (_, index) => `标签${index + 1}`);
    assert.equal(await appendTopics(page, PLATFORMS.bilibili, requested), true);
    assert.deepEqual(await page.locator(".label-item-v2-content").allInnerTexts(), requested);
  } finally {
    await browser.close();
  }
});

test("B站拒绝某个自定义标签后会跳过并继续添加后续标签", async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="input-container">
        <div class="tag-pre-wrp" id="chips"></div>
        <input type="text" placeholder="按回车键Enter创建标签">
      </div>
      <div id="notices"></div>
      <script>
        const chips = document.querySelector("#chips");
        const input = document.querySelector("input");
        function addChip(value) {
          const chip = document.createElement("div");
          chip.className = "label-item-v2-container";
          chip.innerHTML = '<p class="label-item-v2-content">' + value + '</p><button type="button" class="close">×</button>';
          chips.appendChild(chip);
        }
        ["学习", "生活记录", "记录"].forEach(addChip);
        input.addEventListener("keydown", event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const value = input.value.trim();
          input.value = "";
          if (value === "独立开发者") {
            const notice = document.createElement("div");
            notice.setAttribute("role", "alert");
            notice.textContent = "不能自定义添加该标签，只能去搜索添加";
            document.querySelector("#notices").appendChild(notice);
            setTimeout(() => notice.remove(), 300);
            return;
          }
          setTimeout(() => addChip(value), 45);
        });
        chips.addEventListener("click", event => {
          if (event.target.classList.contains("close")) event.target.parentElement.remove();
        });
      </script>
    `);
    const skipped = [];
    const requested = ["小黑日报助手", "职场", "独立开发者", "工作复盘", "最后一个"];
    assert.equal(await appendTopics(page, PLATFORMS.bilibili, requested, topic => skipped.push(topic)), true);
    assert.deepEqual(await page.locator(".label-item-v2-content").allInnerTexts(), ["小黑日报助手", "职场", "工作复盘", "最后一个"]);
    assert.deepEqual(skipped, ["独立开发者"]);
  } finally {
    await browser.close();
  }
});

test("B站可选择挂在页面浮层中的创作声明并正确验证", async () => {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="creation-statement-container">
        <div class="bcc-select-input-wrap"><span class="bcc-select-input-value">请选择创作声明</span></div>
      </div>
      <ul class="bcc-select-dropdown" role="listbox" hidden>
        <li class="bcc-option" role="option">内容无需标注</li>
        <li class="bcc-option" role="option">含AI生成内容</li>
      </ul>
      <script>
        const trigger = document.querySelector(".bcc-select-input-wrap");
        const dropdown = document.querySelector(".bcc-select-dropdown");
        trigger.addEventListener("click", () => { dropdown.hidden = false; });
        dropdown.addEventListener("click", event => {
          const option = event.target.closest(".bcc-option");
          if (!option) return;
          document.querySelectorAll(".bcc-option").forEach(item => item.removeAttribute("aria-selected"));
          option.setAttribute("aria-selected", "true");
          trigger.querySelector(".bcc-select-input-value").textContent = option.textContent;
          dropdown.hidden = true;
        });
      </script>
    `);
    await setRights(page, {
      account: "测试账号",
      declaration: "含AI生成内容",
      original: false
    }, () => {}, PLATFORMS.bilibili);
    assert.equal(await page.locator(".bcc-select-input-value").innerText(), "含AI生成内容");
  } finally {
    await browser.close();
  }
});
