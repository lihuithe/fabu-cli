import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from '../src/account-binding.js';
import { submitAndVerify } from '../src/submission.js';
import { PLATFORMS } from '../src/platforms.js';

test('三个视频平台只有点击后的明确回执才算接受提交，落盘回调发生在点击前', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    for (const [key, button, receipt] of [['douyin', '发布', '发布成功'], ['channels', '发表', '发表成功'], ['bilibili', '投稿', '投稿成功']]) {
      await page.setContent(`<button onclick="window.clickedAfterCheckpoint=window.checkpoint;document.querySelector('div').textContent='${receipt}'">${button}</button><div></div>`);
      const result = await submitAndVerify(page, PLATFORMS[key], async () => { await page.evaluate(() => { window.checkpoint = true; }); }, { timeoutMs: 1000 });
      assert.equal(result.outcome, 'submitted');
      assert.equal(result.evidence.source, 'platform_receipt');
      assert.equal(await page.evaluate(() => window.clickedAfterCheckpoint), true);
    }
  } finally { await browser.close(); }
});

test('只有按钮点击、页面跳转、已有回执都不能误判成一次新的成功提交', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button onclick="this.textContent=\'正在提交\'">发布</button>');
    let attempts = 0;
    await assert.rejects(submitAndVerify(page, PLATFORMS.douyin, () => { attempts++; }, { timeoutMs: 100 }), { code: 'SUBMISSION_UNKNOWN' });
    assert.equal(attempts, 1);
    await page.setContent('<div>发布成功</div><button>发布</button>');
    await assert.rejects(submitAndVerify(page, PLATFORMS.douyin, () => { attempts++; }, { timeoutMs: 100 }), { code: 'STALE_SUBMISSION_RECEIPT' });
    assert.equal(attempts, 1);
  } finally { await browser.close(); }
});
