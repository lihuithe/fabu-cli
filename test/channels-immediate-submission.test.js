import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DateTime } from 'luxon';
import { chromePath } from '../src/account-binding.js';
import { CHANNELS_LIST_URL, captureChannelsBaseline, channelsListSnapshot, channelsImmediateReceipt } from '../src/channels-receipt.js';
import { submitAndVerify, verifySubmission } from '../src/submission.js';
import { PLATFORMS } from '../src/platforms.js';

const title = '写日报从回忆题变成整理题：小黑日报助手的使用方式';
const expected = { title };
const record = (name = title, status = '处理中') => `<article><div><span>${status}</span></div><div><span>${name} #小黑日报助手 #工作记录</span></div></article>`;
const list = (rows, total = 330) => `<h1>视频管理</h1><div>视频 (${total})</div><main>${rows}</main>`;
const context = () => ({ submittedAt: new Date().toISOString(), baseline: { available: true, total: 329, matches: 0 } });

test('普通发表返回列表后以新增的完整标题和处理中记录确认接受提交，兼容 shadow DOM / iframe', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    page.url = () => CHANNELS_LIST_URL;
    for (const status of ['处理中', '审核中']) {
      await page.setContent('<div id="host"></div>');
      await page.locator('#host').evaluate((host, html) => { host.attachShadow({ mode: 'open' }).innerHTML = html; }, list(record(title, status)));
      const result = await verifySubmission(page, 'channels', { expected, context: context(), timeoutMs: 100 });
      assert.equal(result.outcome, 'submitted');
      assert.equal(result.evidence.verification, 'new_post_record');
      assert.equal(result.evidence.platform_status, status);
      assert.deepEqual(result.evidence.before, { total: 329, matches: 0 });
    }
    await page.setContent('<iframe></iframe>');
    await page.frames()[1].setContent(list(record()));
    assert.ok(await channelsImmediateReceipt(page, expected, context()));
  } finally { await browser.close(); }
});

test('普通发表不接受旧同名记录、其他标题、跨行状态、空列表、失败、定时或缺失提交前对照', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    page.url = () => CHANNELS_LIST_URL;
    for (const html of [
      list(record(), 329), list(record('其他视频')), list(record(title + '续篇')),
      list(`<article><span>${title}</span></article>` + record('其他视频')),
      list(''), list(record(title, '发布失败')), list(record(title, '将于2026年09月22日17:00发表')),
      list(record(title, '2026年09月16日 17:00')), list(record(title, '已发表')),
      // A non-semantic list must not join two distinct cover rows either.
      list(`<div><div><img src="data:,x"><span>${title}</span></div><div><img src="data:,y"><span>其他视频</span><span>处理中</span></div></div>`)
    ]) {
      await page.setContent(html);
      assert.equal(await channelsImmediateReceipt(page, expected, context()), null, html);
    }
    await page.setContent(list(record()));
    assert.equal(await channelsImmediateReceipt(page, expected, {}), null);
    assert.equal(await channelsImmediateReceipt(page, expected, { ...context(), baseline: { available: false } }), null);
    assert.equal(await channelsImmediateReceipt(page, expected, { ...context(), baseline: { available: true, total: 329, matches: 1 } }), null);
    assert.equal(await channelsImmediateReceipt(page, { ...expected, scheduledAt: '2026-09-22T17:00:00+08:00' }, context()), null);
    page.url = () => 'https://channels.weixin.qq.com/platform/post/create';
    assert.equal(await channelsImmediateReceipt(page, expected, context()), null);
  } finally { await browser.close(); }
});

test('新增的已发表记录核对北京时间，待核实时仍保留原提交时间', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    page.url = () => CHANNELS_LIST_URL;
    const ctx = context();
    const time = DateTime.fromISO(ctx.submittedAt).setZone('Asia/Shanghai').toFormat('yyyy年MM月dd日 HH:mm');
    await page.setContent(list(record(title, time)));
    assert.equal((await channelsImmediateReceipt(page, expected, ctx)).published_text, time);
    assert.equal(ctx.lastObservation.matches, 1);
    await page.setContent(list(record(title, '2099年01月01日 12:00')));
    assert.equal(await channelsImmediateReceipt(page, expected, ctx), null);
    await assert.rejects(verifySubmission(page, 'channels', { expected, context: ctx, timeoutMs: 1 }), error => {
      assert.equal(error.code, 'SUBMISSION_UNKNOWN');
      assert.equal(error.details.submittedAt, ctx.submittedAt);
      assert.equal(error.details.lastObservation.matches, 1);
      return true;
    });
  } finally { await browser.close(); }
});

test('真实点击流程先读取对照再记录提交边界，列表处理中无需成功 toast；只点击一次', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.context().route(CHANNELS_LIST_URL, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: list(record('旧视频'), 329) }));
    let url = 'https://channels.weixin.qq.com/platform/post/create';
    page.url = () => url;
    await page.exposeFunction('showList', () => { url = CHANNELS_LIST_URL; });
    await page.setContent('<button>发表</button><main></main>');
    await page.locator('button').evaluate((button, html) => { button.onclick = async () => { document.querySelector('main').innerHTML = html; await window.showList(); }; }, list(record()));
    const ctx = {};
    let clicks = 0;
    const result = await submitAndVerify(page, PLATFORMS.channels, () => {
      assert.equal(ctx.baseline.available, true);
      assert.equal(ctx.baseline.matches, 0);
      assert.ok(ctx.submittedAt);
      clicks++;
    }, { expected, context: ctx, timeoutMs: 1000 });
    assert.equal(clicks, 1);
    assert.equal(result.outcome, 'submitted');
    assert.equal(page.context().pages().length, 1);
    // Re-verification uses the same pre-submit snapshot and never clicks again.
    assert.equal((await verifySubmission(page, 'channels', { expected, context: ctx })).outcome, 'submitted');
    await assert.rejects(submitAndVerify(page, PLATFORMS.channels, () => { clicks++; }, { expected }), { code: 'STALE_SUBMISSION_RECEIPT' });
    assert.equal(clicks, 1);
  } finally { await browser.close(); }
});

test('对照页异常或尚未加载时不把空数据当作零，清理临时页且保留编辑器', async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.context().route(CHANNELS_LIST_URL, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>加载中</h1>' }));
    assert.equal((await captureChannelsBaseline(page, title)).available, false);
    assert.equal(page.context().pages().length, 1);
    await page.context().unroute(CHANNELS_LIST_URL);
    await page.context().route(CHANNELS_LIST_URL, route => route.abort());
    assert.equal((await captureChannelsBaseline(page, title)).reason, 'list_read_failed');
    assert.equal(page.context().pages().length, 1);
    assert.equal(page.isClosed(), false);
    page.url = () => CHANNELS_LIST_URL;
    await page.setContent(list(record(title + '续篇')));
    assert.equal((await channelsListSnapshot(page, title)).matches, 0);
  } finally { await browser.close(); }
});
