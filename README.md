# dsh-token-usage 便携发布工程

把现有 `dsh-token-usage`（DSH 设置里的“Token 用量”页面）打包成可在任意 Windows x64 机器上
离线植入 DeepSeek Harness Desktop 的发布 ZIP。安装/卸载/检查框架与同目录的
`multi-workspace`、收纳口袋 `dsh-plugin-hub` 保持一致。

## 目录

| 路径 | 说明 |
| --- | --- |
| `package.json`、`cordis.patch.yml`、`lib/` | 插件本体（运行文件），其中 `lib/client.js` 由 `tools/build.mjs` 生成 |
| `src/`、`test/` | 客户端源码与账本测试；不进入发布 ZIP |
| `tools/portable.ps1` | 安装/卸载/检查共用的部署脚本，随 ZIP 发布为 `tools/portable.ps1` |
| `tools/package.ps1` | 生成发布 ZIP、逐文件校验值、ZIP 条目校验与整包 SHA-256 |
| `tools/test-portable.ps1` | 用假 DSH 夹具验证安装、升级、回滚、卸载、路径穿越拒绝，不碰真实 profile |
| `delivery/` | 发布包根目录文件：`使用说明.txt`、`安装.cmd`、`卸载.cmd`、`检查环境.cmd` |

## 构建与验证

```powershell
node tools/build.mjs
node --test test/accounting.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\test-portable.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\package.ps1
```

- `package.ps1` 默认输出到本目录的上一级（即工作区根目录），不覆盖同名 ZIP。
- 插件入口必须已构建，且插件不得有需要联网下载的第三方运行依赖；本插件只有 Node 内置依赖。
- 真实安装仍需在目标机器上用 `检查环境.cmd` / `安装.cmd` 做一次验收；夹具测试不代替真机验证。
- 所有 `.ps1` 保持纯 ASCII（Windows PowerShell 5.1 会把无 BOM 脚本按 ANSI 读取）；
  中文文件名在脚本中由字符码拼出。

## 安装位置

安装器把 `plugin/` 复制到 `<DSH_HOME>\custom-plugins\dsh-token-usage\<profile>`，
再调用目标机器自带的 DSH CLI 以离线模式登记 `link:` 依赖与 bundle。
用量账本由插件运行时写入 `<DSH_HOME>\token-usage\ledger-v1.json`。
