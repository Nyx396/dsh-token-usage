# DSH 扩展口袋与插件配置

非官方社区插件，包名 dsh-plugin-hub，版本 **1.0.1**。适配 Windows x64 / DeepSeek Harness Desktop **0.2.1-rc.3**。
在输入框旁提供方框加号扩展入口，并在设置侧栏提供可搜索的“插件配置”。扩展通过显式注册加入动作和配置页面。

## 安装

普通用户从 Releases 下载完整安装 ZIP 并解压。完全退出 DSH（包括托盘），先运行“检查环境.cmd”，再运行“安装.cmd”，完成后重启 DSH。卸载同样先退出 DSH，再运行“卸载.cmd”。

本源码目录已包含运行所需的预构建 lib/，可在完成必要依赖恢复后直接使用根目录的同名 CMD。无需另外安装 Node、Python 或 npm 运行依赖；安装器使用本机 DSH 自带 CLI，离线注册。

安装位置为 <DSH_HOME>/custom-plugins/dsh-plugin-hub/<profile>；默认 profile 为 desktop。安装前备份，失败尝试回滚，备份位于 <DSH_HOME>/backups/dsh-plugin-hub/。不主动关闭用户进程。

自定义路径可执行 `tools/portable.ps1 -Mode Check -DshPath <DSH安装目录> -DshHome <DSH数据目录> -Profile desktop`，确认后将 Check 改为 Install 或 Uninstall。Check 为只读。

## 使用与范围

安装后重启 DSH，使用输入框旁的方框加号访问已注册动作，在设置的“插件配置”中搜索扩展页面。视频/GIF 等具体功能由各自插件提供。

搜索匹配页面名称和注册关键字。设置仍由对应扩展保存；本插件只负责入口、收纳和定位。动作与页面随贡献扩展注销，避免关闭或重载后的重复入口。

## 公开源码

本目录保留预构建运行文件、必要说明、安装器和许可证。测试、构建分片、内部设计、上传备忘、日志、截图和本机验收记录留在维护工作区。package.json 不保留未分发的开发脚本。根目录 SHA256SUMS.txt 校验随源码分发的文件；安装 ZIP 另有独立的整包校验。

MIT，见 LICENSE。
