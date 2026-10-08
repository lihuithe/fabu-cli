import { DateTime } from 'luxon';

export const DOUYIN_MANAGE_PATH = '/creator-micro/content/manage';

const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');

export function isDouyinManagePage(page) {
  try {
    const url = new URL(page.url());
    return url.hostname === 'creator.douyin.com' && url.pathname.startsWith(DOUYIN_MANAGE_PATH);
  } catch { return false; }
}

// 抖音图文提交后通常跳到作品管理页，成功 Toast 可能一闪而过。仅跳转不算回执：
// 必须在作品管理页读到与本次标题（或正文开头）一致、且发布时间不早于点击提交时刻的同一条记录。
// 定时发布不走这条路径（列表时间为预约时间），仍只认平台成功提示。
export async function douyinImageTextReceipt(page, expected, context = {}) {
  if (context.contentType !== 'image_text') return null;
  if (page.isClosed() || expected?.scheduledAt || !context.submittedAt || !isDouyinManagePage(page)) return null;
  const submittedAt = DateTime.fromISO(context.submittedAt);
  if (!submittedAt.isValid) return null;
  const needles = [
    expected?.title ? { kind: 'title', text: String(expected.title).trim() } : null,
    expected?.description ? { kind: 'description', text: String(expected.description).trim().slice(0, 24) } : null
  ].filter(item => item && compact(item.text));
  for (const needle of needles) {
    for (const frame of page.frames()) {
      const items = frame.getByText(needle.text, { exact: false });
      for (let i = 0; i < Math.min(await items.count().catch(() => 0), 12); i++) {
        const item = items.nth(i);
        if (!(await item.isVisible().catch(() => false))) continue;
        const found = await item.evaluate((element, target) => {
          const norm = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
          const own = norm(element.innerText);
          const wanted = norm(target.text);
          if (target.kind === 'title' ? own !== wanted && !own.startsWith(wanted) : !own.startsWith(wanted)) return null;
          const pattern = /(\d{4})(?:-|年)(\d{1,2})(?:-|月)(\d{1,2})日?\s*(\d{1,2}):(\d{2})/g;
          for (let row = element, depth = 0; row && depth < 8; row = row.parentElement, depth++) {
            const times = String(row.innerText || '').match(pattern) || [];
            // 祖先节点包含多条记录时不能把标题和别的记录的时间拼在一起。
            if (times.length > 1) return null;
            if (times.length === 1) return times[0];
          }
          return null;
        }, needle, { timeout: 300 }).catch(() => null);
        if (!found) continue;
        const m = /(\d{4})(?:-|年)(\d{1,2})(?:-|月)(\d{1,2})日?\s*(\d{1,2}):(\d{2})/.exec(found);
        if (!m) continue;
        const at = DateTime.fromObject({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] }, { zone: 'Asia/Shanghai' });
        if (at.isValid && at.toMillis() >= submittedAt.startOf('minute').toMillis() && at.toMillis() <= Date.now() + 120_000) {
          return { text: `抖音作品管理已出现本次图文；${found}`, url: page.url(), title: expected.title, verification: 'new_post_record', matched_by: needle.kind, published_text: found, submitted_at: context.submittedAt };
        }
      }
    }
  }
  return null;
}
