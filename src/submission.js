import { clickFinalPublish } from './browser-utils.js';
import { AppError } from './errors.js';

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

export async function verifySubmission(page, platformKey, { timeoutMs = 30_000, previous = [] } = {}) {
  const deadline = Date.now() + timeoutMs;
  const prior = new Set(previous.map(r => `${r.url}:${r.text}`));
  do {
    const receipt = (await visibleReceipts(page, platformKey)).find(r => !prior.has(`${r.url}:${r.text}`));
    if (receipt) return { outcome: 'submitted', evidence: { source: 'platform_receipt', ...receipt, observed_at: new Date().toISOString(), meaning: '平台接受提交；不代表审核通过或已经公开发布' } };
    if (page.isClosed()) break;
    await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now()))).catch(() => {});
  } while (Date.now() < deadline);
  throw new AppError('SUBMISSION_UNKNOWN', '已尝试提交，但未检测到明确的平台成功回执，请核实平台结果后再决定下一步', { status: 409, nextAction: { action: 'verify_submission', command: 'tasks reconcile' } });
}

export async function submitAndVerify(page, platform, beforeClick, options = {}) {
  const previous = await visibleReceipts(page, platform.key);
  if (previous.length) throw new AppError('STALE_SUBMISSION_RECEIPT', '发布前页面已有成功回执，需人工检查当前页面，未再次点击发布', { status: 409 });
  const clicked = await clickFinalPublish(page, platform, { beforeClick });
  if (!clicked) throw new AppError('PUBLISH_BUTTON_NOT_FOUND', `${platform.name}未找到可点击的最终发布按钮`);
  return verifySubmission(page, platform.key, { ...options, previous });
}
