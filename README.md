# DSH Token 用量统计

非官方社区插件，包名 dsh-token-usage，版本 **1.0.0-local.2**。适配 Windows x64 / DeepSeek Harness Desktop **0.2.1-rc.3**。
在 DSH 设置中显示 Token 用量、年度活动热力图，以及近 7 天或 30 天的模型用量趋势与占比。

## 安装

普通用户从 Releases 下载完整安装 ZIP 并解压。完全退出 DSH（包括托盘），先运行“检查环境.cmd”，再运行“安装.cmd”，完成后重启 DSH。卸载同样先退出 DSH，再运行“卸载.cmd”。

本源码目录已包含运行所需的预构建 lib/，可在完成必要依赖恢复后直接使用根目录的同名 CMD。无需另外安装 Node、Python 或 npm 运行依赖；安装器使用本机 DSH 自带 CLI，离线注册。

安装位置为 <DSH_HOME>/custom-plugins/dsh-token-usage/<profile>；默认 profile 为 desktop。安装前备份，失败尝试回滚，备份位于 <DSH_HOME>/backups/dsh-token-usage/。不主动关闭用户进程。

自定义路径可执行 `tools/portable.ps1 -Mode Check -DshPath <DSH安装目录> -DshHome <DSH数据目录> -Profile desktop`，确认后将 Check 改为 Install 或 Uninstall。Check 为只读。

## 使用与范围

安装后重启 DSH，打开设置侧栏的“Token 用量”。页面可手动刷新，可见时每 15 秒自动刷新。

仅统计服务商实际返回的用量字段，不按字符估算；未返回用量的调用不会补数。账本保存模型、日期与 Token 数，不保存消息正文。账本位于 <DSH_HOME>/token-usage/ledger-v1.json，卸载保留数据。当前插件版本为 1.0.0-local.2，保留本地版本标识。

## 公开源码

本目录保留预构建运行文件、必要说明、安装器和许可证。测试、构建分片、内部设计、上传备忘、日志、截图和本机验收记录留在维护工作区。package.json 不保留未分发的开发脚本。根目录 SHA256SUMS.txt 校验随源码分发的文件；安装 ZIP 另有独立的整包校验。

MIT，见 LICENSE。
