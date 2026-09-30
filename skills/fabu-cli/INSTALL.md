# 安装 fabu-cli Skill

收到「拉到本地安装并封装成 skill」类请求时，按以下步骤执行。

## 1. 克隆并安装项目

```sh
git clone https://github.com/lihuithe/fabu-cli.git
cd fabu-cli
cnpm install
# 镜像不可用时：
# npm install --registry=https://registry.npmjs.org
node bin/fabu.js doctor --json
```

## 2. 安装 Skill

将本目录 `skills/fabu-cli/` 复制到个人 Skill 目录之一：

- Codex：`~/.codex/skills/fabu-cli/`
- Cursor：`~/.cursor/skills/fabu-cli/`

把 `SKILL.md` 和 `references/task-rules.md` 中的 `FABU_CLI_ROOT` 全部替换为 fabu-cli 克隆目录的绝对路径（例如 `/Users/you/code/fabu-cli`）。

## 3. 验证

```sh
node <FABU_CLI_ROOT>/bin/fabu.js service start --json
node <FABU_CLI_ROOT>/bin/fabu.js accounts list --json
node <FABU_CLI_ROOT>/bin/fabu.js capabilities --json
```

完成后告知用户：后续可说「发布 skill」触发本 Skill，常见话术见仓库 `docs/agent-tutorial.md`。
