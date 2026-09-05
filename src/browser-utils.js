import { DECLARATION_OPTIONS, DECLARATION_TRIGGERS, FINAL_ACTION, splitTopics } from "./platforms.js";

export class CoverUploadError extends Error {}

export async function visibleFirst(page, selectors, timeout = 700) {
  for (const selector of selectors) {
    try {
      const item = page.locator(selector).first();
      if (await item.isVisible({ timeout })) return item;
    } catch {}
  }
  return null;
}

export async function attachedFirst(page, selectors) {
  for (const selector of selectors) {
    try {
      const item = page.locator(selector).first();
      if (await item.count()) return item;
    } catch {}
  }
  return null;
}

export async function safeClick(locator, purpose, options = {}) {
  const { allowFinalAction = false, ...clickOptions } = options;
  if (!allowFinalAction && FINAL_ACTION.test(String(purpose).trim())) throw new Error("安全保护：拒绝点击最终发布按钮");
  try {
    const text = (await locator.innerText({ timeout: 300 })).trim();
    if (!allowFinalAction && FINAL_ACTION.test(text)) throw new Error("安全保护：拒绝点击最终发布按钮");
  } catch (error) {
    if (String(error?.message).includes("安全保护")) throw error;
  }
  await locator.click(clickOptions);
}

export async function fillFirst(page, selectors, value) {
  if (!value) return true;
  const item = await visibleFirst(page, selectors);
  if (!item) return false;
  try {
    await item.fill(value);
  } catch {
    await safeClick(item, "填写资料");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(value, { delay: 12 });
  }
  return true;
}

export async function findVideoInput(page, platform, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of platform.videoInputs) {
      try {
        const item = page.locator(selector).first();
        if (!(await item.count())) continue;
        const accept = ((await item.getAttribute("accept")) ?? "").toLowerCase();
        if (accept.includes("image") && !accept.includes("video")) continue;
        return item;
      } catch {}
    }
    await page.waitForTimeout(250);
  }
  return null;
}

const TOPIC_OPTION_SELECTORS = [
  '[role="option"]',
  '[class*="suggest"] [class*="item"]',
  '[class*="topic"] [class*="item"]',
  ".semi-select-option",
  ".ant-select-item-option"
];

function exactTopicPattern(topic) {
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*#?${escaped}\\s*$`, "i");
}

async function waitTopicOption(page, topic, timeoutMs = 1_600) {
  const deadline = Date.now() + timeoutMs;
  const exact = exactTopicPattern(topic);
  while (Date.now() < deadline) {
    for (const selector of TOPIC_OPTION_SELECTORS) {
      try {
        const candidates = page.locator(selector).filter({ hasText: topic });
        for (let index = 0; index < Math.min(await candidates.count(), 12); index += 1) {
          const candidate = candidates.nth(index);
          if (!(await candidate.isVisible({ timeout: 80 }))) continue;
          if (exact.test((await candidate.innerText({ timeout: 200 })).trim())) return candidate;
          const labels = candidate.getByText(exact);
          for (let labelIndex = 0; labelIndex < Math.min(await labels.count(), 8); labelIndex += 1) {
            const label = labels.nth(labelIndex);
            if (await label.isVisible({ timeout: 80 }) && exact.test((await label.innerText({ timeout: 200 })).trim())) return label;
          }
        }
      } catch {}
    }
    await page.waitForTimeout(100);
  }
  return null;
}

async function focusEditorEnd(page, editor) {
  try {
    await editor.evaluate(element => {
      element.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    return true;
  } catch {
    await safeClick(editor, "定位话题输入位置");
    await page.keyboard.press("Control+End");
    return true;
  }
}

async function waitDouyinEditorStable(page, editor, timeoutMs = 1_800) {
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let stableReads = 0;
  while (Date.now() < deadline) {
    let current = null;
    try { current = await editor.innerText({ timeout: 250 }); } catch {}
    if (current !== null && current === previous) {
      stableReads += 1;
      if (stableReads >= 2) return;
    } else {
      previous = current;
      stableReads = 0;
    }
    await page.waitForTimeout(120);
  }
}

async function focusDouyinEditorEnd(page, editor) {
  try { await page.keyboard.press("Escape"); } catch {}
  try {
    const lines = editor.locator(".ace-line");
    const count = await lines.count();
    if (count) {
      const lastLine = lines.nth(count - 1);
      const box = await lastLine.boundingBox();
      if (box && box.width > 4 && box.height > 4) {
        await safeClick(lastLine, "定位抖音文案最后一行", {
          position: { x: Math.max(2, box.width - 3), y: Math.max(2, box.height - 3) }
        });
      } else await safeClick(lastLine, "定位抖音文案最后一行");
    } else await safeClick(editor, "定位抖音话题输入位置");
    await page.keyboard.press("End");
    await page.keyboard.press("Control+End");
    return await editor.evaluate(element => {
      const selection = window.getSelection();
      return Boolean(selection && selection.rangeCount && selection.isCollapsed && element.contains(selection.anchorNode));
    });
  } catch { return false; }
}

async function bilibiliChip(container, topic) {
  const chips = container.locator(".label-item-v2-container").filter({ hasText: topic });
  for (let index = 0; index < Math.min(await chips.count(), 12); index += 1) {
    const chip = chips.nth(index);
    try {
      const label = chip.locator(".label-item-v2-content").first();
      if ((await label.innerText({ timeout: 150 })).trim() === topic && await chip.isVisible({ timeout: 80 })) return chip;
    } catch {}
  }
  return null;
}

async function bilibiliTopicTexts(container) {
  const chips = container.locator(".label-item-v2-container");
  const values = [];
  for (let index = 0; index < Math.min(await chips.count(), 12); index += 1) {
    try {
      const text = (await chips.nth(index).locator(".label-item-v2-content").first().innerText({ timeout: 250 })).trim();
      if (text) values.push(text);
    } catch {}
  }
  return values;
}

async function removeAllBilibiliTopics(page, container) {
  for (let pass = 0; pass < 20; pass += 1) {
    const chips = container.locator(".label-item-v2-container");
    const before = await chips.count();
    if (!before) return;
    const close = chips.first().locator(".close").first();
    if (!(await close.count()) || !(await close.isVisible({ timeout: 250 }))) throw new Error("B站已有标签缺少可用的删除按钮");
    await safeClick(close, "清空B站已有标签");
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline && await container.locator(".label-item-v2-container").count() >= before) {
      await page.waitForTimeout(100);
    }
    if (await container.locator(".label-item-v2-container").count() >= before) throw new Error("B站已有标签删除后未生效");
  }
  throw new Error("B站已有标签数量异常，无法全部清空");
}

async function bilibiliTopicRejections(page) {
  const rejectionPattern = /不能自定义添加|只能.*搜索添加|请.*搜索.*添加|不支持添加|无法添加|不能添加|标签不存在|添加失败|已达.*上限/;
  const selectors = ['[role="alert"]', ".bcc-toast", ".bcc-message", ".semi-toast-content", ".el-message", '[class*="toast"]'];
  const messages = [];
  for (const selector of selectors) {
    const notices = page.locator(selector);
    for (let index = 0; index < Math.min(await notices.count(), 8); index += 1) {
      const notice = notices.nth(index);
      const text = (await notice.innerText({ timeout: 120 }).catch(() => "")).trim();
      if (text && rejectionPattern.test(text) && await notice.isVisible({ timeout: 80 }).catch(() => false)) messages.push(text);
    }
  }
  return [...new Set(messages)];
}

async function addBilibiliTopic(page, field, container, topic) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if ((await bilibiliTopicTexts(container)).includes(topic)) return true;
    const rejectionBefore = new Set(await bilibiliTopicRejections(page));
    await field.fill(topic);
    await page.waitForTimeout(120);
    await field.press("Enter");
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      if ((await bilibiliTopicTexts(container)).includes(topic)) return true;
      const rejectionAfter = await bilibiliTopicRejections(page);
      if (rejectionAfter.some(message => !rejectionBefore.has(message))) {
        await field.fill("").catch(() => {});
        await field.press("Escape").catch(() => {});
        return false;
      }
      await page.waitForTimeout(120);
    }
  }
  return false;
}

async function appendBilibiliTopics(page, topics, onSkipped = () => {}) {
  const requested = [];
  for (const raw of topics) {
    const topic = raw.replace(/^#+/, "").trim();
    if (topic && !requested.includes(topic)) requested.push(topic);
    if (requested.length >= 10) break;
  }
  if (!requested.length) return true;
  const field = await visibleFirst(page, ['input[placeholder="按回车键Enter创建标签"]', 'input[placeholder*="标签"]', ".tag-input input", 'input[placeholder*="Tag"]']);
  if (!field) return false;
  const container = field.locator('xpath=ancestor::div[contains(@class,"input-container")][1]');
  let previous = null;
  let stableReads = 0;
  const settleDeadline = Date.now() + 5_000;
  while (Date.now() < settleDeadline) {
    const current = (await bilibiliTopicTexts(container)).join("\u0000");
    if (current === previous) stableReads += 1;
    else { previous = current; stableReads = 0; }
    if (stableReads >= 6) break;
    await page.waitForTimeout(180);
  }
  await removeAllBilibiliTopics(page, container);
  let accepted = [];
  const skipped = new Set();
  const markSkipped = topic => {
    if (skipped.has(topic)) return;
    skipped.add(topic);
    onSkipped(topic);
  };
  for (const topic of requested) {
    if (await addBilibiliTopic(page, field, container, topic)) accepted.push(topic);
    else markSkipped(topic);
  }
  let exactReads = 0;
  const verifyDeadline = Date.now() + 8_000;
  while (Date.now() < verifyDeadline) {
    const actual = await bilibiliTopicTexts(container);
    const extras = actual.filter(topic => !accepted.includes(topic));
    if (extras.length) {
      await removeAllBilibiliTopics(page, container);
      const restored = [];
      for (const topic of accepted) {
        if (await addBilibiliTopic(page, field, container, topic)) restored.push(topic);
        else markSkipped(topic);
      }
      accepted = restored;
      exactReads = 0;
      continue;
    }
    const missing = accepted.filter(topic => !actual.includes(topic));
    if (missing.length) {
      for (const topic of missing) {
        if (!(await addBilibiliTopic(page, field, container, topic))) {
          accepted = accepted.filter(item => item !== topic);
          markSkipped(topic);
        }
      }
      exactReads = 0;
      continue;
    }
    exactReads = actual.length === accepted.length ? exactReads + 1 : 0;
    if (exactReads >= 15) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

export async function appendTopics(page, platform, rawTopics, onSkipped = () => {}) {
  const topics = splitTopics(rawTopics);
  if (!topics.length) return true;
  if (platform.key === "bilibili") return appendBilibiliTopics(page, topics, onSkipped);
  const editor = await visibleFirst(page, platform.contents);
  if (!editor) return false;
  if (platform.key === "douyin") {
    await waitDouyinEditorStable(page, editor);
    if (!(await focusDouyinEditorEnd(page, editor))) return false;
    await page.keyboard.press("Enter");
    for (const raw of topics.slice(0, 5)) {
      const topic = raw.replace(/^#+/, "").trim();
      if (!topic) continue;
      await page.keyboard.type("#", { delay: 25 });
      await page.keyboard.type(topic, { delay: 25 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(180);
    }
    return true;
  }
  if (platform.key === "xiaohongshu") {
    await focusEditorEnd(page, editor);
    await page.keyboard.press("Enter");
    for (const raw of topics.slice(0, 10)) {
      const topic = raw.replace(/^#+/, "").trim();
      if (!topic) continue;
      await focusEditorEnd(page, editor);
      const before = await editor.locator("a.tiptap-topic").count();
      await page.keyboard.type(`#${topic}`, { delay: 35 });
      const option = await waitTopicOption(page, topic);
      if (option) {
        await safeClick(option, "选择小红书话题");
        const deadline = Date.now() + 2_000;
        while (Date.now() < deadline && await editor.locator("a.tiptap-topic").count() <= before) await page.waitForTimeout(100);
      } else await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await focusEditorEnd(page, editor);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(250);
    }
    return true;
  }
  for (const raw of topics.slice(0, 10)) {
    const topic = raw.replace(/^#+/, "").trim();
    if (!topic) continue;
    await safeClick(editor, "填写话题");
    await page.keyboard.press("End");
    await page.keyboard.type(` #${topic}`, { delay: 25 });
    await page.waitForTimeout(350);
    const option = await waitTopicOption(page, topic, 500);
    if (option) await safeClick(option, "选择话题");
    else await page.keyboard.press("Enter");
  }
  return true;
}

async function visibleExactText(page, text, timeout = 1_400) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const items = page.getByText(text, { exact: true });
      for (let i = 0; i < Math.min(await items.count(), 12); i += 1) {
        const item = items.nth(i);
        if (await item.isVisible({ timeout: 80 })) return item;
      }
    } catch {}
    await page.waitForTimeout(100);
  }
  return null;
}

async function openDeclaration(page, platformKey) {
  const trigger = await visibleFirst(page, DECLARATION_TRIGGERS[platformKey], 500);
  if (!trigger) return false;
  await safeClick(trigger, "打开平台内容声明");
  await page.waitForTimeout(180);
  return true;
}

async function setDouyinDeclaration(page, declaration) {
  if (!(await openDeclaration(page, "douyin"))) return false;
  const modal = await visibleFirst(page, ['.semi-modal-content:has-text("对作品内容添加声明")', '.semi-modal-content:has-text("请选择声明类型")'], 900);
  if (!modal) return false;
  try {
    const choice = modal.getByText(declaration, { exact: true }).first();
    if (!(await choice.isVisible({ timeout: 500 }))) return false;
    const label = choice.locator("xpath=ancestor::label[1]");
    if (!(await label.count())) return false;
    await safeClick(label, "选择抖音自主声明");
    if (declaration === "内容为转载信息") {
      const source = modal.getByText("取材站外", { exact: true }).first().locator("xpath=ancestor::label[1]");
      if (!(await source.count())) return false;
      await safeClick(source, "选择抖音转载来源");
    }
    await page.waitForTimeout(180);
    const confirm = modal.locator('button.semi-button-primary, button:has-text("确定")').last();
    if (!(await confirm.isVisible({ timeout: 500 }))) return false;
    await safeClick(confirm, "确认抖音自主声明");
    await modal.waitFor({ state: "hidden", timeout: 3_000 });
    return true;
  } catch { return false; }
}

async function setDeclaration(page, platform, declaration) {
  if (!declaration) return true;
  if (!DECLARATION_OPTIONS[platform.key].includes(declaration)) throw new Error(`不支持的${platform.name}声明：${declaration}`);
  if (shouldSkipDeclaration(platform.key, declaration)) return true;
  if (platform.key === "douyin") return setDouyinDeclaration(page, declaration);
  if (platform.key === "bilibili") return setBilibiliDeclaration(page, declaration);
  let choice = await visibleExactText(page, declaration, 180);
  if (!choice && await openDeclaration(page, platform.key)) choice = await visibleExactText(page, declaration);
  if (!choice) return false;
  await safeClick(choice, "选择平台内容声明");
  await page.waitForTimeout(180);
  return true;
}

async function setBilibiliDeclaration(page, declaration) {
  const container = page.locator(".creation-statement-container").first();
  const trigger = container.locator(".bcc-select-input-wrap").first();
  if (!(await trigger.isVisible({ timeout: 2_000 }))) return false;

  const hasSelectedDeclaration = async () => {
    const displayedValues = [];
    displayedValues.push(await trigger.innerText({ timeout: 300 }).catch(() => ""));
    displayedValues.push(await trigger.locator("input").first().inputValue({ timeout: 300 }).catch(() => ""));
    displayedValues.push(...await container.locator(".bcc-select-input-value, .bcc-select-selection-item, [class*='selected-value']").allInnerTexts().catch(() => []));
    if (displayedValues.some(value => String(value).trim().includes(declaration))) return true;

    const selectedOptions = page.locator('li.bcc-option[aria-selected="true"], li.bcc-option.bcc-option-selected, li.bcc-option[class*="selected"], [role="option"][aria-selected="true"]');
    for (let index = 0; index < Math.min(await selectedOptions.count(), 20); index += 1) {
      const text = (await selectedOptions.nth(index).innerText({ timeout: 200 }).catch(() => "")).trim();
      if (text === declaration) return true;
    }
    return false;
  };

  if (await hasSelectedDeclaration()) return true;
  await safeClick(trigger, "打开B站创作声明");
  // B站会把下拉菜单挂到 body 下的浮层，而不是声明容器内部。
  const options = page.locator('li.bcc-option, .bcc-select-dropdown [role="option"], [role="listbox"] [role="option"]');
  let option = null;
  const optionDeadline = Date.now() + 3_000;
  while (Date.now() < optionDeadline && !option) {
    for (let index = 0; index < Math.min(await options.count(), 12); index += 1) {
      const candidate = options.nth(index);
      const text = (await candidate.innerText({ timeout: 200 }).catch(() => "")).trim();
      if (text === declaration && await candidate.isVisible({ timeout: 100 }).catch(() => false)) {
        option = candidate;
        break;
      }
    }
    if (!option) await page.waitForTimeout(120);
  }
  if (!option) return false;
  await safeClick(option, "选择B站创作声明");
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (await hasSelectedDeclaration()) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

export function shouldSkipDeclaration(platformKey, declaration) {
  return platformKey === "xiaohongshu" && declaration === "无需内容标注";
}

async function findXiaohongshuOriginalControls(page, timeout = 500) {
  try {
    const label = page.getByText("原创声明", { exact: true }).first();
    if (!(await label.isVisible({ timeout }))) return null;
    const container = label.locator('xpath=ancestor::*[.//div[contains(concat(" ", normalize-space(@class), " "), " custom-switch-switch ")]][1]');
    const switchControl = container.locator("div.custom-switch-switch div.d-switch.d-clickable").first();
    const box = switchControl.locator('input[type="checkbox"][value="true"]').first();
    if (!(await box.count()) || !(await switchControl.isVisible({ timeout }))) return null;
    return { switchControl, box };
  } catch {
    return null;
  }
}

export async function setXiaohongshuOriginal(page, enabled, controls = null) {
  try {
    const resolved = controls || await findXiaohongshuOriginalControls(page);
    if (!resolved) return false;
    const { switchControl, box } = resolved;
    if (await box.isChecked() === enabled) return true;

    if (!enabled) {
      await safeClick(switchControl, "关闭小红书原创声明");
      const deadline = Date.now() + 1_500;
      while (Date.now() < deadline) {
        if (!(await box.isChecked().catch(() => true))) return true;
        await page.waitForTimeout(80);
      }
      return false;
    }

    await safeClick(switchControl, "打开小红书原创声明");
    const agreementControl = page.locator("div.d-checkbox.d-checkbox-main-label.d-clickable")
      .filter({ hasText: "我已阅读并同意" })
      .first();
    await agreementControl.waitFor({ state: "visible", timeout: 2_000 });
    const agreement = agreementControl.locator('input[type="checkbox"]').first();
    if (!(await agreement.count())) return false;
    if (!(await agreement.isChecked())) await safeClick(agreementControl, "勾选小红书原创声明协议");
    const agreementDeadline = Date.now() + 2_000;
    while (Date.now() < agreementDeadline && !(await agreement.isChecked().catch(() => false))) await page.waitForTimeout(80);
    if (!(await agreement.isChecked().catch(() => false))) return false;

    const confirm = page.getByRole("button", { name: "声明原创", exact: true }).first();
    await confirm.waitFor({ state: "visible", timeout: 2_000 });
    const enableDeadline = Date.now() + 2_000;
    while (Date.now() < enableDeadline && !(await confirm.isEnabled())) await page.waitForTimeout(80);
    if (!(await confirm.isEnabled())) return false;
    await safeClick(confirm, "确认小红书声明原创");

    const checkedDeadline = Date.now() + 3_000;
    while (Date.now() < checkedDeadline) {
      if (await box.isChecked().catch(() => false)) return true;
      await page.waitForTimeout(80);
    }
    return false;
  } catch { return false; }
}

function channelsRoots(page) {
  const roots = [page];
  try {
    for (const frame of page.frames()) {
      if (frame !== page.mainFrame()) roots.push(frame);
    }
  } catch {}
  return roots;
}

async function channelsLocationForm(page) {
  for (const root of channelsRoots(page)) {
    const forms = root.locator(".form-item");
    for (let index = 0; index < Math.min(await forms.count(), 40); index += 1) {
      const form = forms.nth(index);
      const label = form.locator(":scope > .label").first();
      const text = (await label.innerText({ timeout: 150 }).catch(() => "")).trim();
      if (text !== "位置") continue;
      const display = form.locator(".form-item-body .post-position-wrap .position-display-wrap").first();
      if (await display.isVisible({ timeout: 200 }).catch(() => false)) return { root, form, display };
    }
  }
  return null;
}

export async function setChannelsLocationHidden(page) {
  const located = await channelsLocationForm(page);
  if (!located) return false;
  const { form, display } = located;
  const selectedName = form.locator(".position-display .location-name").first();
  if ((await selectedName.innerText({ timeout: 300 }).catch(() => "")).trim() === "不显示位置") return true;

  await safeClick(display, "打开视频号位置下拉框");
  const list = form.locator(".location-filter-wrap .common-option-list-wrap").first();
  await list.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  if (!(await list.isVisible({ timeout: 300 }).catch(() => false))) return false;

  const options = list.locator(".option-item");
  let hiddenOption = null;
  for (let index = 0; index < Math.min(await options.count(), 50); index += 1) {
    const option = options.nth(index);
    const name = option.locator(".location-item-info > .name").first();
    if ((await name.innerText({ timeout: 150 }).catch(() => "")).trim() !== "不显示位置") continue;
    if (await option.isVisible({ timeout: 150 }).catch(() => false)) {
      hiddenOption = option;
      break;
    }
  }
  if (!hiddenOption) return false;
  await safeClick(hiddenOption, "选择视频号不显示位置");

  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if ((await selectedName.innerText({ timeout: 250 }).catch(() => "")).trim() === "不显示位置") return true;
    // 视频号选择“不显示位置”后通常只关闭位置列表，顶部位置文案不一定更新。
    // 列表从可见变为隐藏说明 Vue 已接收并完成了这次选项点击。
    if (!(await list.isVisible({ timeout: 150 }).catch(() => false))) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

const LOCATION_TRIGGER_SELECTORS = Object.freeze({
  douyin: ['button:has-text("添加位置")', '[class*="location"]:has-text("添加位置")', '[class*="poi"]:has-text("添加位置")'],
  xiaohongshu: ['button:has-text("添加地点")', '[class*="location"]:has-text("添加地点")', '[class*="poi"]:has-text("添加地点")'],
  bilibili: ['button:has-text("添加位置")', '[class*="location"]:has-text("添加位置")', '[class*="position"]:has-text("添加位置")']
});

const LOCATION_INPUT_SELECTORS = [
  'input[placeholder*="搜索地点"]',
  'input[placeholder*="搜索位置"]',
  'input[placeholder*="搜索定位"]',
  'input[placeholder*="请输入地点"]',
  'input[placeholder*="请输入位置"]',
  '[class*="location"] input[type="text"]',
  '[class*="position"] input[type="text"]',
  '[class*="poi"] input[type="text"]'
];

const LOCATION_OPTION_SELECTORS = [
  '[class*="location"] [role="option"]',
  '[class*="position"] [role="option"]',
  '[class*="poi"] [role="option"]',
  '[class*="location"] [class*="option"]',
  '[class*="position"] [class*="option"]',
  '[class*="poi"] [class*="item"]',
  '[role="listbox"] [role="option"]'
];

async function firstVisibleFromRoots(roots, selectors, timeout = 300) {
  for (const root of roots) {
    const item = await visibleFirst(root, selectors, timeout);
    if (item) return item;
  }
  return null;
}

async function firstVisibleLocationOption(roots) {
  for (const root of roots) {
    for (const selector of LOCATION_OPTION_SELECTORS) {
      const options = root.locator(selector);
      for (let index = 0; index < Math.min(await options.count(), 30); index += 1) {
        const option = options.nth(index);
        if (await option.isVisible({ timeout: 100 }).catch(() => false)) return option;
      }
    }
  }
  return null;
}

async function setChannelsLocation(page, locationName) {
  const located = await channelsLocationForm(page);
  if (!located) return false;
  const { root, form, display } = located;
  await safeClick(display, "打开视频号位置下拉框");

  let input = null;
  const inputDeadline = Date.now() + 3_000;
  const searchRoots = [root, ...channelsRoots(page).filter(candidate => candidate !== root)];
  while (!input && Date.now() < inputDeadline) {
    for (const searchRoot of searchRoots) {
      const candidates = searchRoot.locator('input.weui-desktop-form__input[placeholder="搜索附近位置"]');
      for (let index = 0; index < await candidates.count(); index += 1) {
        const candidate = candidates.nth(index);
        if (await candidate.isVisible({ timeout: 100 }).catch(() => false)) {
          input = candidate;
          break;
        }
      }
      if (input) break;
    }
    if (!input) await page.waitForTimeout(100);
  }
  if (!input) return false;
  await safeClick(input, "聚焦视频号附近位置输入框");
  await input.press("Control+A");
  await input.press("Backspace");
  await input.pressSequentially(locationName, { delay: 70 });

  const valueDeadline = Date.now() + 2_000;
  while (Date.now() < valueDeadline) {
    if ((await input.inputValue({ timeout: 150 }).catch(() => "")).trim() === locationName) break;
    await page.waitForTimeout(100);
  }
  if ((await input.inputValue({ timeout: 150 }).catch(() => "")).trim() !== locationName) {
    await input.evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(element, value);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, locationName);
  }
  if ((await input.inputValue({ timeout: 300 }).catch(() => "")).trim() !== locationName) return false;

  const search = input.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " weui-desktop-search ")][1]');
  const searchButton = search.locator("button.weui-desktop-search__btn").first();
  if (await searchButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await safeClick(searchButton, "提交视频号地点搜索");
  } else {
    await input.press("Enter");
  }

  await page.waitForTimeout(1_200);
  let list = form.locator(".common-option-list-wrap").first();
  if (!(await list.isVisible({ timeout: 300 }).catch(() => false))) list = root.locator(".common-option-list-wrap").first();
  await list.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  if (!(await list.isVisible({ timeout: 300 }).catch(() => false))) return false;

  const deadline = Date.now() + 8_000;
  let stableSignature = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    const candidates = list.locator(":scope > .option-item");
    const options = [];
    for (let index = 0; index < Math.min(await candidates.count(), 50); index += 1) {
      const option = candidates.nth(index);
      if (!(await option.isVisible({ timeout: 100 }).catch(() => false))) continue;
      const name = (await option.locator(".location-item-info > .name").first().innerText({ timeout: 150 }).catch(() => "")).trim();
      if (!name || name === "不显示位置") continue;
      const text = (await option.innerText({ timeout: 200 }).catch(() => "")).trim();
      options.push({ option, name, text });
    }

    // 视频号的推荐地点名称不一定包含完整搜索词；搜索完成后直接选择第一条地点推荐。
    if (options.length) {
      const signature = options.slice(0, 5).map(({ text }) => text).join("|");
      if (signature === stableSignature) stableCount += 1;
      else {
        stableSignature = signature;
        stableCount = 1;
      }
      if (stableCount >= 3) {
        const first = options[0];
        await safeClick(first.option, "选择视频号位置搜索第一条推荐结果");
        const selectedName = form.locator(".position-display .location-name").first();
        const selectedDeadline = Date.now() + 3_000;
        while (Date.now() < selectedDeadline) {
          const popupVisible = await list.isVisible({ timeout: 100 }).catch(() => false);
          const current = (await selectedName.innerText({ timeout: 150 }).catch(() => "")).trim();
          if (!popupVisible) return true;
          if (current.includes(first.name)) {
            await page.keyboard.press("Escape");
            await list.waitFor({ state: "hidden", timeout: 1_000 }).catch(() => {});
            return !(await list.isVisible({ timeout: 100 }).catch(() => false));
          }
          await page.waitForTimeout(100);
        }
        return false;
      }
    } else {
      stableSignature = "";
      stableCount = 0;
    }
    await page.waitForTimeout(150);
  }
  return false;
}

async function douyinLocationResultList(page, input, select) {
  const popupIds = [];
  for (const locator of [input, select]) {
    for (const attribute of ["aria-controls", "aria-owns"]) {
      const id = await locator.getAttribute(attribute).catch(() => "");
      if (id) popupIds.push(id);
    }
  }
  for (const id of popupIds) {
    const escaped = String(id).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const popup = page.locator(`[id="${escaped}"]`).first();
    const list = popup.locator('.semi-select-option-list[role="listbox"]').first();
    if (await list.isVisible({ timeout: 150 }).catch(() => false)) return list;
  }

  const lists = page.locator('.semi-portal-inner .semi-select-option-list[role="listbox"]');
  for (let index = (await lists.count()) - 1; index >= 0; index -= 1) {
    const list = lists.nth(index);
    if (await list.isVisible({ timeout: 100 }).catch(() => false)) return list;
  }
  return null;
}

async function visibleDouyinLocationOptions(list) {
  if (!list) return [];
  const candidates = list.locator(':scope > .semi-select-option[role="option"]:not(.semi-select-option-disabled):not([aria-disabled="true"])');
  const visible = [];
  for (let index = 0; index < Math.min(await candidates.count(), 30); index += 1) {
    const option = candidates.nth(index);
    if (!(await option.isVisible({ timeout: 100 }).catch(() => false))) continue;
    visible.push({ option, text: (await option.innerText({ timeout: 200 }).catch(() => "")).trim() });
  }
  return visible;
}

async function selectFirstDouyinLocation(page, anchor, list, firstResult) {
  const name = (await firstResult.option.locator('[class*="name-"]').first().innerText({ timeout: 300 }).catch(() => ""))
    .trim() || firstResult.text.split(/\r?\n/)[0].trim();
  await safeClick(firstResult.option, "选择抖音地理位置搜索第一条结果");

  const selectedText = anchor.locator(".semi-select-selection-text").first();
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const popupVisible = await list.isVisible({ timeout: 100 }).catch(() => false);
    const current = (await selectedText.innerText({ timeout: 150 }).catch(() => "")).trim();
    if (!popupVisible) return true;
    if (name && current.includes(name)) {
      await page.keyboard.press("Escape");
      await list.waitFor({ state: "hidden", timeout: 1_000 }).catch(() => {});
      return !(await list.isVisible({ timeout: 100 }).catch(() => false));
    }
    await page.waitForTimeout(100);
  }
  return false;
}

function douyinLocationResultsMatch(options, locationName) {
  const normalize = value => String(value ?? "").toLowerCase().replace(/[\s，,。·\-_/]+/g, "").replace(/[省市区县镇乡]+/g, "");
  const keyword = normalize(locationName);
  if (!keyword) return false;
  const suffix = keyword.length >= 2 ? keyword.slice(-2) : keyword;
  return options.some(({ text }) => {
    const normalizedText = normalize(text);
    return normalizedText.includes(keyword) || (suffix.length >= 2 && normalizedText.includes(suffix));
  });
}

async function setDouyinLocation(page, locationName) {
  const anchor = page.locator("#douyin_creator_pc_anchor_jump").first();
  if (!(await anchor.isVisible({ timeout: 1_500 }).catch(() => false))) return false;

  const select = anchor.locator(".semi-select.semi-select-filterable").first();
  if (!(await select.isVisible({ timeout: 800 }).catch(() => false))) return false;
  await safeClick(select, "打开抖音地理位置输入框");

  const input = anchor.locator([
    "input.semi-select-input",
    'input[role="combobox"]',
    ".semi-select-selection input",
    'input[type="text"]'
  ].join(", ")).first();
  const hasInput = await input.isVisible({ timeout: 800 }).catch(() => false);
  if (hasInput) {
    await input.fill("");
    await input.pressSequentially(locationName, { delay: 70 });
    const inputDeadline = Date.now() + 2_000;
    while (Date.now() < inputDeadline) {
      if ((await input.inputValue({ timeout: 150 }).catch(() => "")).trim() === locationName) break;
      await page.waitForTimeout(100);
    }
    if ((await input.inputValue({ timeout: 150 }).catch(() => "")).trim() !== locationName) return false;
  } else {
    // 抖音部分版本把可搜索输入框渲染为无独立节点，点击后直接向当前焦点输入。
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(locationName, { delay: 70 });
  }

  // 抖音会对地点搜索做防抖并重绘结果列表，先等完整关键词对应的请求结束。
  await page.waitForTimeout(1_200);
  const deadline = Date.now() + 8_000;
  let stableSignature = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    const list = await douyinLocationResultList(page, input, select);
    const options = await visibleDouyinLocationOptions(list);
    // 必须是第一条推荐本身与输入地点相关，避免旧列表首项“外滩”被误点。
    if (options.length && douyinLocationResultsMatch([options[0]], locationName)) {
      const signature = options.slice(0, 5).map(({ text }) => text).join("|");
      if (signature === stableSignature) stableCount += 1;
      else {
        stableSignature = signature;
        stableCount = 1;
      }
      if (stableCount >= 3) return selectFirstDouyinLocation(page, anchor, list, options[0]);
    } else {
      stableSignature = "";
      stableCount = 0;
    }
    await page.waitForTimeout(150);
  }
  return false;
}

async function xiaohongshuLocationDropdown(page, select) {
  const className = await select.getAttribute("class").catch(() => "");
  const suffix = /(?:^|\s)custom-select-([^\s]+)/.exec(className || "")?.[1];
  if (suffix) {
    const dropdown = page.locator(`.d-popover.d-dropdown.custom-dropdown-${suffix}`).first();
    if (await dropdown.isVisible({ timeout: 150 }).catch(() => false)) return dropdown;
  }

  const dropdowns = page.locator(".d-popover.d-dropdown");
  for (let index = (await dropdowns.count()) - 1; index >= 0; index -= 1) {
    const dropdown = dropdowns.nth(index);
    if (!(await dropdown.isVisible({ timeout: 100 }).catch(() => false))) continue;
    if (await dropdown.locator(".d-options .option-item").count()) return dropdown;
  }
  return null;
}

async function visibleXiaohongshuLocationOptions(dropdown) {
  if (!dropdown) return [];
  const candidates = dropdown.locator(".d-options > .d-grid-item .option-item");
  const visible = [];
  for (let index = 0; index < Math.min(await candidates.count(), 50); index += 1) {
    const option = candidates.nth(index);
    if (!(await option.isVisible({ timeout: 100 }).catch(() => false))) continue;
    visible.push({ option, text: (await option.innerText({ timeout: 200 }).catch(() => "")).trim() });
  }
  return visible;
}

async function selectFirstXiaohongshuLocation(page, select, dropdown, firstResult) {
  const name = (await firstResult.option.locator(".option-name").first().innerText({ timeout: 300 }).catch(() => ""))
    .trim() || firstResult.text.split(/\r?\n/)[0].trim();
  await safeClick(firstResult.option, "选择小红书地点搜索第一条结果");

  const selectedText = select.locator(".d-select-description").first();
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const popupVisible = await dropdown.isVisible({ timeout: 100 }).catch(() => false);
    const current = (await selectedText.innerText({ timeout: 150 }).catch(() => "")).trim();
    if (!popupVisible) return true;
    if (name && current.includes(name)) {
      await page.keyboard.press("Escape");
      await dropdown.waitFor({ state: "hidden", timeout: 1_000 }).catch(() => {});
      return !(await dropdown.isVisible({ timeout: 100 }).catch(() => false));
    }
    await page.waitForTimeout(100);
  }
  return false;
}

async function setXiaohongshuLocation(page, locationName) {
  const select = page.locator(".address-card-wrapper .address-card-select").first();
  if (!(await select.isVisible({ timeout: 1_500 }).catch(() => false))) return false;
  await safeClick(select, "打开小红书地点选择框");

  const input = select.locator('.d-select-input-filter input[type="text"]').first();
  if (!(await input.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
  await input.fill("");
  await input.pressSequentially(locationName, { delay: 70 });

  const inputDeadline = Date.now() + 2_000;
  while (Date.now() < inputDeadline) {
    if ((await input.inputValue({ timeout: 150 }).catch(() => "")).trim() === locationName) break;
    await page.waitForTimeout(100);
  }
  if ((await input.inputValue({ timeout: 150 }).catch(() => "")).trim() !== locationName) return false;

  await page.waitForTimeout(1_200);
  const deadline = Date.now() + 8_000;
  let stableSignature = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    const dropdown = await xiaohongshuLocationDropdown(page, select);
    const options = await visibleXiaohongshuLocationOptions(dropdown);
    if (options.length && douyinLocationResultsMatch([options[0]], locationName)) {
      const signature = options.slice(0, 5).map(({ text }) => text).join("|");
      if (signature === stableSignature) stableCount += 1;
      else {
        stableSignature = signature;
        stableCount = 1;
      }
      if (stableCount >= 3) return selectFirstXiaohongshuLocation(page, select, dropdown, options[0]);
    } else {
      stableSignature = "";
      stableCount = 0;
    }
    await page.waitForTimeout(150);
  }
  return false;
}

export async function setPublishLocation(page, platform, locationName) {
  const value = String(locationName ?? "").trim();
  if (!value) return true;
  if (platform.key === "douyin") return setDouyinLocation(page, value);
  if (platform.key === "xiaohongshu") return setXiaohongshuLocation(page, value);
  if (platform.key === "channels") return setChannelsLocation(page, value);

  const roots = channelsRoots(page);
  let input = await firstVisibleFromRoots(roots, LOCATION_INPUT_SELECTORS, 250);
  if (!input) {
    const trigger = await firstVisibleFromRoots(roots, LOCATION_TRIGGER_SELECTORS[platform.key] || [], 500);
    if (!trigger) return false;
    await safeClick(trigger, `打开${platform.name}位置选择框`);
    input = await firstVisibleFromRoots(roots, LOCATION_INPUT_SELECTORS, 1_000);
  }
  if (!input) return false;
  await input.fill(value);
  await page.waitForTimeout(350);

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const option = await firstVisibleLocationOption(roots);
    if (option) {
      await safeClick(option, `选择${platform.name}位置搜索第一条结果`);
      return true;
    }
    await page.waitForTimeout(150);
  }
  return false;
}

const FINAL_PUBLISH_NAMES = Object.freeze({
  douyin: /^(?:发布|立即发布|确认发布)$/,
  channels: /^(?:发表|立即发表|发布|立即发布)$/,
  bilibili: /^(?:立即投稿|确认投稿|投稿|发布|立即发布)$/
});

export async function clickFinalPublish(page, platform, { beforeClick = () => {} } = {}) {
  const name = FINAL_PUBLISH_NAMES[platform.key];
  if (!name) return false;
  const roots = channelsRoots(page);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const root of roots) {
      const candidates = root.getByRole("button", { name });
      for (let index = 0; index < Math.min(await candidates.count(), 12); index += 1) {
        const button = candidates.nth(index);
        if (!(await button.isVisible({ timeout: 150 }).catch(() => false))) continue;
        if (!(await button.isEnabled({ timeout: 150 }).catch(() => false))) continue;
        await beforeClick();
        await safeClick(button, `点击${platform.name}最终发布按钮`, { allowFinalAction: true });
        return true;
      }
    }
    await page.waitForTimeout(200);
  }
  return false;
}

async function channelsOriginalControl(page, timeout = 1_200) {
  const deadline = Date.now() + timeout;
  do {
    for (const root of channelsRoots(page)) {
      const controls = root.locator(".declare-original-checkbox label.ant-checkbox-wrapper");
      for (let index = 0; index < Math.min(await controls.count(), 10); index += 1) {
        const control = controls.nth(index);
        if (!(await control.isVisible({ timeout: 150 }).catch(() => false))) continue;
        const box = control.locator('input.ant-checkbox-input[type="checkbox"]').first();
        if (await box.count()) return { root, control, box };
      }
    }
    if (Date.now() < deadline) await page.waitForTimeout(80);
  } while (Date.now() < deadline);
  return null;
}

export async function setChannelsOriginal(page, located = null) {
  try {
    const resolved = located ?? await channelsOriginalControl(page);
    if (!resolved) return false;
    const { root, control, box } = resolved;
    if (await box.isChecked().catch(() => false)) return true;

    await safeClick(control, "打开视频号原创声明");
    const dialogs = root.locator(".weui-desktop-dialog");
    let dialog = null;
    const dialogDeadline = Date.now() + 3_000;
    while (Date.now() < dialogDeadline && !dialog) {
      for (let index = 0; index < await dialogs.count(); index += 1) {
        const candidate = dialogs.nth(index);
        const title = candidate.locator(".weui-desktop-dialog__title").first();
        const titleText = (await title.innerText({ timeout: 150 }).catch(() => "")).trim();
        if (titleText === "原创权益" && await candidate.isVisible({ timeout: 150 }).catch(() => false)) {
          dialog = candidate;
          break;
        }
      }
      if (!dialog) await page.waitForTimeout(80);
    }
    if (!dialog) return false;
    const protocol = dialog.locator(".original-proto-wrapper").first();
    if (!(await protocol.isVisible({ timeout: 500 }).catch(() => false))) return false;
    const agreementControl = protocol.locator(":scope > label.ant-checkbox-wrapper").first();
    if (!(await agreementControl.isVisible({ timeout: 500 }).catch(() => false))) return false;
    const agreement = agreementControl.locator('input.ant-checkbox-input[type="checkbox"]').first();
    if (!(await agreement.count())) return false;
    if (!(await agreement.isChecked())) await safeClick(agreementControl, "勾选视频号原创声明协议");

    const agreementDeadline = Date.now() + 2_000;
    while (Date.now() < agreementDeadline && !(await agreement.isChecked().catch(() => false))) await page.waitForTimeout(80);
    if (!(await agreement.isChecked().catch(() => false))) return false;

    const buttons = dialog.locator(".weui-desktop-dialog__ft .weui-desktop-btn_wrp:not(.cancel-btn) button.weui-desktop-btn_primary");
    let confirm = null;
    const buttonDeadline = Date.now() + 3_000;
    while (Date.now() < buttonDeadline && !confirm) {
      for (let index = 0; index < await buttons.count(); index += 1) {
        const candidate = buttons.nth(index);
        const text = (await candidate.innerText({ timeout: 150 }).catch(() => "")).trim();
        if (text === "声明原创" && await candidate.isVisible({ timeout: 150 }).catch(() => false)) {
          confirm = candidate;
          break;
        }
      }
      if (!confirm) await page.waitForTimeout(80);
    }
    if (!confirm) return false;
    const enableDeadline = Date.now() + 3_000;
    while (Date.now() < enableDeadline) {
      const className = await confirm.getAttribute("class").catch(() => "");
      const disabled = await confirm.getAttribute("disabled").catch(() => null);
      if (!String(className).includes("weui-desktop-btn_disabled") && disabled === null) break;
      await page.waitForTimeout(80);
    }
    const finalClassName = await confirm.getAttribute("class").catch(() => "");
    if (String(finalClassName).includes("weui-desktop-btn_disabled") || await confirm.getAttribute("disabled").catch(() => null) !== null) return false;
    await safeClick(confirm, "确认视频号声明原创");

    const closeDeadline = Date.now() + 4_000;
    while (Date.now() < closeDeadline && await dialog.isVisible({ timeout: 150 }).catch(() => false)) await page.waitForTimeout(80);
    if (await dialog.isVisible({ timeout: 150 }).catch(() => false)) return false;

    const checkedDeadline = Date.now() + 4_000;
    while (Date.now() < checkedDeadline) {
      if (await box.isChecked().catch(() => false)) return true;
      await page.waitForTimeout(80);
    }
    return false;
  } catch { return false; }
}

export async function setChannelsOriginalIfAvailable(page) {
  const located = await channelsOriginalControl(page);
  if (!located) return "unavailable";
  return await setChannelsOriginal(page, located) ? "success" : "failed";
}

async function setBilibiliOriginal(page) {
  if (!(await openDeclaration(page, "bilibili"))) return false;
  const choice = await visibleExactText(page, "内容为自制：未经作者允许，禁止转载");
  if (!choice) return false;
  await safeClick(choice, "勾选B站内容自制声明");
  return true;
}

export async function setRights(page, job, log, platform) {
  const failures = [];
  if (shouldSkipDeclaration(platform.key, job.declaration)) {
    log(`[${platform.name}/${job.account}] 保持平台默认：无需内容标注`);
  } else if (await setDeclaration(page, platform, job.declaration)) {
    if (job.declaration) log(`[${platform.name}/${job.account}] 已同步声明：${job.declaration}`);
  } else failures.push(`未能设置声明“${job.declaration}”`);
  if (platform.key === "xiaohongshu") {
    const controls = await findXiaohongshuOriginalControls(page);
    if (!controls) {
      log(`[${platform.name}/${job.account}] 当前账号未提供原创声明控件，已跳过`);
    } else if (!(await setXiaohongshuOriginal(page, job.original, controls))) {
      failures.push("未能同步小红书原创声明开关");
    } else {
      log(`[${platform.name}/${job.account}] 原创声明已${job.original ? "勾选" : "取消"}`);
    }
  } else if (platform.key === "bilibili" && job.original) {
    if (!(await setBilibiliOriginal(page))) failures.push("未能勾选B站内容自制声明");
  }
  if (failures.length) throw new Error(`${platform.name}声明同步失败：${failures.join("；")}`);
}

export async function visibleUploadError(page) {
  const keys = ["比例", "尺寸", "分辨率", "格式", "大小", "上传失败", "不支持", "图片异常"];
  for (const selector of ['[role="alert"]', ".semi-toast-content", ".semi-message-content", ".d-message", ".ant-message-notice-content", ".bcc-toast", '[class*="upload-error"]']) {
    try {
      const nodes = page.locator(selector);
      for (let i = 0; i < Math.min(await nodes.count(), 6); i += 1) {
        const item = nodes.nth(i);
        const text = (await item.innerText({ timeout: 150 })).trim();
        if (await item.isVisible({ timeout: 100 }) && keys.some(key => text.includes(key))) return text;
      }
    } catch {}
  }
  return "";
}

export async function mediaSignature(locator) {
  return locator.evaluate(root => {
    const values = [];
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (element.tagName === "IMG") values.push(`img:${element.currentSrc || element.src || ""}`);
      if (element.tagName === "CANVAS") {
        try { values.push(`canvas:${element.toDataURL("image/png").slice(-900)}`); }
        catch { values.push(`canvas:${element.width}x${element.height}`); }
      }
      const background = getComputedStyle(element).backgroundImage;
      if (background && background !== "none") values.push(`bg:${background}`);
    }
    return values.join("|");
  });
}

export async function waitForMediaChange(page, locator, before, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const error = await visibleUploadError(page);
    if (error) throw new CoverUploadError(error);
    try {
      const current = await mediaSignature(locator);
      if (current && current !== before) return current;
    } catch (error_) { if (error_ instanceof CoverUploadError) throw error_; }
    await page.waitForTimeout(300);
  }
  throw new CoverUploadError("等待封面图片预览更新超时");
}
