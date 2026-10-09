# 本地改动说明（未推送 GitHub）

分支：`local/douyin-image-text-submit`（仅本地提交）。日期：2026-10-08。

## 1. 抖音图文自动最终发布（`action: "submit"`）

- **能力**：`src/task-schema.js` 中仅 `douyin.image_text.submit = true`（`submission_verification: visible_platform_receipt`）。
  快手、视频号的图文仍然只支持 `prepare`，B站不支持图文。`fabu capabilities --json` 可以看到这一变化。
- **执行**（`src/image-text-runner.js`）：先填写图片、标题、正文、话题、自主声明和可选的定时时间（`scheduled_at`，与视频相同，
  走 `setScheduledPublish`），然后在 `directPublish` 时调用与视频相同的 `submitAndVerify`：
  只点击**一次**最终“发布”按钮（`getByRole('button', { name: /^(发布|立即发布|确认发布)$/ })`，与视频共用 `clickFinalPublish`）。
  点击前记录 `submitting` 阶段，即提交边界。执行器另有一层保护：抖音以外的平台即使收到 submit 也拒绝点击。
- **回执**（`src/submission.js`、新增 `src/douyin-receipt.js`）：
  1. 与视频相同：点击后出现新的、可见的成功提示（`发布成功|作品发布成功|视频发布成功|已提交审核|定时发布设置成功`）。点击前已有的提示不算。
  2. 仅图文、仅立即发布时增加一条：页面跳到 `creator.douyin.com/creator-micro/content/manage`，并且同一行记录里
     标题（或正文前 24 字）与本次一致，时间（`yyyy-MM-dd HH:mm` 或 `yyyy年MM月dd日 HH:mm`，北京时间）不早于点击时刻所在的分钟。
     这种回执记为 `verification: new_post_record`。单纯跳转、旧记录、一个容器里出现多个时间都不算。
- **结果**：只有拿到明确回执才返回 `submitted`。点击后没有回执时返回 `SUBMISSION_UNKNOWN` / `submission_unknown`，
  与视频相同，需要先执行 `tasks verify`（只重新读取回执，不会点击）或 `tasks reconcile`。**不会自动重试点击。**
  点击前出错（例如找不到按钮）返回 `failed`。同时保存 `submission_diagnostic_douyin.json` 和截图。
- **close_after_submit**：默认 `true`，确认提交后关闭窗口；设为 `false` 时保留窗口。

### 示例任务 JSON

```json
{
  "schema_version": 1,
  "idempotency_key": "douyin-image-text-2026-10-09-001",
  "type": "image_text",
  "action": "submit",
  "media": { "images": ["/absolute/path/to/1.png", "/absolute/path/to/2.jpg"] },
  "content": { "title": "图文标题（≤30字）", "description": "图文正文", "topics": ["AI", "效率工具"] },
  "targets": [
    { "platform": "douyin", "account_id": "replace-with-account-id", "declaration": "内容由AI生成", "bgm": "random" }
  ],
  "close_after_submit": true
}
```

定时发布：在 target 里加 `"scheduled_at": "2026-10-10T12:00:00+08:00"`（抖音需在 2 小时到 14 天之间）。
用法：`fabu tasks validate --file job.json --json`，然后 `fabu tasks create --file job.json --json`，再 `fabu tasks wait TASK_ID --json`。

## 2. 抖音封面：弹窗提示“上传成功”并关闭后，不再等待页面预览刷新（视频）

- 起因：海外网络下，封面弹窗显示“上传成功”，人工点发布后作品也带着封面，但页面上的封面卡片预览不刷新，
  旧逻辑因此报 `抖音确认封面设置失败：等待封面图片预览更新超时`，连续失败 3 次。
- 改动（`src/cover-handlers.js` `uploadDouyin`、`src/runner.js`）：
  - 每张封面上传后，必须在弹窗里看到**新的**“上传成功”提示（之前已有的提示不算），或者看到弹窗预览变化。
    弹窗报错（如“上传失败”）、或 30 秒内两种信号都没有，**仍然报错终止**。点击“完成”后，弹窗必须在 30 秒内关闭，否则也报错。
  - 弹窗关闭后**不再等待**页面封面卡片刷新（原来的 45 秒 + 45 秒等待已删除），只做一次即时检查，写进日志：
    刷新了记“页面封面预览已刷新”，没刷新记 `WARNING：……预览暂未刷新（不再等待，按已设置继续）`，并保存 `cover_preview_unverified_douyin.png/html`。
  - `runner.js` 对抖音也不再调用 8 秒的 `waitForPlatformCoverChange`。
  - 视频 `submit` 时，点击发布前会再执行一次 `waitDouyinVideoUploaded`（看到“重新上传”且没有“取消上传”），然后才点击“发布”，
    之后按正常流程检测回执。
- 图文任务没有封面步骤（schema 不允许图文带 `covers`），所以这一条只影响视频；图文的发布路径不经过封面代码。

## 3. 抖音自主声明：确认页面上确实选中

- 根据现场 HTML（`task_files/managed/a7f0…/artifacts/douyin_e023cea898cc4c5e/attempt_3/cover_failure_douyin.html`），页面结构为
  `section > .title-xxx「自主声明」 + .selectBox-xxx > .selectText-xxx「请选择自主声明」`，
  原触发选择器 `section:has-text("自主声明") [class*="selectBox"]` 是对的。
- 那次页面一直显示“请选择自主声明”，原因是**流程顺序**：视频流程是“封面 → 声明 → 位置/定时 → 发布”，
  封面那一步抛错，后面的声明步骤根本没有执行。
- 加固（`src/browser-utils.js` `setDouyinDeclaration`）：在弹窗点“确定”并关闭后，要求页面上的声明框文字已经不是占位符
  “请选择自主声明”（最多等 3 秒）。仍是占位符时报错 `抖音声明同步失败`，不会再误报“已填写”。如果已经显示目标声明，就不再重复打开弹窗。

## 4. 抖音图文背景音乐（BGM，2026-10-09）

- 原因：抖音图文发布后没有背景音乐，是静音的。
- 配置：target 新增字段 `bgm: "random" | "none"`，只能用于**抖音图文**；默认是 `random`。在其他平台或视频任务上填写会返回 `UNSUPPORTED_CAPABILITY`。
  `fabu capabilities --json` 里抖音的 `image_text.bgm = ["random","none"]`。
- 流程（`src/douyin-bgm.js`，由 `src/image-text-runner.js` 在声明和定时设置之后、保存登录态和点击发布之前调用；prepare 和 submit 都会执行）：
  1. 点击“选择音乐”。选择器依次尝试：`//div[@class="container-right-uW7Pj1"]` → `[class*="container-right-uW7Pj1"]` → 含“选择音乐”文字的 `container-right` → `span[class*=action]` 文字“选择音乐”。
  2. 等待抽屉里的列表出现：`div.music-collection-container-cTsB7J` / `[class*="music-collection-container"]`。
  3. 随机取 1–10 中的一个序号 N。卡片定位优先用 class 词 `card-container-tmocjc` 的 XPath（选中后多出 active class 也能匹配），其次 `[class*="card-container-tmocjc"]`。
     列表是懒加载的，所以会把列表滚到底部，最多等 8 秒凑够 N 张；不够时选已加载的最后一张。
  4. 把第 N 张卡片滚动到可见区域，`hover()` 后等待卡片内的“使用”按钮出现（`.//button[contains(@class,"apply-btn")]` / `[class*="apply-btn"]` / `button:has-text("使用")`），然后点击。
     如果按钮不可见或点击被遮挡，就重新悬停并强制点击。**不会点击卡片本身**，那样只会试听。
  5. 验证：等待抽屉关闭，最多 4 秒；仍然开着就点击 ×（`.semi-sidesheet-close` 等），再不行按 Esc，这样也会停止试听。
     然后读取“选择音乐”所在行的文字：包含歌名记为 `selected`；读不到行文字但抽屉已关闭，记为 `selected_unverified`；
     仍显示“点击添加合适作品风格音乐”则判为失败。日志会记录序号、歌名和作者。
  6. 任何一步失败都只写 `WARNING：背景音乐选择失败…` 日志，保存 `bgm_warning_douyin.png/html`，并关闭抽屉，然后继续准备或发布。
- 已知问题（上一次真实发布中发现，**本次未处理**）：抖音图文上传 PNG 失败，JPG 正常；目前建议使用 JPG。

## 测试

- 新增/调整：`test/image-text.test.js`（能力、规范化、执行器保护、Toast 回执、作品管理页回执、不重试）、
  `test/platform-features.test.js`（封面 WARNING 不等待、弹窗报错仍致命、旧“上传成功”提示不算、声明占位符校验）。
- 顺手修复了因早先移除小红书而过期的测试：agent-core、agent-api、safety、browser-lifecycle、channels-immediate-submission，以及 server 测试 1/2/19。
- 剩余 8 个 `test/server.test.js` 的 Web UI 用例（4、6、10–14、18）在干净的 HEAD 上同样失败，原因是它们依赖已删除的小红书页面元素，与本次改动无关，未处理。

## 服务

改动需要重启服务才生效（`fabu service stop && fabu service start`）。重启会关闭服务持有的 Chrome 窗口，必须等 `tasks list`
里没有运行中、排队或仍占用窗口（`window_available: true`）的任务时再重启。
