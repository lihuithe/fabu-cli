import { safeClick } from "./browser-utils.js";

// 抖音图文“选择音乐”（BGM）。尽力而为：任何一步失败只记录 WARNING，绝不阻塞发布。
// 选择器优先使用 Leo 现场确认的精确 class，其次是 class 片段和文字兜底（哈希后缀可能变化）。
export const DOUYIN_BGM_SELECTORS = Object.freeze({
  trigger: [
    'xpath=//div[@class="container-right-uW7Pj1"]',
    '[class*="container-right-uW7Pj1"]',
    '[class*="container-right"]:has(span:text-is("选择音乐"))',
    'span[class*="action"]:text-is("选择音乐")'
  ],
  list: ['div.music-collection-container-cTsB7J', '[class*="music-collection-container"]'],
  cards: [
    'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " card-container-tmocjc ")]',
    '[class*="card-container-tmocjc"]',
    '[class*="music-collection-container"] [class*="card-container"]:has([class*="song-name"])'
  ],
  applyButton: [
    'xpath=.//button[contains(@class,"apply-btn")]',
    '[class*="apply-btn"]',
    'button:has-text("使用")'
  ],
  songName: ['div.song-name-oRge4d', '[class*="song-name"]'],
  author: ['.song-author', '[class*="song-author"]'],
  close: ['.semi-sidesheet-close', '[class*="sidesheet"] [aria-label="close"]', '[class*="sidesheet"] button[class*="close"]', '[class*="drawer"] [class*="close"]']
});

export const DOUYIN_BGM_PLACEHOLDER = "点击添加合适作品风格音乐";
export const DOUYIN_BGM_MAX_INDEX = 10;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function firstVisible(root, selectors, timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const selector of selectors) {
      try {
        const nodes = root.locator(selector);
        for (let i = 0; i < Math.min(await nodes.count(), 6); i += 1) {
          const node = nodes.nth(i);
          if (await node.isVisible({ timeout: 80 }).catch(() => false)) return node;
        }
      } catch {}
    }
    if (Date.now() < deadline) await delay(150);
  } while (Date.now() < deadline);
  return null;
}

async function cardLocator(page) {
  for (const selector of DOUYIN_BGM_SELECTORS.cards) {
    const cards = page.locator(selector);
    if (await cards.count().catch(() => 0)) return cards;
  }
  return null;
}

async function textOf(root, selectors) {
  for (const selector of selectors) {
    const node = root.locator(selector).first();
    if (await node.count().catch(() => 0)) {
      const text = (await node.innerText({ timeout: 300 }).catch(() => "")).trim();
      if (text) return text;
    }
  }
  return "";
}

export async function isDouyinBgmDrawerOpen(page) {
  return Boolean(await firstVisible(page, DOUYIN_BGM_SELECTORS.list));
}

export async function closeDouyinBgmDrawer(page, timeoutMs = 3_000) {
  if (!(await isDouyinBgmDrawerOpen(page))) return true;
  const close = await firstVisible(page, DOUYIN_BGM_SELECTORS.close);
  if (close) await close.click({ timeout: 2_000 }).catch(() => {});
  else await page.keyboard.press("Escape").catch(() => {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isDouyinBgmDrawerOpen(page))) return true;
    await delay(150);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await delay(300);
  return !(await isDouyinBgmDrawerOpen(page));
}

// 抽 1..10 的随机序号；卡片不足时取已加载数量。
export function pickBgmIndex(random = Math.random, max = DOUYIN_BGM_MAX_INDEX) {
  return Math.min(max, Math.max(1, Math.floor(random() * max) + 1));
}

async function waitForCards(page, wanted, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    const cards = await cardLocator(page);
    count = cards ? await cards.count().catch(() => 0) : 0;
    if (count >= wanted) return count;
    // 列表懒加载：把列表滚到底部触发加载更多。
    if (count) {
      const list = await firstVisible(page, DOUYIN_BGM_SELECTORS.list);
      await list?.evaluate(element => { element.scrollTop = element.scrollHeight; }).catch(() => {});
      await cards.nth(count - 1).scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
    }
    await delay(250);
  }
  return count;
}

async function musicRowText(page) {
  const trigger = await firstVisible(page, DOUYIN_BGM_SELECTORS.trigger);
  if (!trigger) return null;
  // 行文字可能在按钮的兄弟节点里，取所在行（向上 3 层内）的文字。
  return trigger.evaluate(element => {
    let node = element;
    for (let depth = 0; depth < 3 && node.parentElement; depth += 1) node = node.parentElement;
    return node.innerText || "";
  }).catch(() => null);
}

/**
 * @returns {Promise<{status: 'selected'|'selected_unverified'|'skipped'|'failed', song?: string, author?: string, index?: number, reason?: string}>}
 */
export async function selectDouyinBgm(page, { mode = "random", log = () => {}, snapshot = async () => {}, random = Math.random, timeouts = {} } = {}) {
  if (mode === "none") { log("按任务设置不添加背景音乐（bgm: none）"); return { status: "skipped", reason: "bgm_none" }; }
  const t = { open: 10_000, cards: 8_000, apply: 3_000, close: 4_000, ...timeouts };
  const warn = async (reason, extra = {}) => {
    log(`WARNING：背景音乐选择失败，继续发布（不带指定 BGM）：${reason}`);
    await snapshot("bgm_warning").catch(() => {});
    await closeDouyinBgmDrawer(page).catch(() => {});
    return { status: "failed", reason, ...extra };
  };
  try {
    const trigger = await firstVisible(page, DOUYIN_BGM_SELECTORS.trigger, 3_000);
    if (!trigger) return await warn("未找到“选择音乐”入口");
    await trigger.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => {});
    await safeClick(trigger, "打开抖音选择音乐抽屉", { timeout: 3_000 });
    if (!(await firstVisible(page, DOUYIN_BGM_SELECTORS.list, t.open))) return await warn("选择音乐抽屉未出现音乐列表");
    const index = pickBgmIndex(random);
    const loaded = await waitForCards(page, index, t.cards);
    if (!loaded) return await warn("音乐列表没有加载出歌曲卡片");
    const position = Math.min(index, loaded);
    const cards = await cardLocator(page);
    const card = cards.nth(position - 1);
    const song = await textOf(card, DOUYIN_BGM_SELECTORS.songName);
    const author = await textOf(card, DOUYIN_BGM_SELECTORS.author);
    await card.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
    await card.hover({ timeout: 2_000 }).catch(() => card.hover({ timeout: 1_000, force: true }));
    const visibleApply = await firstVisible(card, DOUYIN_BGM_SELECTORS.applyButton, t.apply);
    let clicked = false;
    if (visibleApply) {
      clicked = await safeClick(visibleApply, "选择背景音乐：点击使用", { timeout: 2_000 }).then(() => true).catch(() => false);
    }
    if (!clicked) {
      // 悬停后按钮不可见或普通点击被遮挡时：重新悬停，再强制点击 DOM 中的“使用”按钮。
      const apply = visibleApply || card.locator(DOUYIN_BGM_SELECTORS.applyButton.join(", ")).first();
      if (!(await apply.count().catch(() => 0))) return await warn(`第 ${position} 首悬停后未出现“使用”按钮`, { song, author, index: position });
      await card.hover({ timeout: 1_000, force: true }).catch(() => {});
      if (!(await isDouyinBgmDrawerOpen(page))) clicked = true; // 普通点击其实已生效且抽屉已关闭，不再重复点击
      else await apply.click({ force: true, timeout: 2_000 });
    }
    const deadline = Date.now() + t.close;
    while (Date.now() < deadline && await isDouyinBgmDrawerOpen(page)) await delay(150);
    // 抽屉仍开着就用 × 关闭（同时停止试听）。
    if (await isDouyinBgmDrawerOpen(page) && !(await closeDouyinBgmDrawer(page))) return await warn("点击“使用”后无法关闭选择音乐抽屉", { song, author, index: position });
    const row = await musicRowText(page);
    const shown = row !== null && song && row.replace(/\s+/g, "").includes(song.replace(/\s+/g, ""));
    const stillPlaceholder = row !== null && row.includes(DOUYIN_BGM_PLACEHOLDER);
    if (stillPlaceholder && !shown) return await warn(`已点击第 ${position} 首“${song}”的“使用”，但音乐行仍显示占位提示`, { song, author, index: position });
    const status = shown ? "selected" : "selected_unverified";
    log(`已选择背景音乐（第 ${position} 首${status === "selected" ? "，音乐行已显示歌名" : "，抽屉已关闭但未能读到音乐行歌名"}）：${song || "未知歌名"}${author ? ` - ${author}` : ""}`);
    return { status, song, author, index: position };
  } catch (error) {
    return await warn(error?.message || String(error));
  }
}
