import { DateTime } from 'luxon';

export const CHANNELS_LIST_URL = 'https://channels.weixin.qq.com/platform/post/list';
const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');

// Only inspect the authenticated task window. A list navigation alone is not proof.
export async function channelsListSnapshot(page, title) {
  const url = new URL(page.url());
  if (page.isClosed() || url.origin + url.pathname !== CHANNELS_LIST_URL || !title) return null;
  let total = null;
  let matches = 0;
  const records = [];
  for (const frame of page.frames()) {
    const counters = frame.getByText(/^视频\s*[（(]\s*\d+\s*[)）]$/);
    for (const counter of await counters.all().catch(() => [])) {
      if (!(await counter.isVisible().catch(() => false))) continue;
      const value = (await counter.innerText({ timeout: 250 }).catch(() => '')).match(/\d+/);
      if (value) total = Number(value[0]);
    }
    const titles = frame.getByText(title, { exact: false });
    for (const item of await titles.all().catch(() => [])) {
      if (!(await item.isVisible().catch(() => false))) continue;
      const text = compact(await item.innerText({ timeout: 250 }).catch(() => ''));
      const wanted = compact(title);
      if (text !== wanted && !text.startsWith(wanted + '#')) continue;
      matches++;
      const record = await item.evaluate(element => {
        const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const boundary = 'article, li, tr, [role="listitem"], [role="row"]';
        for (let row = element, depth = 0; row && depth < 8; row = row.parentElement, depth++) {
          // Never combine the target title with a neighbouring video's status/date.
          if (row.querySelector(boundary) || [...row.querySelectorAll('img')].filter(visible).length > 1) break;
          const text = row.innerText || '';
          const dates = text.match(/\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}/g) || [];
          if (dates.length > 1 || /将于|发表失败|发布失败|审核不通过|审核未通过|草稿/.test(text)) break;
          const statuses = [...row.querySelectorAll('*')].filter(visible).map(el => (el.innerText || '').trim())
            .filter(value => /^(处理中|审核中|已发表|已发布|审核通过)$/.test(value));
          if (statuses.length || dates.length) return { status: statuses[0] || '已显示发表时间', publishedText: dates[0] || null };
          if (row.matches(boundary)) break;
        }
        return null;
      }, undefined, { timeout: 250 }).catch(() => null);
      if (record) records.push(record);
    }
  }
  return { total, matches, records };
}

// Capture the pre-submit list in a temporary read-only tab; do not leave the editor.
// If the list cannot be read reliably, fall back to an explicit success receipt.
export async function captureChannelsBaseline(page, title) {
  let probe;
  try {
    probe = await page.context().newPage();
    await probe.goto(CHANNELS_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    // 列表由前端异步渲染，轮询直到读到视频总数。
    let snapshot = null;
    for (const deadline = Date.now() + 12_000; Date.now() < deadline;) {
      snapshot = await channelsListSnapshot(probe, title);
      if (snapshot && snapshot.total !== null) break;
      await probe.waitForTimeout(500);
    }
    if (!snapshot || snapshot.total === null) return { available: false, reason: 'list_not_ready' };
    return { available: true, ...snapshot, observedAt: new Date().toISOString() };
  } catch {
    return { available: false, reason: 'list_read_failed' };
  } finally {
    await probe?.close().catch(() => {});
    await page.bringToFront().catch(() => {});
  }
}

export async function channelsImmediateReceipt(page, expected, context = {}) {
  if (!expected?.title || expected.scheduledAt || !context.submittedAt) return null;
  const snapshot = await channelsListSnapshot(page, expected.title);
  context.lastObservation = snapshot;
  const baseline = context.baseline;
  // Both the list and the matching-title count must increase. This also rejects
  // an old same-title video that was already processing before this submission.
  if (!snapshot) return null;
  // 无法读取提交前对照时，退而要求列表里出现本次提交后的同名记录（处理中/审核中，或发表时间不早于提交时刻）。
  const hasBaseline = Boolean(baseline?.available);
  if (hasBaseline && (snapshot.total <= baseline.total || snapshot.matches <= baseline.matches)) return null;
  const submittedAt = DateTime.fromISO(context.submittedAt);
  if (!submittedAt.isValid) return null;
  const record = snapshot.records.find(candidate => {
    if (!candidate.publishedText) return candidate.status === '处理中' || candidate.status === '审核中';
    const at = DateTime.fromFormat(candidate.publishedText.replace(/\s+/g, ''), 'yyyy年M月d日H:mm', { zone: 'Asia/Shanghai' });
    return at.isValid && at.toMillis() >= submittedAt.startOf('minute').toMillis() && at.toMillis() <= Date.now() + 60_000;
  });
  if (!record) return null;
  return {
    text: `${expected.title}；${record.status}`, url: page.url(), title: expected.title,
    verification: hasBaseline ? 'new_post_record' : 'new_post_record_without_baseline', platform_status: record.status, published_text: record.publishedText,
    submitted_at: context.submittedAt,
    before: hasBaseline ? { total: baseline.total, matches: baseline.matches } : null, after: { total: snapshot.total, matches: snapshot.matches }
  };
}
