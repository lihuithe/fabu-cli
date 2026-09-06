import { clickFinalPublish } from './browser-utils.js';
import { AppError } from './errors.js';
import { DateTime } from 'luxon';

// Scheduled Channels posts return to the list without a success toast. Read the
// rendered record (including open shadow roots), never infer success from the URL.
export async function channelsScheduledReceipt(page, expected) {
  if (!expected?.title || !expected?.scheduledAt || page.isClosed()) return null;
  const url = new URL(page.url());
  if (url.hostname !== 'channels.weixin.qq.com' || url.pathname !== '/platform/post/list') return null;
  const at = DateTime.fromISO(expected.scheduledAt, { zone: 'Asia/Shanghai' }).setZone('Asia/Shanghai');
  if (!at.isValid) return null;
  const scheduledText = `将于${at.toFormat('yyyy年MM月dd日HH:mm')}发表`;
  for (const frame of page.frames()) {
    const titles = frame.getByText(expected.title, { exact: false });
    for (let i = 0; i < Math.min(await titles.count().catch(() => 0), 12); i++) {
      const title = titles.nth(i);
      if (!(await title.isVisible().catch(() => false))) continue;
      const matched = await title.evaluate((element, target) => {
        const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
        const actualTitle = compact(element.innerText);
        const wantedTitle = compact(target.title);
        if (actualTitle !== wantedTitle && !actualTitle.startsWith(wantedTitle + '#')) return false;
        for (let row = element, depth = 0; row && depth < 6; row = row.parentElement, depth++) {
          const text = compact(row.innerText);
          const schedules = text.match(/将于\d{4}年\d{2}月\d{2}日\d{2}:\d{2}发表/g) || [];
          // Multiple records in an ancestor must not join one title to another date.
          if (schedules.length > 1) return false;
          if (schedules.length === 1) return schedules[0] === target.scheduledText;
          if (row.matches('article, li, tr, [role="listitem"], [role="row"]')) return false;
        }
        return false;
      }, { title: expected.title, scheduledText }).catch(() => false);
      if (matched) return { text: `${expected.title}；${scheduledText}`, url: page.url(), title: expected.title, scheduled_at: at.toISO(), verification: 'scheduled_post_record' };
    }
  }
  return null;
}

// A navigation or a click alone is never a receipt. Keep this list conservative.
export const RECEIPTS = Object.freeze({
  douyin: /^(?:发布成功|作品发布成功|视频发布成功|已提交审核|定时发布设置成功)[！!。]?$/,
  channels: /^(?:发表成功|发布成功|视频发表成功|已提交审核|定时发表设置成功)[！!。]?$/,
  bilibili: /^(?:投稿成功|视频投稿成功|稿件提交成功|提交成功|已提交审核)[！!。]?$/
});

export async function visibleReceipts(page, platformKey) {
  const found = [];
  if (!RECEIPTS[platformKey] || page.isClosed()) return found;
  for (const frame of page.frames()) {
    const matches = frame.getByText(RECEIPTS[platformKey], { exact: true });
    for (let i = 0; i < Math.min(await matches.count().catch(() => 0), 12); i++) {
      const item = matches.nth(i);
      if (await item.isVisible().catch(() => false)) found.push({ text: (await item.innerText()).trim(), url: frame.url() });
    }
  }
  return found;
}

export async function verifySubmission(page, platformKey, { timeoutMs = 30_000, previous = [], expected } = {}) {
  const deadline = Date.now() + timeoutMs;
  const prior = new Set(previous.map(r => `${r.url}:${r.text}`));
  do {
    const receipt = (await visibleReceipts(page, platformKey)).find(r => !prior.has(`${r.url}:${r.text}`))
      || (platformKey === 'channels' ? await channelsScheduledReceipt(page, expected) : null);
    if (receipt) return { outcome: 'submitted', evidence: { source: 'platform_receipt', ...receipt, observed_at: new Date().toISOString(), meaning: '平台接受提交；不代表审核通过或已经公开发布' } };
    if (page.isClosed()) break;
    await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now()))).catch(() => {});
  } while (Date.now() < deadline);
  throw new AppError('SUBMISSION_UNKNOWN', '已尝试提交，但未检测到明确的平台成功回执，请核实平台结果后再决定下一步', { status: 409, nextAction: { action: 'verify_submission', command: 'tasks reconcile' } });
}

export async function submitAndVerify(page, platform, beforeClick, options = {}) {
  const previous = await visibleReceipts(page, platform.key);
  const priorRecord = platform.key === 'channels' && await channelsScheduledReceipt(page, options.expected);
  if (previous.length || priorRecord) throw new AppError('STALE_SUBMISSION_RECEIPT', '发布前页面已有成功回执，需人工检查当前页面，未再次点击发布', { status: 409 });
  const clicked = await clickFinalPublish(page, platform, { beforeClick });
  if (!clicked) throw new AppError('PUBLISH_BUTTON_NOT_FOUND', `${platform.name}未找到可点击的最终发布按钮`);
  return verifySubmission(page, platform.key, { ...options, previous });
}
