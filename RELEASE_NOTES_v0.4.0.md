Windows 10（2004/build 19041 或更新）与 Windows 11 x64 下载版。Mac v0.3.0 轻量版和完整版继续保留：[Mac 下载](https://github.com/yaozitao709-del/ai-audio-notes/releases/tag/v0.3.0)。

- `lite-windows-x64.zip`：小启动包，检测已有环境，复用兼容组件，只补装缺少的部分。
- `full-windows-x64.zip`：内置 Node、Python、转写和分人模型、CPU 语音依赖。与 Mac 完整版一致，FFmpeg/FFprobe 首次从上游下载，首次启动仍需联网。
- 完整解压后双击 `Start.cmd`；关闭后台用 `Stop.cmd`。不需要管理员权限、CUDA 或独立显卡。
- 数据位于 `%LOCALAPPDATA%\AI Audio Notes`，首次打开为空白笔记；自行配置 AI API Key。
- 新导入和新录音结束后的处理共用已修复的 Paraformer + FSMN-VAD + CAM++ 分人方法。

验证覆盖 Windows x64 hosted runner 上的中文/空格路径、从零安装、重复复用、已有/部分 Python 环境、真实公开双人音频、导入、录音完成后的处理、TXT/Word/PDF 导出，以及最终完整版 ZIP 在原环境不可用时重新解压运行。具体结果与构建提交见 `VALIDATION.json` 和 Actions。

Hosted runner 使用 Windows Server，不代表已逐一测试所有 Windows 10/11 实机和实体麦克风。Mac 下载文件保持原版本。

`SHA256SUMS.txt` 用于检查 ZIP 完整性。不要下载 GitHub 自动生成的 Source code ZIP 作为安装包。
