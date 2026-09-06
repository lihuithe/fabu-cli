# fabu-cli · 发布 Ready

本地多平台视频与图文发布工具。Web 工作台与 `fabu` CLI 共用账号、SQLite 任务数据库、执行队列和 Playwright 自动化。无需软件账号、订阅或云端服务。

支持通过 Web 界面操作，也可以由 AI Agent 使用 JSON 任务文件调用 CLI，完成素材校验、多账号任务创建、进度查询和提交结果核实。平台账号仍需由用户登录。

- **多平台**：抖音、小红书、视频号、B站，具体动作支持范围见下方能力表。
- **共享工作流**：Web 与 CLI 共用账号、任务队列和执行结果。
- **可恢复任务**：SQLite 持久化、幂等创建、账号互斥、取消与失败重试。
- **结构化输出**：JSON / JSONL、明确退出码、截图与 HTML 现场，便于 Agent 集成。

## 获取项目

```sh
git clone https://github.com/lihuithe/fabu-cli.git
cd fabu-cli
```

安装下方环境和依赖后，执行 `npm start` 打开工作台，或使用 CLI 标准流程。当前通过源码运行，`package.json` 的 `private: true` 用于防止误发布到 npm，不影响 GitHub 仓库公开访问。

## 环境与安装

- Node.js **22.12 或更高版本**。
- Google Chrome，以及有桌面会话的本机环境。首次绑定、验证码或登录失效需要人在 Chrome 中完成平台登录。
- FFmpeg 中的 **ffprobe**，用于真实读取视频方向、时长、图片尺寸和封面比例。macOS 可安装 FFmpeg，Windows 将 FFmpeg 的 `bin` 目录加入 PATH；也可以设置 `FFPROBE_PATH` 为可执行文件绝对路径。

优先安装依赖：

```sh
cnpm install
# 镜像不可用时：
npm install --registry=https://registry.npmjs.org
```

直接从项目运行 CLI，无需全局安装：

```sh
node bin/fabu.js --help
node bin/fabu.js doctor --json
```

需要在其他目录直接使用 `fabu` 时，在项目目录执行 `npm link`。下文的 `fabu` 均可替换为 `node /项目绝对路径/bin/fabu.js`。

## 启动 Web 或后台服务

原有双击启动脚本及以下命令继续可用：

```sh
npm start
npm run serve
```

`npm start` 打开 Web 工作台；`npm run serve` 仅启动前台服务。默认监听 `127.0.0.1:8000`，占用时自动尝试后续端口。已通过 CLI 启动后台服务时，`npm start` 会打开已有服务的网页。

Agent 推荐使用常驻后台服务：

```sh
fabu service start --json
fabu service status --json
fabu service stop --json
```

后台服务独立于 CLI 进程。关闭 Web 标签页、CLI 查询结束或等待超时均不取消发布任务。停止服务会关闭它持有的 Chrome 窗口，把未完成的执行标记为中断，不会在下次启动时自动重放。

同一个数据目录只允许一个服务实例。端口、实例 ID、访问凭据和进程 ID 记录在 `.fabu/instance.json` 中，CLI 自动发现并校验，不依赖固定端口。

## 平台能力

| 内容 | 抖音 | 小红书 | 视频号 | B站 |
|---|---|---|---|---|
| 视频准备 | 支持 | 支持 | 支持 | 支持 |
| 视频提交 | 支持回执检测 | 暂不支持 | 支持回执检测 | 支持回执检测 |
| 图文准备 | 支持 | 支持 | 支持 | 不支持 |
| 图文提交 | 暂不支持 | 暂不支持 | 暂不支持 | 不支持 |

`prepare` 上传并填写资料，保留 Chrome 窗口供人工检查和发布。`submit` 会尝试点击最终按钮，并且只在检测到**明确的平台成功回执**时返回 `submitted`。成功回执表示平台接受提交，不代表审核通过、已经公开发布或未来预约一定成功。

视频号定时发布还会直接读取作品管理列表，核对同一作品记录的完整标题和北京时间预约时刻。匹配后记录 `platform_receipt`，并以 `verification: scheduled_post_record` 标明依据，无需识图；只有页面跳转、标题或时间不匹配，以及点击前已存在的匹配记录都不会作为本次成功依据。

平台页面发生变化、需要二次确认、网络异常或超时时，任务可能返回 `submission_unknown`，不会自动重新点击。通过 `fabu capabilities --json` 获取当前支持范围、标题长度、声明选项、封面要求和预约时间限制。

预约功能填写平台预约时间；本工具不提供到点启动浏览器的本地定时调度。`prepare` + 预约时间仍需人工最终提交。

## Agent 的标准流程

```sh
fabu doctor --json
fabu service start --json
fabu capabilities --json
fabu schema task --json
fabu accounts list --json
```

账号 ID 必须来自账号列表。`bound` 代表本地登录态文件存在且未被标记失效，不是实时在线验证；打开平台后仍可能发现过期。

需要登录时：

```sh
fabu accounts login --platform douyin --remark 主账号 --json
fabu accounts login-status BINDING_ID --json
# 或等待人在窗口内完成登录
fabu accounts login --platform douyin --wait --timeout 300 --json
# 重新登录已有账号，保留原账号 ID
fabu accounts login --platform douyin --account-id ACCOUNT_ID --json
```

CLI 不会索要或代填平台密码、验证码。登录过程状态在本次服务中有效，服务重启后用账号列表确认是否绑定成功；未完成的绑定需重新发起。

复制并填写 [视频示例](examples/video-job.json) 或 [图文示例](examples/image-text-job.json)，替换素材路径、账号 ID、内容声明和幂等键：

```sh
fabu tasks validate --file /path/to/job.json --json
fabu tasks create --file /path/to/job.json --json
fabu tasks wait TASK_ID --timeout 600 --json
```

预检查会把素材流式传给**本地服务**进行媒体读取和校验，结束后删除临时上传；不会访问发布平台、打开发布窗口或创建持久化任务。实际执行时会再次检查账号和预约时间。

创建任务返回 `data.task.id`。`tasks wait` 等待当前执行结束，`prepare` 成功后返回准备结果及人工检查提示，不会一直等待人工点击发布。

### 输入约定

- 支持 `--file /path/job.json` 和 `--file -`（从 stdin 读取 JSON）。
- 文件内相对素材路径以 JSON 文件所在目录为基准；stdin 输入以当前目录为基准，可用 `--base-dir` 覆盖。
- 图片数组严格保留顺序。
- 视频尺寸由 ffprobe 读取，包含旋转信息，不使用调用者声明的宽高。
- 视频支持 MP4、MOV、AVI、MKV、WebM，单文件最大 20 GiB；图文最多 18 张，每张不超过 30 MiB，支持 JPG、JPEG、PNG、WebP。平台的实际账号限制仍以平台页面为准。
- 自定义视频封面放在 `media.covers`：键为 `3:4`、`4:3`、`16:9`，值为路径；各平台所需封面必须整套上传，也可以全部省略使用平台默认封面。
- `content` 支持通用 `title`、`description`、`topics` 数组和 `fixed_topic`。
- `targets` 支持独立 `title`、`action`、`declaration`、`scheduled_at`。小红书/视频号支持 `original`；视频号支持 `short_title`、`hide_location`；支持位置搜索的视频平台可设置 `location`。
- `action` 默认 `prepare`，目标上的 `action` 可覆盖通用设置。不支持的能力返回错误，不会静默降级。
- `close_after_submit` 默认 `true`，仅对已确认提交的任务生效。准备或失败现场仍保留，直到手动关闭窗口或执行 `close-windows`。
- `schedule.at` 和目标 `scheduled_at` 必须携带明确时区，精度为整分钟，例如 `2026-09-06T12:00:00+08:00`。服务转换为平台的 `Asia/Shanghai` 时间。Web 表单传入浏览器时区，再做同样转换。
- 通用预约时间要求提前 2 小时至 14 天，分钟为 5 的倍数。平台独立时间：抖音 2 小时至 14 天，小红书 1 小时至 15 天，视频号/B站 5 分钟至 15 天；B站分钟为 5 的倍数。
- 未知字段会被拒绝。完整字段定义以 `fabu schema task --json` 为准。

### 幂等与恢复

CLI 创建任务必须提供 `idempotency_key`，也可使用 `--idempotency-key KEY`。同一业务操作的网络重试必须保留原 key。相同 key 和相同输入、媒体内容返回原任务，内容变化则返回 `IDEMPOTENCY_CONFLICT`。要有意发布另一条内容，使用新 key。

```sh
fabu tasks get TASK_ID --json
fabu tasks list --limit 30 --offset 0 --json
fabu tasks logs TASK_ID --json
fabu tasks logs TASK_ID --after 100 --follow --jsonl
fabu tasks artifacts TASK_ID --json
fabu tasks cancel TASK_ID --json
fabu tasks close-windows TASK_ID --json
fabu tasks retry TASK_ID --failed-only --json
```

同一账号跨视频、图文任务互斥，也与重新登录、资料刷新、删除互斥。准备窗口保留期间继续占用账号锁；检查完成后关闭窗口，后续任务才能启动。全局运行并发默认 2，任务窗口上限默认 8，避免无限打开 Chrome。

重试只针对失败、中断或取消的账号，成功账号不会重放。可用 `--platform` 和 `--account-id` 选择单个账号。排队或重试时预约时间已过期会返回错误，此时应修改时间并创建使用新 key 的任务。

`submission_unknown` 必须先核实：

```sh
# 原窗口仍在时，只读取新的成功回执，不会再次点击发布
fabu tasks verify TASK_ID --platform douyin --account-id ACCOUNT_ID --json

# 到平台检查作品/投稿记录后，明确记录核实结果与依据
fabu tasks reconcile TASK_ID --platform douyin --account-id ACCOUNT_ID \
  --result submitted --note '已在平台投稿列表确认本次作品及提交时间' --json

# 确认没有提交才使用 not_submitted，之后可明确重试
fabu tasks reconcile TASK_ID --platform douyin --account-id ACCOUNT_ID \
  --result not_submitted --note '已核对平台作品和草稿记录，确认未提交' --json
```

不能把“没有看到成功提示”当作“未提交”的依据。`reconcile` 是调用者的核实记录，结果中会标注 `caller_verification`，与程序观测到的 `platform_receipt` 区分。

## 输出和退出码

`--json` 下 stdout 只有 JSON，日志/提示不混入 stdout；`--jsonl` 日志每行一个事件，事件有递增 `seq`，支持断点读取。

成功响应：`{"schema_version":1,"success":true,"data":...}`。

错误响应：`{"schema_version":1,"success":false,"error":{"code":"...","message":"...","retryable":false,"next_action":null}}`，附带兼容 Web 的 `detail`。

`success` 表示命令/查询成功；任务是否完成需读取任务字段：

- `status`：`queued`、`running`、`completed`、`cancelled`、`interrupted`。
- `execution_status`：执行期间为 queued/running，结束后为 `succeeded`、`partial_failed`、`failed`、`needs_attention`、`cancelled`。
- 每个账号的 `outcome`：`prepared`、`submitted`、`submission_unknown`、`failed`、`cancelled`、`interrupted`、`not_submitted`；整体可能为 `mixed`。
- `next_actions`：人工检查、登录或核实提交结果的操作提示。
- `results`、`items`：每账号结果、执行次数、窗口是否可用、错误码和证据路径。

| 退出码 | 含义 |
|---|---|
| 0 | 命令成功；wait 表示所有账号完成请求的动作 |
| 1 | 执行失败或服务中断 |
| 2 | 参数错误、能力不支持、冲突或资源不存在 |
| 3 | 等待/请求超时，任务不因此取消 |
| 4 | 部分账号失败 |
| 5 | 需要登录或核实提交结果 |
| 6 | 任务取消 |
| 7 | 服务、环境依赖或本地认证不可用 |

`get/list` 查询本身成功返回 0；`wait/verify` 根据任务结果设置退出码。`prepare` 请求准备完成时返回 0，人工发布不属于该动作的完成条件。

## 数据与配置

默认继续使用项目目录中的账号资料：

- `account_data/`：账号信息和平台登录态，Web 与 CLI 共用。
- `.fabu/tasks.sqlite`：任务、输入计划、执行结果、幂等索引和事件日志。
- `.fabu/instance.json`：本机服务凭据，使用仅当前用户可读写的文件权限。
- `.fabu/service.log`：后台服务日志。
- `task_files/managed/`：持久化素材和按任务/账号/执行次数区分的截图、HTML 现场。
- Web 的未提交草稿仍保存在浏览器中；CLI 用 JSON 任务文件管理输入。

使用 `--data-dir /absolute/path` 或环境变量 `PUBLISHER_DATA_ROOT` 切换整套账号/任务数据。已有旧版任务素材会保留，但旧版仅存在内存的任务记录无法恢复。升级前请先完成旧服务中的任务并停止旧服务。

启动服务时可设置 `PORT`、`FABU_CONCURRENCY`、`FABU_MAX_WINDOWS`、`FFPROBE_PATH`。设置后需要重启对应服务；窗口上限必须不小于并发数。

服务仅绑定本机回环地址，Agent API 使用本地凭据。此版本面向同机 Agent，未实现远程机器访问。不要复制 `account_data`、`.fabu/instance.json` 或包含账号信息的现场文件给无关调用方。

## 检查与实现入口

```sh
npm run check
npm test
```

`npm test` 自动使用独立的临时数据目录，不读取或修改真实账号与任务数据库。测试覆盖 Web 兼容、平台页面 fixture、共享校验、真实 CLI/HTTP 调用、媒体探测、任务持久化、幂等、互斥、取消、重试以及提交回执检测。平台 fixture 测试不等于真实账号发布验收。

实现入口：`src/http-app.js`（Web/Agent API）、`src/task-service.js`（共享调度）、`src/task-store.js`（SQLite）、`src/task-schema.js`（规范/能力/校验）、`src/cli.js`（命令）、`src/service-runtime.js`（服务生命周期）、`src/submission.js`（提交回执）。平台自动化沿用 `src/runner.js`、`src/image-text-runner.js` 及相关模块。

## 项目结构

```text
bin/          fabu 命令行入口
src/          HTTP API、账号管理、任务调度与平台自动化
scripts/      启动、语法检查与隔离测试脚本
web_pages/    Web 工作台页面
web_static/   前端脚本、样式与静态资源
examples/     视频与图文任务 JSON 示例
test/         自动化测试与平台页面 fixture
```

账号登录态、任务素材、本地服务凭据和运行日志属于本机数据，已通过 `.gitignore` 排除。提交问题时请先移除日志、截图和 HTML 中的账号信息。
