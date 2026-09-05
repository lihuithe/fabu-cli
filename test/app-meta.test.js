import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { APP_VERSION } from "../src/app-meta.js";

test("应用内部版本与包版本一致", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(APP_VERSION, packageJson.version);
});

test("桌面页面只滚动主内容区并使用细滚动条", () => {
  const serverSource = fs.readFileSync(new URL("../src/http-app.js", import.meta.url), "utf8");
  const shellLayout = fs.readFileSync(new URL("../web_static/shell-layout.css", import.meta.url), "utf8");
  assert.match(serverSource, /shell-layout\.css/);
  assert.match(shellLayout, /html,[\s\S]*body[\s\S]*overflow:\s*hidden/);
  assert.match(shellLayout, /height:\s*calc\(100dvh - 60px\)/);
  assert.match(shellLayout, /overflow-y:\s*auto/);
  assert.match(shellLayout, /::-webkit-scrollbar[\s\S]*width:\s*6px/);
  assert.match(shellLayout, /scrollbar-width:\s*thin/);
});
