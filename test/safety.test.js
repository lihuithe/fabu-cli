import assert from "node:assert/strict";
import test from "node:test";
import { safeClick } from "../src/browser-utils.js";
import { mergeTopics, PLATFORMS, splitTopics } from "../src/platforms.js";

test("最终发布按钮始终被安全层阻止", async () => {
  let clicked = false;
  const locator = { innerText: async () => "发布", click: async () => { clicked = true; } };
  await assert.rejects(() => safeClick(locator, "点击普通按钮"), /安全保护/);
  assert.equal(clicked, false);
});

test("用途名称本身是最终动作时也会被阻止", async () => {
  const locator = { innerText: async () => "普通按钮", click: async () => assert.fail("不应点击") };
  await assert.rejects(() => safeClick(locator, "确认发布"), /安全保护/);
});

test("四个平台和所需封面比例完整", () => {
  assert.deepEqual(Object.keys(PLATFORMS), ["douyin", "xiaohongshu", "channels", "bilibili"]);
  assert.deepEqual(new Set(Object.values(PLATFORMS).flatMap(platform => platform.coverRatios)), new Set(["3:4", "4:3", "16:9"]));
});

test("话题拆分规则与 Python 版一致", () => {
  assert.deepEqual(splitTopics("#科技，AI / 工具"), ["科技", "AI", "工具"]);
});

test("固定标签始终排在本次话题之前并去重", () => {
  assert.deepEqual(mergeTopics("#小黑日报助手", "AI,小黑日报助手,效率"), ["小黑日报助手", "AI", "效率"]);
  assert.deepEqual(mergeTopics("", "AI,效率"), ["AI", "效率"]);
});
