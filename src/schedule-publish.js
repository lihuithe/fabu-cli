import { safeClick } from "./browser-utils.js";
import { scheduledTimeStatus } from "./platforms.js";
import { DateTime } from 'luxon';

const TOGGLE_SELECTORS = Object.freeze({
  douyin: [
    'label.radio-d4zkru:has(input.radio-native-p6VBGt[value="1"]):has-text("定时发布")',
    'label:has(input[value="1"]):has-text("定时发布")'
  ],
  xiaohongshu: [
    '.post-time-switch-container .d-switch-simulator:has(input[type="checkbox"][value="true"])',
    '.post-time-wrapper .d-switch-simulator:has(input[type="checkbox"][value="true"])',
    ".post-time-switch-container .custom-switch-card",
    '.post-time-wrapper [class*="switch"]:has-text("定时发布")'
  ],
  bilibili: [
    '.time-container:has-text("定时发布") .switch-container',
    '.time-container:has-text("定时发布") .switch-roll'
  ],
  channels: [
    'label:has-text("定时")',
    '[role="radio"]:has-text("定时")',
    'input[type="radio"][value="1"]'
  ]
});

const INPUT_SELECTORS = Object.freeze({
  douyin: [
    'input.semi-input[format="yyyy-MM-dd HH:mm"][placeholder="日期和时间"]',
    'input[type="datetime-local"]',
    'input[placeholder*="日期"]',
    'input[placeholder*="时间"]',
    '[class*="date"] input:not([type="checkbox"])',
    '[class*="time"] input:not([type="checkbox"])'
  ],
  xiaohongshu: [
    '.post-time-wrapper input:not([type="checkbox"])',
    'input[type="datetime-local"]',
    'input[placeholder*="日期"]',
    'input[placeholder*="时间"]'
  ],
  bilibili: [
    '.time-container input:not([type="checkbox"])',
    'input[type="datetime-local"]',
    'input[placeholder*="日期"]',
    'input[placeholder*="时间"]'
  ],
  channels: [
    'input[type="datetime-local"]',
    'input[placeholder*="日期"]',
    'input[placeholder*="时间"]',
    '[class*="date"] input:not([type="radio"]):not([type="checkbox"])',
    '[class*="time"] input:not([type="radio"]):not([type="checkbox"])'
  ]
});

function scopesFor(page, platformKey) {
  if (platformKey !== "channels") return [page];
  const frames = typeof page.frames === "function" ? page.frames() : [];
  return frames.length ? frames : [page];
}

async function visibleCandidates(scopes, selectors) {
  const candidates = [];
  const seen = new Set();
  for (const scope of scopes) {
    for (const selector of selectors) {
      try {
        const matches = scope.locator(selector);
        for (let index = 0; index < await matches.count(); index += 1) {
          const item = matches.nth(index);
          if (!(await item.isVisible({ timeout: 80 }).catch(() => false))) continue;
          const identity = await item.evaluate((element) => {
            if (!element.dataset.scheduleIdentity) element.dataset.scheduleIdentity = `schedule-${Math.random().toString(36).slice(2)}`;
            return element.dataset.scheduleIdentity;
          });
          if (seen.has(identity)) continue;
          seen.add(identity);
          candidates.push(item);
        }
      } catch {}
    }
  }
  return candidates;
}

async function findToggle(scopes, platformKey) {
  const selectors = TOGGLE_SELECTORS[platformKey] || [];
  for (const scope of scopes) {
    for (const selector of selectors) {
      try {
        const candidates = scope.locator(selector);
        for (let index = 0; index < await candidates.count(); index += 1) {
          const candidate = candidates.nth(index);
          if (!(await candidate.isVisible({ timeout: 100 }).catch(() => false))) continue;
          if (platformKey === "channels") {
            const text = (await candidate.innerText({ timeout: 100 }).catch(() => "")).trim();
            if (text && text !== "定时" && !text.includes("定时发表")) continue;
          }
          return candidate;
        }
      } catch {}
    }
  }
  return null;
}

async function waitForToggle(page, scopes, platformKey, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const toggle = await findToggle(scopes, platformKey);
    if (toggle) return toggle;
    await page.waitForTimeout(150);
  }
  return null;
}

async function alreadyEnabled(toggle) {
  try {
    const input = toggle.locator('input[type="checkbox"], input[type="radio"]').first();
    if (await input.count() && await input.isChecked()) return true;
  } catch {}
  try {
    return await toggle.evaluate((element) => {
      const className = String(element.className || "");
      return element.getAttribute("aria-checked") === "true"
        || element.getAttribute("data-checked") === "true"
        || /(?:^|\s)(?:checked|active|on)(?:\s|$)/i.test(className);
    });
  } catch { return false; }
}

async function enableDouyinScheduleToggle(page, toggle) {
  if (await alreadyEnabled(toggle)) return false;
  await toggle.scrollIntoViewIfNeeded().catch(() => {});
  await safeClick(toggle, "开启抖音定时发布选择框");
  let deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await alreadyEnabled(toggle)) return true;
    await page.waitForTimeout(80);
  }
  const text = toggle.locator("span").filter({ hasText: "定时发布" }).first();
  if (await text.count()) await safeClick(text, "再次开启抖音定时发布选择框");
  deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await alreadyEnabled(toggle)) return true;
    await page.waitForTimeout(80);
  }
  throw new Error("抖音“定时发布”选择框点击后没有变为选中状态");
}

function inputKind(metadata, candidateCount) {
  const type = metadata.type.toLowerCase();
  const hint = `${metadata.placeholder} ${metadata.className} ${metadata.name}`.toLowerCase();
  if (type === "datetime-local") return "datetime";
  if (type === "date" || /日期|date/.test(hint) && !/时间|time/.test(hint)) return "date";
  if (type === "time" || /时间|time/.test(hint) && !/日期|date/.test(hint)) return "time";
  return candidateCount === 1 ? "datetime" : "unknown";
}

async function writeInput(input, value) {
  try {
    await input.click({ timeout: 1_000 });
    await input.fill(value, { timeout: 1_000 });
    if ((await input.getAttribute("type") || "text").toLowerCase() === "text") await input.press("Enter").catch(() => {});
    await input.press("Tab").catch(() => {});
  } catch {
    await input.evaluate((element, nextValue) => {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, nextValue);
      else element.value = nextValue;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
    }, value);
  }
  return input.evaluate(element => String(element.value ?? ""));
}

async function waitForInputs(page, scopes, platformKey, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidates = await visibleCandidates(scopes, INPUT_SELECTORS[platformKey] || []);
    if (candidates.length) return candidates;
    await page.waitForTimeout(150);
  }
  return [];
}

async function waitVisibleLocator(page, selectors, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const candidates = page.locator(selector);
      for (let index = 0; index < await candidates.count(); index += 1) {
        const candidate = candidates.nth(index);
        if (await candidate.isVisible({ timeout: 80 }).catch(() => false)) return candidate;
      }
    }
    await page.waitForTimeout(120);
  }
  return null;
}

async function douyinDateDay(page, date) {
  const days = page.locator(`.semi-datepicker-day[title="${date}"]`);
  for (let index = 0; index < await days.count(); index += 1) {
    const day = days.nth(index);
    if (await day.isVisible({ timeout: 80 }).catch(() => false)) return day;
  }
  return null;
}

async function navigateDouyinDate(page, parts) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const target = await douyinDateDay(page, parts.date);
    if (target) {
      const className = String(await target.getAttribute("class") || "");
      if (className.includes("semi-datepicker-day-disabled")) throw new Error(`抖音当前不允许选择日期 ${parts.date}`);
      if (!className.includes("semi-datepicker-day-selected")) await safeClick(target, `选择抖音定时发布日期 ${parts.date}`);
      return true;
    }
    const visibleTitles = [];
    const days = page.locator(".semi-datepicker-day[title]");
    for (let index = 0; index < await days.count(); index += 1) {
      const day = days.nth(index);
      if (!(await day.isVisible({ timeout: 50 }).catch(() => false))) continue;
      const title = await day.getAttribute("title");
      if (title) visibleTitles.push(title);
    }
    if (!visibleTitles.length) throw new Error("抖音日期面板未显示可识别的年月日");
    visibleTitles.sort();
    const forward = parts.date > visibleTitles[visibleTitles.length - 1];
    const selectors = forward
      ? [".semi-datepicker-navigation-right", 'button:has(.semi-icons-chevron_right)', ".semi-datepicker-header button:last-of-type"]
      : [".semi-datepicker-navigation-left", 'button:has(.semi-icons-chevron_left)', ".semi-datepicker-header button:first-of-type"];
    const arrow = await waitVisibleLocator(page, selectors, 500);
    if (!arrow) throw new Error(`抖音日期面板无法切换到 ${parts.date.slice(0, 7)}`);
    await safeClick(arrow, "切换抖音定时发布月份");
    await page.waitForTimeout(120);
  }
  throw new Error(`抖音日期面板未找到 ${parts.date}`);
}

function wheelNumber(text) {
  const value = Number.parseInt(String(text).replace(/\D/g, ""), 10);
  return Number.isInteger(value) ? String(value).padStart(2, "0") : "";
}

async function selectDouyinWheel(page, wheelSelector, targetValue, label) {
  const wheel = await waitVisibleLocator(page, [wheelSelector]);
  if (!wheel) throw new Error(`抖音时间面板未找到${label}滚轮`);
  const options = wheel.locator("li");
  let selectedIndex = -1;
  const matchingIndexes = [];
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    const className = String(await option.getAttribute("class") || "");
    if (className.includes("semi-scrolllist-item-selected")) {
      selectedIndex = index;
      if (wheelNumber(await option.innerText()) === targetValue) return true;
    }
    if (wheelNumber(await option.innerText()) === targetValue) matchingIndexes.push(index);
  }
  if (!matchingIndexes.length) throw new Error(`抖音${label}滚轮未找到 ${targetValue}`);

  const selectedMatchesTarget = async (timeoutMs = 600) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const current = wheel.locator("li.semi-scrolllist-item-selected");
      for (let index = 0; index < await current.count(); index += 1) {
        if (wheelNumber(await current.nth(index).innerText()) === targetValue) return true;
      }
      await page.waitForTimeout(60);
    }
    return false;
  };

  // 抖音会重复渲染两轮相同文本，当前项可能落在任意一轮。
  // 直接触发传入时分对应的文本项；若一轮副本不响应，再尝试另一轮。
  const orderedIndexes = [...matchingIndexes].sort((left, right) => (
    selectedIndex < 0 ? left - right : Math.abs(left - selectedIndex) - Math.abs(right - selectedIndex)
  ));
  for (const targetIndex of orderedIndexes) {
    const option = options.nth(targetIndex);
    await option.evaluate(element => element.click()).catch(() => {});
    if (await selectedMatchesTarget()) return true;
    await safeClick(option, `选择抖音定时发布${label} ${targetValue}`, { force: true }).catch(() => {});
    if (await selectedMatchesTarget()) return true;
  }

  const current = wheel.locator("li.semi-scrolllist-item-selected");
  for (let index = 0; index < await current.count(); index += 1) {
    if (wheelNumber(await current.nth(index).innerText()) === targetValue) return true;
  }
  throw new Error(`抖音${label}选择 ${targetValue} 后未生效`);
}

async function closeDouyinSchedulePicker(page, picker) {
  const panelBox = await picker.boundingBox();
  const metrics = await picker.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
  });
  if (!panelBox) throw new Error("抖音定时面板位置读取失败，无法安全点击框外区域");
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const candidates = [
    { x: metrics.right + 120, y: metrics.top + 160 },
    { x: metrics.right + 70, y: metrics.top + 160 },
    { x: metrics.right + 120, y: metrics.top + 95 },
    { x: metrics.left - 70, y: metrics.top + 160 }
  ].map(point => ({ x: clamp(point.x, 12, metrics.width - 12), y: clamp(point.y, 12, metrics.height - 12) }));
  let clickedOutside = false;
  for (const point of candidates) {
    const safe = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      if (!target || target.closest(".semi-datepicker")) return false;
      return !target.closest('button,a,input,textarea,select,label,[role="button"],[role="combobox"],[contenteditable="true"]');
    }, point).catch(() => false);
    if (!safe) continue;
    await page.mouse.click(point.x, point.y);
    clickedOutside = true;
    await page.waitForTimeout(180);
    const pickerClosed = !(await picker.isVisible({ timeout: 80 }).catch(() => false));
    const wheels = page.locator(".semi-scrolllist-body");
    let wheelClosed = true;
    for (let index = 0; index < await wheels.count(); index += 1) {
      if (await wheels.nth(index).isVisible({ timeout: 80 }).catch(() => false)) {
        wheelClosed = false;
        break;
      }
    }
    if (pickerClosed && wheelClosed) return true;
  }
  if (clickedOutside) return true;
  throw new Error("抖音定时发布时间已选择，但未找到可安全点击的框外区域");
}

async function setDouyinScheduledPublish(page, parts) {
  const input = await waitVisibleLocator(page, ['input.semi-input[format="yyyy-MM-dd HH:mm"][placeholder="日期和时间"]']);
  if (!input) throw new Error("抖音已开启定时发布，但未找到日期和时间输入框");
  await safeClick(input, "打开抖音日期时间选择面板");
  const picker = await waitVisibleLocator(page, [".semi-datepicker"]);
  if (!picker || !(await waitVisibleLocator(page, [".semi-datepicker-month"]))) throw new Error("抖音日期时间输入框点击后未弹出日期面板");
  await navigateDouyinDate(page, parts);
  const timeSwitch = await waitVisibleLocator(page, [".semi-datepicker-switch-time"]);
  if (!timeSwitch) throw new Error("抖音日期面板未找到时间切换区域");
  await safeClick(timeSwitch, "打开抖音时分选择面板");
  if (!(await waitVisibleLocator(page, [".semi-scrolllist-body"]))) throw new Error("抖音时间切换区域点击后未弹出时分滚轮");
  const [hour, minute] = parts.time.split(":");
  await selectDouyinWheel(page, ".semi-scrolllist-item-wheel.undefined-list-hour", hour, "小时");
  await selectDouyinWheel(page, ".semi-scrolllist-item-wheel.undefined-list-minute", minute, "分钟");
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (String(await input.inputValue().catch(() => "")).trim() === parts.datetime) {
      await closeDouyinSchedulePicker(page, picker);
      return true;
    }
    await page.waitForTimeout(80);
  }
  throw new Error(`抖音时间选择后未显示 ${parts.datetime}`);
}

async function xhsPanelMonth(popover) {
  const labels = popover.locator(".d-datepicker-selector h6");
  if (await labels.count() < 2) return null;
  const year = Number.parseInt((await labels.nth(0).innerText()).replace(/\D/g, ""), 10);
  const month = Number.parseInt((await labels.nth(1).innerText()).replace(/\D/g, ""), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  return { year, month, stamp: year * 12 + month - 1 };
}

async function selectXhsDate(page, popover, parts) {
  const [targetYear, targetMonth, targetDay] = parts.date.split("-").map(Number);
  const targetStamp = targetYear * 12 + targetMonth - 1;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await xhsPanelMonth(popover);
    if (!current) throw new Error("小红书日期面板未显示有效的年份和月份");
    if (current.stamp === targetStamp) {
      const cells = popover.locator(".d-datepicker-dates .d-datepicker-cell.d-clickable:not(.disabled)");
      for (let index = 0; index < await cells.count(); index += 1) {
        const cell = cells.nth(index);
        if ((await cell.innerText()).trim() !== String(targetDay)) continue;
        const className = String(await cell.getAttribute("class") || "");
        if (!className.includes("picked")) await safeClick(cell, `选择小红书定时发布日期 ${parts.date}`);
        return true;
      }
      throw new Error(`小红书当前不允许选择日期 ${parts.date}`);
    }
    const arrows = popover.locator(".d-datepicker-header > .--space-p-extra-small .d-clickable");
    const arrowIndex = targetStamp > current.stamp ? 2 : 1;
    if (await arrows.count() <= arrowIndex) throw new Error(`小红书日期面板无法切换到 ${targetYear}年${targetMonth}月`);
    await safeClick(arrows.nth(arrowIndex), "切换小红书定时发布月份");
    await page.waitForTimeout(120);
  }
  throw new Error(`小红书日期面板未能切换到 ${targetYear}年${targetMonth}月`);
}

async function selectXhsTimeColumn(page, popover, columnIndex, targetValue, label) {
  const columns = popover.locator(".d-timepicker-timebar");
  if (await columns.count() <= columnIndex) throw new Error(`小红书时间面板未找到${label}列表`);
  const column = columns.nth(columnIndex);
  const options = column.locator(".d-timepicker-time.d-clickable");
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    if (wheelNumber(await option.innerText()) !== targetValue) continue;
    const className = String(await option.getAttribute("class") || "");
    if (!className.includes("active")) await safeClick(option, `选择小红书定时发布${label} ${targetValue}`);
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      const active = column.locator(".d-timepicker-time.active").first();
      if (await active.count() && wheelNumber(await active.innerText()) === targetValue) return true;
      await page.waitForTimeout(80);
    }
    // 小红书偶尔不会及时把 active 类同步到被点击项，最终以外层日期时间输入框的值为准。
    return true;
  }
  throw new Error(`小红书${label}列表未找到 ${targetValue}`);
}

async function closeXhsSchedulePicker(page, popover) {
  try {
    if (page.isClosed() || !(await popover.isVisible({ timeout: 200 }).catch(() => false))) return true;
    const box = await popover.boundingBox({ timeout: 500 }).catch(() => null);
    if (!box) return true;
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).catch(() => null);
    if (!viewport) return true;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const candidates = [
      { x: box.x + box.width + 90, y: box.y + 110 },
      { x: box.x - 70, y: box.y + 110 },
      { x: box.x + box.width + 45, y: box.y + 180 }
    ].map(point => ({ x: clamp(point.x, 12, viewport.width - 12), y: clamp(point.y, 12, viewport.height - 12) }));
    for (const point of candidates) {
      const safe = await page.evaluate(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        if (!target || target.closest(".post-time-date-picker-popover-class")) return false;
        return !target.closest('button,a,input,textarea,select,label,[role="button"],[role="combobox"],[contenteditable="true"]');
      }, point).catch(() => false);
      if (!safe) continue;
      await page.mouse.click(point.x, point.y).catch(() => {});
      await page.waitForTimeout(150).catch(() => {});
      return true;
    }
    return true;
  } catch {
    // 时间值已验证正确；弹层或页面在善后阶段被小红书销毁时不应把任务误判为失败。
    return true;
  }
}

async function setXhsScheduledPublish(page, parts) {
  const input = await waitVisibleLocator(page, [
    ".post-time-wrapper input.d-text:not([type=\"checkbox\"])",
    ".post-time-wrapper input.d-text"
  ]);
  if (!input) throw new Error("小红书已开启定时发布，但未找到日期时间输入框");
  await safeClick(input, "打开小红书日期时间选择面板");
  const popover = await waitVisibleLocator(page, [".post-time-date-picker-popover-class"]);
  if (!popover) throw new Error("小红书日期时间输入框点击后未弹出选择面板");
  await selectXhsDate(page, popover, parts);
  const [hour, minute] = parts.time.split(":");
  await selectXhsTimeColumn(page, popover, 0, hour, "小时");
  await selectXhsTimeColumn(page, popover, 1, minute, "分钟");
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (String(await input.inputValue().catch(() => "")).trim() === parts.datetime) {
      await closeXhsSchedulePicker(page, popover);
      return true;
    }
    await page.waitForTimeout(80);
  }
  throw new Error(`小红书时间选择后未显示 ${parts.datetime}`);
}

async function waitBiliPickerOption(page, selectors, acceptedTexts, timeoutMs = 5_000, scope = page) {
  const accepted = new Set(acceptedTexts.map(value => String(value).trim()));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const candidates = scope.locator(selector);
      for (let index = 0; index < await candidates.count(); index += 1) {
        const candidate = candidates.nth(index);
        if (!(await candidate.isVisible({ timeout: 60 }).catch(() => false))) continue;
        const text = (await candidate.innerText().catch(() => "")).trim();
        if (!accepted.has(text)) continue;
        const className = String(await candidate.getAttribute("class") || "");
        if (/disabled/i.test(className) || await candidate.getAttribute("aria-disabled") === "true") continue;
        return candidate;
      }
    }
    await page.waitForTimeout(100);
  }
  return null;
}

async function biliPickerMonth(picker) {
  const title = (await picker.locator(".date-picker-nav-title").first().innerText().catch(() => "")).trim();
  const match = /(\d{4})\s*年\s*0?(\d{1,2})\s*月/.exec(title);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month, stamp: year * 12 + month - 1 };
}

async function biliMonthArrow(picker, movingForward) {
  const selector = movingForward ? ".next-btn-month" : ".prev-btn-month";
  const arrow = picker.locator(`.date-picker-nav-wrp ${selector}`).first();
  if (!(await arrow.isVisible({ timeout: 200 }).catch(() => false))) return null;
  const className = String(await arrow.getAttribute("class") || "");
  if (className.includes("date-select-disabled") || await arrow.getAttribute("aria-disabled") === "true") return null;
  return arrow;
}

async function setBiliDate(page, trigger, parts) {
  const shown = trigger.locator(".date-show").first();
  if ((await shown.innerText()).trim() === parts.date) return true;
  await safeClick(trigger, "打开B站定时发布日期选择框");
  const picker = await waitVisibleLocator(page, [".date-picker-container"], 2_000);
  if (!picker) throw new Error("B站定时发布日期选择框打开后未显示日期面板");
  const [targetYear, targetMonth] = parts.date.split("-").map(Number);
  const targetStamp = targetYear * 12 + targetMonth - 1;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const current = await biliPickerMonth(picker);
    if (!current) throw new Error("B站日期选择面板未能识别当前年月");
    if (current.stamp === targetStamp) break;
    const movingForward = current.stamp < targetStamp;
    const arrow = await biliMonthArrow(picker, movingForward);
    if (!arrow) {
      throw new Error(`B站日期面板不允许切换到 ${targetYear}年${targetMonth}月`);
    }
    await safeClick(arrow, `切换B站日期面板到${movingForward ? "下一月" : "上一月"}`);
    const changeDeadline = Date.now() + 1_200;
    let changed = false;
    while (Date.now() < changeDeadline) {
      const next = await biliPickerMonth(picker);
      if (next && next.stamp !== current.stamp) {
        changed = true;
        break;
      }
      await page.waitForTimeout(80);
    }
    if (!changed) throw new Error(`B站日期面板点击${movingForward ? "下一月" : "上一月"}后月份没有变化`);
  }
  const current = await biliPickerMonth(picker);
  if (!current || current.stamp !== targetStamp) throw new Error(`B站日期面板未切换到 ${targetYear}年${targetMonth}月`);
  const targetDay = String(Number(parts.date.slice(-2)));
  const option = await waitBiliPickerOption(page, [
    '.date-wrp .date-picker-body-item.date-item:not(.date-item-disabled)',
    '.date-wrp .date-picker-body-item:not(.date-item-disabled)',
    `[data-date="${parts.date}"]`,
    `[data-value="${parts.date}"]`,
    `[title="${parts.date}"]`,
    '.date-picker-date-panel [class*="cell"]',
    '[class*="calendar"] [class*="day"]',
    '[class*="date-picker"] [class*="day"]',
    '.date-picker-date-panel li'
  ], [parts.date, targetDay], 5_000, picker);
  if (!option) throw new Error(`B站日期选择面板未找到 ${parts.date}`);
  await safeClick(option, `选择B站定时发布日期 ${parts.date}`);
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if ((await shown.innerText().catch(() => "")).trim() === parts.date) return true;
    await page.waitForTimeout(80);
  }
  throw new Error(`B站日期选择后未显示 ${parts.date}`);
}

async function setBiliTime(page, trigger, parts) {
  const shown = trigger.locator(".date-show").first();
  if ((await shown.innerText()).trim() === parts.time) return true;
  await safeClick(trigger, "打开B站定时发布时刻选择框");
  let columns = page.locator(".time-picker-panel-select-wrp");
  const columnsDeadline = Date.now() + 2_000;
  while (Date.now() < columnsDeadline) {
    const visibleColumns = [];
    for (let index = 0; index < await columns.count(); index += 1) {
      const column = columns.nth(index);
      if (await column.isVisible({ timeout: 60 }).catch(() => false)) visibleColumns.push(column);
    }
    if (visibleColumns.length >= 2) {
      const [hour, minute] = parts.time.split(":");
      const selectColumnValue = async (column, value, label) => {
        const options = column.locator(".time-picker-panel-select-item");
        for (let index = 0; index < await options.count(); index += 1) {
          const option = options.nth(index);
          if ((await option.innerText()).trim() !== value) continue;
          const className = String(await option.getAttribute("class") || "");
          if (className.includes("time-select-disabled")) throw new Error(`B站当前不允许选择${label} ${value}`);
          if (!className.includes("time-selected")) await safeClick(option, `选择B站定时发布${label} ${value}`);
          return true;
        }
        throw new Error(`B站${label}列表未找到 ${value}${label === "分钟" ? "；B站分钟只支持 00、05、10…55" : ""}`);
      };
      await selectColumnValue(visibleColumns[0], hour, "小时");
      columns = page.locator(".time-picker-panel-select-wrp");
      const refreshedMinuteColumns = [];
      for (let index = 0; index < await columns.count(); index += 1) {
        const column = columns.nth(index);
        if (await column.isVisible({ timeout: 60 }).catch(() => false)) refreshedMinuteColumns.push(column);
      }
      if (refreshedMinuteColumns.length < 2) throw new Error("B站小时选择后分钟列表消失");
      await selectColumnValue(refreshedMinuteColumns[1], minute, "分钟");
      const deadline = Date.now() + 1_500;
      while (Date.now() < deadline) {
        if ((await shown.innerText().catch(() => "")).trim() === parts.time) return true;
        await page.waitForTimeout(80);
      }
      throw new Error(`B站时刻选择后未显示 ${parts.time}`);
    }
    await page.waitForTimeout(100);
  }
  const exact = await waitBiliPickerOption(page, [
    `[data-time="${parts.time}"]`,
    `[data-value="${parts.time}"]`,
    `[title="${parts.time}"]`,
    '.date-picker-time-panel [class*="item"]',
    '.date-picker-timer-panel [class*="item"]',
    '[class*="time-picker"] [class*="option"]',
    '[class*="time-picker"] li',
    '.bcc-option'
  ], [parts.time], 1_200);
  if (exact) {
    await safeClick(exact, `选择B站定时发布时刻 ${parts.time}`);
  } else {
    const [hour, minute] = parts.time.split(":");
    const hourOption = await waitBiliPickerOption(page, [
      '[class*="hour"] [class*="item"]',
      '[class*="hour"] [class*="option"]',
      '[class*="hour"] li'
    ], [hour, String(Number(hour))]);
    if (!hourOption) throw new Error(`B站时刻选择面板未找到 ${hour} 时`);
    await safeClick(hourOption, `选择B站定时发布小时 ${hour}`);
    const minuteOption = await waitBiliPickerOption(page, [
      '[class*="minute"] [class*="item"]',
      '[class*="minute"] [class*="option"]',
      '[class*="minute"] li'
    ], [minute, String(Number(minute))]);
    if (!minuteOption) throw new Error(`B站时刻选择面板未找到 ${minute} 分`);
    await safeClick(minuteOption, `选择B站定时发布分钟 ${minute}`);
  }
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if ((await shown.innerText().catch(() => "")).trim() === parts.time) return true;
    await page.waitForTimeout(80);
  }
  throw new Error(`B站时刻选择后未显示 ${parts.time}`);
}

async function closeBiliTimePicker(page, trigger) {
  if (page.isClosed()) return true;
  const pickerIsVisible = async () => {
    const columns = page.locator(".time-picker-panel-select-wrp");
    for (let index = 0; index < await columns.count(); index += 1) {
      if (await columns.nth(index).isVisible({ timeout: 80 }).catch(() => false)) return true;
    }
    return false;
  };
  if (!(await pickerIsVisible())) return true;

  const panels = page.locator('.date-picker-time-panel');
  let box = null;
  for (let index = 0; index < await panels.count(); index += 1) {
    if (!(await panels.nth(index).isVisible({ timeout: 80 }).catch(() => false))) continue;
    box = await panels.nth(index).boundingBox().catch(() => null);
    if (box) break;
  }
  const viewport = page.viewportSize();
  let clickedOutside = false;
  if (box && viewport) {
    const candidates = [
      { x: box.x + box.width + 120, y: box.y + box.height + 40 },
      { x: box.x + box.width + 120, y: box.y + box.height / 2 },
      { x: box.x - 80, y: box.y + box.height + 40 }
    ];
    for (const candidate of candidates) {
      const point = {
        x: Math.max(12, Math.min(viewport.width - 12, candidate.x)),
        y: Math.max(12, Math.min(viewport.height - 12, candidate.y))
      };
      const safe = await page.evaluate(({ x, y }) => {
        const target = document.elementFromPoint(x, y);
        if (!target || target.closest('.date-picker-time-panel,.date-picker-timer')) return false;
        return !target.closest('button,a,input,textarea,select,[role="button"],[contenteditable="true"]');
      }, point).catch(() => false);
      if (!safe) continue;
      await page.mouse.click(point.x, point.y);
      clickedOutside = true;
      break;
    }
  }
  if (!clickedOutside) await safeClick(trigger, "关闭B站定时发布时刻选择框");
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if (!(await pickerIsVisible())) return true;
    await page.waitForTimeout(80);
  }
  throw new Error("B站定时发布时间已选择，但点击时间选择框后面板仍未关闭");
}

async function setBiliScheduledPublish(page, parts) {
  const dateTrigger = await waitVisibleLocator(page, [".date-picker-date-wrp .date-picker-date"]);
  const timeTrigger = await waitVisibleLocator(page, [".date-picker-date-wrp .date-picker-timer"]);
  if (!dateTrigger || !timeTrigger) throw new Error("B站已开启定时发布，但未找到日期和时刻选择框");
  await setBiliDate(page, dateTrigger, parts);
  await setBiliTime(page, timeTrigger, parts);
  await closeBiliTimePicker(page, timeTrigger);
}

async function waitForChannelsPanel(page, scopes, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const scope of scopes) {
      const panels = scope.locator(".weui-desktop-picker__panel_day");
      for (let index = 0; index < await panels.count(); index += 1) {
        const panel = panels.nth(index);
        if (await panel.isVisible({ timeout: 80 }).catch(() => false)) return panel;
      }
    }
    await page.waitForTimeout(150);
  }
  return null;
}

async function waitForChannelsPublishTimeTrigger(page, scopes, timeoutMs = 8_000) {
  const selectors = [
    '.weui-desktop-picker__date-time input.weui-desktop-form__input[placeholder="请选择发表时间"]',
    'input[readonly][placeholder="请选择发表时间"]',
    '.weui-desktop-picker__date-time .weui-desktop-picker__dt'
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const scope of scopes) {
      for (const selector of selectors) {
        const candidates = scope.locator(selector);
        for (let index = 0; index < await candidates.count(); index += 1) {
          const candidate = candidates.nth(index);
          if (await candidate.isVisible({ timeout: 80 }).catch(() => false)) return candidate;
        }
      }
    }
    await page.waitForTimeout(150);
  }
  return null;
}

async function channelsPanelMonth(panel) {
  const labels = panel.locator(".weui-desktop-picker__panel__hd .weui-desktop-picker__panel__label");
  if (await labels.count() < 2) return null;
  const year = Number.parseInt((await labels.nth(0).innerText()).replace(/\D/g, ""), 10);
  const month = Number.parseInt((await labels.nth(1).innerText()).replace(/\D/g, ""), 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  return { year, month, stamp: year * 12 + month - 1 };
}

async function selectChannelsDate(page, panel, parts) {
  const [targetYear, targetMonth, targetDay] = parts.date.split("-").map(Number);
  const targetStamp = targetYear * 12 + targetMonth - 1;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const current = await channelsPanelMonth(panel);
    if (!current) throw new Error("视频号日期面板未显示有效的年份和月份");
    if (current.stamp === targetStamp) break;
    const direction = targetStamp > current.stamp ? "right" : "left";
    const arrow = panel.locator(`.weui-desktop-picker__panel__hd .weui-desktop-btn__icon__${direction}`).first();
    if (!(await arrow.isVisible({ timeout: 150 }).catch(() => false))) throw new Error(`视频号日期面板无法切换到 ${targetYear}年${targetMonth}月`);
    await safeClick(arrow, `切换视频号定时发布月份`);
    await page.waitForTimeout(120);
  }
  const current = await channelsPanelMonth(panel);
  if (!current || current.stamp !== targetStamp) throw new Error(`视频号日期面板未能切换到 ${targetYear}年${targetMonth}月`);

  const days = panel.locator(".weui-desktop-picker__panel__bd .weui-desktop-picker__table a:not(.weui-desktop-picker__faded):not(.weui-desktop-picker__disabled)");
  for (let index = 0; index < await days.count(); index += 1) {
    const day = days.nth(index);
    if ((await day.innerText()).trim() !== String(targetDay)) continue;
    await safeClick(day, `选择视频号定时发布日期 ${parts.date}`);
    return true;
  }
  throw new Error(`视频号当前不允许选择日期 ${parts.date}`);
}

async function channelsTimeOption(panel, selector, value) {
  const options = panel.locator(selector);
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    if ((await option.innerText()).trim() !== value) continue;
    const className = String(await option.getAttribute("class") || "");
    if (className.includes("weui-desktop-picker__disabled")) throw new Error(`视频号当前不允许选择时间 ${value}`);
    return option;
  }
  return null;
}

async function selectChannelsTime(page, panel, parts) {
  const input = panel.locator('input.weui-desktop-form__input[placeholder="请选择时间"]').first();
  if (!(await input.isVisible({ timeout: 500 }).catch(() => false))) throw new Error("视频号日期面板未找到时间输入框");
  await safeClick(input, "打开视频号时间选择列表");
  const [hour, minute] = parts.time.split(":");
  const hourOption = await channelsTimeOption(panel, ".weui-desktop-picker__time__hour li", hour);
  if (!hourOption) throw new Error(`视频号时间列表未找到 ${hour} 时`);
  if (!String(await hourOption.getAttribute("class") || "").includes("weui-desktop-picker__selected")) {
    await safeClick(hourOption, `选择视频号定时发布小时 ${hour}`);
  }
  const minuteOption = await channelsTimeOption(panel, ".weui-desktop-picker__time__minute li", minute);
  if (!minuteOption) throw new Error(`视频号时间列表未找到 ${minute} 分`);
  if (!String(await minuteOption.getAttribute("class") || "").includes("weui-desktop-picker__selected")) {
    await safeClick(minuteOption, `选择视频号定时发布分钟 ${minute}`);
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = String(await input.inputValue().catch(() => "")).trim();
    if (value === parts.time) return true;
    await page.waitForTimeout(80);
  }
  throw new Error(`视频号时间选择后未显示 ${parts.time}`);
}

async function closeChannelsSchedulePicker(page, scopes, panel) {
  let ownerScope = null;
  for (const scope of scopes) {
    const panels = scope.locator(".weui-desktop-picker__panel_day");
    for (let index = 0; index < await panels.count(); index += 1) {
      if (await panels.nth(index).isVisible({ timeout: 80 }).catch(() => false)) {
        ownerScope = scope;
        break;
      }
    }
    if (ownerScope) break;
  }
  if (!ownerScope) return true;
  const panelBox = await panel.boundingBox();
  const metrics = await panel.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
  });
  if (!panelBox) throw new Error("视频号定时面板位置读取失败，无法安全点击框外区域");
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const candidates = [
    { x: metrics.right + 140, y: metrics.top + 82 },
    { x: metrics.right + 70, y: metrics.top + 82 },
    { x: metrics.right + 140, y: metrics.top + 145 },
    { x: metrics.left - 70, y: metrics.top + 82 }
  ].map(point => ({ x: clamp(point.x, 12, metrics.width - 12), y: clamp(point.y, 12, metrics.height - 12) }));

  for (const point of candidates) {
    const safe = await ownerScope.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      if (!target || target.closest(".weui-desktop-picker__panel_day")) return false;
      return !target.closest('button,a,input,textarea,select,label,[role="button"],[role="combobox"],[contenteditable="true"]');
    }, point).catch(() => false);
    if (!safe) continue;
    const mainX = panelBox.x + point.x - metrics.left;
    const mainY = panelBox.y + point.y - metrics.top;
    await page.mouse.click(mainX, mainY);
    await page.waitForTimeout(180);
    if (!(await panel.isVisible({ timeout: 80 }).catch(() => false))) return true;
  }
  throw new Error("视频号定时发布时间已选择，但日期时间面板未能自动关闭");
}

async function setChannelsScheduledPublish(page, scopes, parts) {
  let panel = await waitForChannelsPanel(page, scopes, 250);
  if (!panel) {
    const trigger = await waitForChannelsPublishTimeTrigger(page, scopes);
    if (!trigger) throw new Error("视频号已开启定时发表，但未找到“请选择发表时间”输入框");
    await safeClick(trigger, "打开视频号发表时间选择面板");
    panel = await waitForChannelsPanel(page, scopes);
  }
  if (!panel) throw new Error("视频号已开启定时发表，但未找到日期选择面板");
  await selectChannelsDate(page, panel, parts);
  await selectChannelsTime(page, panel, parts);
  await closeChannelsSchedulePicker(page, scopes, panel);
}

export function scheduledDisplayParts(rawValue, now = Date.now(), timezone) {
  let status;
  if (timezone) {
    const date = DateTime.fromISO(rawValue, { zone: timezone });
    const distance = date.toMillis() - now;
    status = { valid: date.isValid && distance >= 5 * 60_000 && distance <= 15 * 86_400_000, value: rawValue, message: '定时发布时间必须在未来 5 分钟至 15 天内' };
  } else status = scheduledTimeStatus(rawValue, now);
  if (!status.valid) throw new Error(status.message);
  const [date, time] = status.value.split("T");
  return { value: status.value, date, time, datetime: `${date} ${time}` };
}

function submittedDouyinScheduleParts(rawValue) {
  const value = String(rawValue ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("抖音定时发布时间格式无效");
  const [, date, time] = match;
  return { value, date, time, datetime: `${date} ${time}` };
}

export async function setScheduledPublish(page, platform, rawValue, log = () => {}, { timezone } = {}) {
  if (!rawValue) return true;
  const parts = platform.key === "douyin"
    ? submittedDouyinScheduleParts(rawValue)
    : scheduledDisplayParts(rawValue, Date.now(), timezone);
  const scopes = scopesFor(page, platform.key);
  const toggle = await waitForToggle(page, scopes, platform.key);
  if (!toggle) throw new Error(`${platform.name}未找到定时发布开关`);
  if (platform.key === "douyin") {
    const clicked = await enableDouyinScheduleToggle(page, toggle);
    if (clicked) log("已点击并选中定时发布选择框");
  } else if (!(await alreadyEnabled(toggle))) {
    await safeClick(toggle, `开启${platform.name}定时发布`);
  }
  if (platform.key === "douyin") {
    await setDouyinScheduledPublish(page, parts);
    log(`已选择定时发布时间：${parts.datetime}`);
    return true;
  }
  if (platform.key === "xiaohongshu") {
    await setXhsScheduledPublish(page, parts);
    log(`已选择定时发布时间：${parts.datetime}`);
    return true;
  }
  if (platform.key === "bilibili") {
    await setBiliScheduledPublish(page, parts);
    log(`已选择定时发布时间：${parts.datetime}`);
    return true;
  }
  if (platform.key === "channels") {
    await setChannelsScheduledPublish(page, scopes, parts);
    log(`已选择定时发布时间：${parts.datetime}`);
    return true;
  }
  const inputs = await waitForInputs(page, scopes, platform.key);
  if (!inputs.length) throw new Error(`${platform.name}已开启定时发布，但未找到日期时间选择框`);

  const metadata = await Promise.all(inputs.map(input => input.evaluate(element => ({
    type: String(element.getAttribute("type") || "text"),
    placeholder: String(element.getAttribute("placeholder") || ""),
    className: String(element.className || ""),
    name: String(element.getAttribute("name") || "")
  }))));
  const kinds = metadata.map(item => inputKind(item, inputs.length));
  const dateIndex = kinds.indexOf("date");
  const timeIndex = kinds.indexOf("time");
  const datetimeIndex = kinds.indexOf("datetime");
  const written = [];
  if (datetimeIndex >= 0) {
    const nativeType = metadata[datetimeIndex].type.toLowerCase();
    written.push(await writeInput(inputs[datetimeIndex], nativeType === "datetime-local" ? parts.value : parts.datetime));
  } else if (dateIndex >= 0 && timeIndex >= 0) {
    written.push(await writeInput(inputs[dateIndex], parts.date));
    written.push(await writeInput(inputs[timeIndex], parts.time));
  } else if (inputs.length >= 2) {
    written.push(await writeInput(inputs[0], parts.date));
    written.push(await writeInput(inputs[1], parts.time));
  } else {
    written.push(await writeInput(inputs[0], parts.datetime));
  }
  const compact = written.join(" ").replace(/[\/\s:T-]/g, "");
  const expected = `${parts.date}${parts.time}`.replace(/[-:]/g, "");
  if (!compact.includes(expected) && !(compact.includes(parts.date.replaceAll("-", "")) && compact.includes(parts.time.replace(":", "")))) {
    throw new Error(`${platform.name}定时发布时间填写后未能通过页面校验`);
  }
  log(`已选择定时发布时间：${parts.datetime}`);
  return true;
}
