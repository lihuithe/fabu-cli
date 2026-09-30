---
name: fabu-cli
description: 使用本机 fabu-cli 将视频或图文上传准备或提交到抖音、快手、视频号和 B站，执行账号登录、预约配置、任务查询与结果核实。用户提到 fabu、发布 skill、发布 Ready、多平台内容分发或要求通过此工具发布素材时使用；不用于网站部署或软件发版。
---

# fabu-cli 多平台内容发布

## 本机入口

- 源码：`FABU_CLI_ROOT`（安装时写入本机 fabu-cli 克隆目录的绝对路径），上游 `https://github.com/lihuithe/fabu-cli.git`。
- 直接调用 `node FABU_CLI_ROOT/bin/fabu.js ... --json`，无需全局安装。下文 `fabu` 均指该完整命令。
- 默认账号、任务和服务数据位于该项目。沿用默认目录，不随任务新建数据根目录；只有用户要求隔离时才对所有命令一致传入 `--data-dir`。
- 环境需要 Node >=22.12、Google Chrome、ffprobe 和本机桌面会话。先运行 `doctor --json`；缺依赖时在项目内优先 `cnpm install`，镜像不可用才使用 `npm install --registry=https://registry.npmjs.org`。不要每次重装。
- 服务使用 `service status/start --json`；启动命令会复用已有服务。Web 工作台通过在项目内执行 `npm start` 打开；实际 URL 从服务结果读取，不假设端口固定。

## 常见用户意图

| 用户说法 | 对应动作 |
| --- | --- |
| 绑定抖音号 / 新增抖音号绑定 | `accounts login --platform douyin --remark <备注> --json`；已有账号重登用 `--account-id` |
| 更新视频号绑定授权 | `accounts login --platform channels --account-id <账号ID> --json`（视频号授权通常 24 小时内失效） |
| 批量定时发布、勾原创、不做声明 | 为每条视频建任务：`action: submit`（用户已授权时）、`scheduled_at` 设早中晚、`original: true`（视频号）、`declaration` 省略；平台键 douyin/channels/kuaishou/bilibili |
| 只准备不上传提交 | `action: prepare`，保留窗口供人工检查 |

## 执行流程

1. 明确素材、目标平台及账号、标题正文、内容声明、是否预约，以及用户要上传准备还是最终提交。沿用已有授权；已明确指定内容和目标并要求发布时，不重复征求相同许可。仅要求写文案或校验时不创建任务；`prepare` 也会向平台上传素材。
2. 运行 `doctor --json`、`service start --json`、`capabilities --json`、`schema task --json` 和 `accounts list --json`。以当前能力和 schema 为准，账号 ID 必须来自列表；多个候选且上下文无法确定时询问目标账号。
3. 登录缺失或过期时调用 `accounts login --platform PLATFORM --remark REMARK --json`，告知用户在 Chrome 完成登录，再用返回的 binding_id 查询 `accounts login-status BINDING_ID --json`。重登使用 `--account-id ACCOUNT_ID` 保留原 ID。`bound` 仅表示本地登录态存在，不保证实时有效；不读取或代填密码、验证码。
4. 在当前任务工作目录生成 JSON，使用上游 `examples/video-job.json` 或 `examples/image-text-job.json` 作为结构参考；按真实内容修改声明，不照抄示例的 AI 声明。需要字段细节时读 [任务规则](references/task-rules.md)。使用绝对素材路径，保留图片顺序。为一次业务操作生成并保存稳定的 `idempotency_key`。
5. 运行 `tasks validate --file /absolute/job.json --json`，修正错误后再创建。校验只传给本机服务探测，不向平台发布。最终提交前确保已有针对具体内容和目标的发布授权；没有授权时先准备可审阅的任务文件和校验结果，再询问缺失授权。
6. `tasks create --file /absolute/job.json --json` 会立即入队并执行。保存 `data.task.id` 和幂等键；`tasks wait TASK_ID --timeout 45 --json` 分段等待，必要时配合 `tasks get` 和 `tasks logs`。超时不会取消后台任务，不能因超时换 key 重建。
7. 按每个账号的 outcome 报告结果、任务 ID 和必要的下一步。`success:true` 或查询退出码 0 不代表发布成功；`prepared` 是上传填写完成、仍需人工最终发布；`submitted` 仅表示观察到平台接受提交，不代表审核通过或已公开。

## 能力与恢复边界

- 支持平台：抖音、快手、视频号、B站；不支持小红书。每次以 `capabilities --json` 更新下列判断。
- 视频：四平台均可 prepare；submit 支持回执检测。
- 图文：抖音、快手、视频号可 prepare；submit 暂不支持；B站图文不支持。
- 快手无独立标题，`title` 可留空；话题最多 4 个；`original` 不适用。
- 视频号 `original: true` 勾选原创；未勾选时可能出现“声明原创”提示，程序会点“直接发表”。
- 默认 action 是 prepare，目标级 action 可覆盖它。用户要求的 submit 不受支持时明确说明，只在已获授权范围内准备素材并交由用户完成，不能报告已发布或擅自绕过工具点击。
- `submission_unknown` 先运行 `tasks verify` 读取原窗口回执，绝不直接重发；更多恢复命令见 [任务规则](references/task-rules.md)。没有成功提示不能证明未提交。
- 准备窗口保持账号锁。用户完成检查后可 `tasks close-windows TASK_ID --json` 释放；不要提前关闭用户仍需检查或点击发布的窗口。同一账号不可并行发布或重登。
- 不把 `service stop` 当作普通清理：它会关闭窗口并中断运行任务。任务取消、重试、窗口关闭均只作用于本次授权范围。
- 不输出或复制 `account_data/`、`.fabu/instance.json` 的登录态与凭据。排障先用结构化日志和 artifacts 路径，截图/HTML 可能含账号信息。
- 更新项目先检查 Git 状态，有未提交改动不覆盖；干净时可 `git pull --ff-only`。升级运行中的服务前先检查任务与保留窗口，完成或妥善处理后才停止重启。升级后重跑 doctor、capabilities、schema。
