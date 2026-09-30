# 任务输入与恢复

以下 fabu 代表 `node FABU_CLI_ROOT/bin/fabu.js`。字段及平台限制以实时 `schema task --json` 和 `capabilities --json` 为准；上游 README 和 `src/task-schema.js` 可用于排查差异。

## 输入

最小视频结构（占位值须换成真实值后才执行）：

```json
{
  "schema_version": 1,
  "idempotency_key": "本次业务操作的唯一且稳定的键",
  "type": "video",
  "action": "submit",
  "media": {"video": "/absolute/video.mp4"},
  "content": {"title": "标题", "description": "正文", "topics": []},
  "targets": [
    {"platform": "douyin", "account_id": "实际账号ID", "scheduled_at": "2026-09-06T08:00:00+08:00"},
    {"platform": "channels", "account_id": "实际账号ID", "original": true, "scheduled_at": "2026-09-06T08:00:00+08:00"},
    {"platform": "kuaishou", "account_id": "实际账号ID", "scheduled_at": "2026-09-06T08:00:00+08:00"},
    {"platform": "bilibili", "account_id": "实际账号ID", "scheduled_at": "2026-09-06T08:00:00+08:00"}
  ]
}
```

- 图文使用 `type: image_text` 和 `media.images` 路径数组，不保留 `media.video`。平台键为 douyin/kuaishou/channels/bilibili。
- `targets` 可逐平台设置 `title`、`action`、`declaration`、`scheduled_at`；`original` 仅适用于视频号，另有 `short_title`、`hide_location`。不要添加 schema 外字段。
- 视频封面用 `media.covers` 对象，键只允许 `3:4`、`4:3`、`16:9`。按照 capabilities 中平台及真实视频方向要求整套提供，或全部省略。视频旋转/尺寸由 ffprobe 判断。
- 相对素材路径以 JSON 所在目录为准；`--file -` 输入以 cwd 为准，可通过 `--base-dir` 指定。优先写 JSON 文件，避免复杂 shell 插值。
- 通用预约用 `schedule.at`，逐目标用 `scheduled_at`，必须包含时区且为整分钟，如 `2026-09-06T12:00:00+08:00`（仅格式示例，不可原样用于未来任务）。通用时间约束为提前 2 小时至 14 天且分钟为 5 的倍数；逐平台约束查 capabilities。预约是平台内预约，不是工具在指定时间才启动；prepare 预约仍需最终提交。
- 相同 key、相同输入和媒体返回原任务；变更内容触发 IDEMPOTENCY_CONFLICT。同一业务网络重试保留原文件、媒体及 key，不通过新 key 规避冲突。

## 查询与恢复

```sh
fabu tasks get TASK_ID --json
fabu tasks list --limit 30 --offset 0 --json
fabu tasks logs TASK_ID --json
fabu tasks artifacts TASK_ID --json
fabu tasks verify TASK_ID --platform PLATFORM --account-id ACCOUNT_ID --json
```

`submission_unknown` 通过 verify 读取原窗口新回执，不会再次点击。仍无法确定时检查平台作品/投稿记录或请用户核实，再按真实证据记录：

```sh
fabu tasks reconcile TASK_ID --platform PLATFORM --account-id ACCOUNT_ID --result submitted --note '实际核实依据' --json
```

只有已确认未提交才用 `--result not_submitted`，之后才可按原授权重试：

```sh
fabu tasks retry TASK_ID --failed-only --platform PLATFORM --account-id ACCOUNT_ID --json
```

不要伪造核实依据。reconcile 记录的是 caller_verification，不是程序观测的 platform_receipt。重试只覆盖失败、中断或取消账号，成功账号不重放；预约已过期须重新选择时间、校验并用新 key 建立新的业务任务。

读取 `status`、`execution_status`、逐账号 `items/results`、`outcome` 与 `next_actions`。退出码：0 命令成功或请求动作完成；1 执行失败/中断；2 参数/能力/冲突；3 超时（不取消）；4 部分失败；5 需登录或核实；6 取消；7 环境/服务/认证不可用。优先解释具体 error.code 和账号 outcome，不仅报告退出码。
