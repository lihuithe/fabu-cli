import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chromePath } from '../src/account-binding.js';
import { channelsScheduledReceipt, submitAndVerify } from '../src/submission.js';
import { PLATFORMS } from '../src/platforms.js';

const expected = { title: '日报写清楚，比写得长更重要：三个整理动作', scheduledAt: '2026-09-07T17:00:00+08:00' };
const listUrl = 'https://channels.weixin.qq.com/platform/post/list';
const row = (title = expected.title, time = '2026年09月07日 17:00') => `<article><div><span>${title} #工作汇报</span></div><p>将于${time}发表</p></article>`;

test('视频号定时回执跨 shadow DOM 和 iframe，精确核对标题及北京时间', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    page.url = () => listUrl; // Offline fixture; no request to a real platform.
    await page.setContent('<div id="host"></div>');
    await page.locator('#host').evaluate((host, html) => { host.attachShadow({ mode: 'open' }).innerHTML = html; }, row());
    assert.equal((await channelsScheduledReceipt(page, expected)).verification, 'scheduled_post_record');
    await page.setContent('<iframe></iframe>');
    await page.frames()[1].setContent(row());
    assert.ok(await channelsScheduledReceipt(page, { ...expected, scheduledAt: '2026-09-07T09:00:00Z' }));
  } finally { await browser.close(); }
});

test('不把跳转、同名异时、异名同刻、跨行拼接或旧回执当作新的成功', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    page.url = () => listUrl;
    for (const html of ['<h1>视频管理</h1>', row(expected.title, '2026年09月07日 11:00'), row('其他作品'), '<article><span>' + expected.title + '</span></article>' + row('其他作品'), '<article><span>' + expected.title + '</span></article>' + row('其他作品') + row('另一个作品', '2026年09月07日 11:00')]) {
      await page.setContent(html);
      assert.equal(await channelsScheduledReceipt(page, expected), null);
    }
    await page.setContent(row() + '<button>发表</button>');
    let clicks = 0;
    await assert.rejects(submitAndVerify(page, PLATFORMS.channels, () => { clicks++; }, { expected, timeoutMs: 100 }), { code: 'STALE_SUBMISSION_RECEIPT' });
    assert.equal(clicks, 0);
    page.url = () => 'https://channels.weixin.qq.com/platform/post/create';
    assert.equal(await channelsScheduledReceipt(page, expected), null);
  } finally { await browser.close(); }
});

test('点击后才出现的定时作品记录直接返回 platform_receipt', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    let url = 'https://channels.weixin.qq.com/platform/post/create';
    page.url = () => url;
    await page.exposeFunction('showList', () => { url = listUrl; });
    await page.setContent('<button>发表</button><main></main>');
    await page.locator('button').evaluate((button, html) => { button.onclick = async () => { document.querySelector('main').innerHTML = html; await window.showList(); }; }, row());
    const result = await submitAndVerify(page, PLATFORMS.channels, () => {}, { expected, timeoutMs: 1000 });
    assert.equal(result.evidence.source, 'platform_receipt');
    assert.equal(result.evidence.verification, 'scheduled_post_record');
  } finally { await browser.close(); }
});
