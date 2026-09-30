import { DateTime } from 'luxon';

const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const LIST_PATH = '/article/manage/video';

// 快手提交后会跳到作品管理页，且没有稳定的成功 Toast。仅跳转不算回执：
// 必须在列表里读到与本次简介一致、发布时间不早于点击提交时刻的记录。
export async function kuaishouImmediateReceipt(page, expected, context = {}) {
  if (page.isClosed() || expected?.scheduledAt || !expected?.description || !context.submittedAt) return null;
  const url = new URL(page.url());
  if (url.hostname !== 'cp.kuaishou.com' || url.pathname !== LIST_PATH) return null;
  const submittedAt = DateTime.fromISO(context.submittedAt);
  if (!submittedAt.isValid) return null;
  const wanted = compact(expected.description).slice(0, 24);
  if (!wanted) return null;
  for (const frame of page.frames()) {
    const items = frame.getByText(expected.description.trim().slice(0, 24), { exact: false });
    for (const item of await items.all().catch(() => [])) {
      if (!(await item.isVisible().catch(() => false))) continue;
      const found = await item.evaluate((element, target) => {
        const norm = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
        if (!norm(element.innerText).startsWith(target)) return null;
        for (let row = element, depth = 0; row && depth < 8; row = row.parentElement, depth++) {
          const text = row.innerText || '';
          const times = text.match(/已发布\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/g) || [];
          if (times.length > 1) return null;
          if (times.length === 1) return times[0].replace(/^已发布\s*/, '');
        }
        return null;
      }, wanted, { timeout: 300 }).catch(() => null);
      if (!found) continue;
      const at = DateTime.fromFormat(found.replace(/\s+/g, ' '), 'yyyy-MM-dd HH:mm', { zone: 'Asia/Shanghai' });
      if (at.isValid && at.toMillis() >= submittedAt.startOf('minute').toMillis() && at.toMillis() <= Date.now() + 120_000) {
        return { text: `快手作品管理已出现本次作品；已发布 ${found}`, url: page.url(), title: expected.title, verification: 'new_post_record', published_text: found, submitted_at: context.submittedAt };
      }
    }
  }
  return null;
}
