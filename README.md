# AI 录音纪要

适用于 Windows 10/11 x64 和苹果芯片 Mac 的本地录音纪要工具。中文/英文 Paraformer 快速转写，AI 结合上下文校对和轻度整理完整文字，再根据保存的完整成稿生成总结与章节。

## 产品预览

以下为基础功能的界面截图（演示内容；v0.2.0 另新增自动分人状态和重新分人按钮），文字为专门编写的演示数据；不含个人录音、历史笔记或 API 密钥。首次使用时笔记列表为空。

**导入音频，或直接开始录音。** 首页集中管理笔记，右上角进入 AI 设置。

![首页：音频导入、录音入口与笔记列表](docs/images/home.jpg)

**左侧读全文，右侧看重点。** 全文经 AI 校对和轻度整理后，再生成总结与章节；支持查找、编辑、回听定位和导出。

![纪要详情：校对后的全文、总结概要与音频控制](docs/images/transcript-summary.jpg)

**使用自己的 AI 服务。** 填写密钥即可测试并保存；展开高级设置可修改 API 地址、获取可用模型列表或手动填写模型名称。

![AI 设置：服务选择、密钥输入与连接测试](docs/images/ai-settings.jpg)

## 普通用户下载

按自己的系统选择下载。Windows 新版与 Mac 已发布版本都保留；GitHub 自动生成的 Source code ZIP 不是安装包。

| 系统 | 轻量版 | 完整版 |
| --- | --- | --- |
| **Windows 10/11 x64** | [下载 v0.4.0 轻量版](https://github.com/yaozitao709-del/ai-audio-notes/releases/download/v0.4.0/AI-Audio-Notes-v0.4.0-lite-windows-x64.zip) | [下载 v0.4.0 完整版](https://github.com/yaozitao709-del/ai-audio-notes/releases/download/v0.4.0/AI-Audio-Notes-v0.4.0-full-windows-x64.zip) |
| **苹果芯片 Mac** | [下载 v0.3.0 轻量版，约 0.9 MB](https://github.com/yaozitao709-del/ai-audio-notes/releases/download/v0.3.0/AI-Audio-Notes-v0.3.0-lite-macos-arm64.zip) | [下载 v0.3.0 完整版，约 583 MB](https://github.com/yaozitao709-del/ai-audio-notes/releases/download/v0.3.0/AI-Audio-Notes-v0.3.0-full-macos-arm64.zip) |

- **轻量版**：自动检测已有 Node、Python、模型和音频工具，只下载缺少或版本不兼容的部分。完全没有环境时，首次总下载量仍可能接近完整版。
- **完整版**：内置 Node、Python、Paraformer、FSMN-VAD、CAM++ 和语音依赖。与 Mac 完整版一致，音频工具首次从上游下载，因此首次启动仍需联网。
- 两种版本使用同一套已修复的分人方法：新导入音频自动分人，新录音在结束后分人。Windows 使用 CPU，不需要 CUDA 或独立显卡。

### Windows 使用

需要 **Windows 10 2004（系统 build 19041）或更新版本 / Windows 11，x64 电脑**。此包不适用于 Windows ARM 或 32 位系统。

1. 完整解压 ZIP，保留整个文件夹；不要直接在压缩包内打开程序。
2. 双击 **Start.cmd**。轻量版显示检测与补装进度；不要求自己安装 Node/Python，也不需要管理员权限。首次安装请保持联网。
3. 浏览器打开后，点右上角 **AI 设置**，填写自己的 API Key。默认 DeepSeek Flash，也支持兼容服务和自定义模型。
4. 录音时允许浏览器使用麦克风。建议使用 Edge 或 Chrome；PDF 导出也会检测这两个浏览器。
5. 双击 **Stop.cmd** 关闭后台；升级前先关闭旧版。`Prepare.cmd` 可只准备轻量版环境。

数据保存在 `%LOCALAPPDATA%\AI Audio Notes`；轻量版缓存位于其中的 `runtime-cache`。关闭窗口不等于关闭后台，应用没有运行时不要手动删除数据目录。

验证方式见 [Windows 自动测试](https://github.com/yaozitao709-del/ai-audio-notes/actions/workflows/windows.yml)：使用 Windows x64 hosted runner，覆盖中文/空格路径、首次安装、重复复用、转写分人、导出和完整版搬迁。Hosted runner 是 Windows Server；这不等同于每一种 Windows 10/11 实机和实体麦克风都已测试。

### Mac 使用

需要 **M 系列苹果芯片 Mac、macOS 14 Sonoma 或更新版本**。已有 v0.3.0 轻量版/完整版继续可用，无须为了 Windows 适配而重新下载。

1. 完整解压，双击 **启动AI录音纪要.command**。
2. 轻量版自动检测、复用和补装，不要求自行安装 Homebrew、Node 或 Python。
3. 浏览器中配置自己的 AI 服务；双击 **关闭AI录音纪要.command** 停止后台。

数据保存在 `~/Library/Application Support/AI Audio Notes`。这是脚本启动包，不是签名公证 DMG；系统询问是否打开时，请核对来源并使用系统提供的正常打开方式。

### 轻量版如何复用环境

- 检查 PATH、激活的 venv/Conda、常见 Python/Conda 安装位置和同目录完整版。Mac 也检查 Homebrew/pyenv；Windows 也检查 Python Launcher。
- Node 需为本机架构且不低于 26。Python 使用 **3.11**，Windows 为 x64、Mac 为 arm64；按对应平台的 `requirements-speech*.txt` 检测版本，再实际导入关键模块。
- 不完整的现有 Python 环境只作为只读来源；缺少或版本不符的包安装到应用自己的隔离目录，不升级或卸载原环境。
- 模型逐文件校验 SHA256；已有匹配文件不重新下载。音频工具检查常用格式。网络中断后再次启动即可重试，校验通过的文件保留。
- 自定义 Python 可设 `SPEAKER_PYTHON`；模型可设 `PARAFORMER_MODEL_DIR` / `SPEAKER_MODEL_ROOT`。`AI_AUDIO_REUSE_DIRS` 可指定其他应用目录，Windows 多个目录用分号分隔，Mac 用冒号分隔。
- `AI_AUDIO_NODE` 可指定 Node，`AI_AUDIO_CACHE_DIR` 可改变缓存位置，`AI_AUDIO_DATA_ROOT` 可改变笔记数据位置。通常不需要设置这些参数。
- 排查复杂 Python 环境问题时，可设 `AI_AUDIO_ISOLATED_PYTHON=1`，强制使用应用独立的 Python。
- 只检测明确位置和常见位置，不扫描整块磁盘。复用的外部环境移动或卸载后，下一次启动会重新检测。

## 数据与隐私

- 包内 **不含任何个人 API 密钥、录音、历史转写、总结、专名词表或开发日志**。首次打开应是空白笔记和未配置 AI 状态。
- 数据保存在本机对应系统的数据目录（见上文）。升级前先关闭旧版，重新下载时保留此目录即可；不要把它转发给别人。
- 语音识别在本机完成，原音不会被本应用上传到 AI 服务。**校对与总结会把文字发送给用户自行配置的 AI 服务**，并遵循该服务的规则和费用。
- API Key 保存在本机配置文件中，文件权限限制为当前用户；页面不回显完整旧密钥。分享应用时不要附带本机数据目录或 `.env`。
- 新导入自动区分讲话人；新录音在结束后完成分人。历史记录可点“重新区分讲话人”，处理前自动备份。编号表示录音内的声音身份，不是真实姓名。
- v0.2.0 修复了少量异常声音导致两位主要讲话人被合并的问题；长录音使用谱聚类。Windows 使用 CPU；苹果芯片优先使用 MPS/GPU，失败时回退 CPU。
- 时间为声音片段定位参考，不是逐字对齐；短促插话、重叠讲话、相似声音仍可能误分。
- 整理保留强调、犹豫、数字、否定与自我纠正，无法确定的地方可能继续保留原词；不保证消除所有识别错误。

## 开发者运行源码

请从 GitHub 克隆源码后开发，不要直接修改分发包中的合并文件。需要对应系统的 Node.js 26+、Python 3.11。Mac：

```sh
npm ci
npm run setup:models
npm run setup:speakers
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements-speech.txt
export SPEAKER_PYTHON="$PWD/.venv/bin/python"
npm run build
npm start
```

Windows PowerShell（源码开发；普通用户用上面的 ZIP）：

```powershell
npm ci
npm run setup:models
npm run setup:speakers
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\python.exe -m pip install --find-links support-wheels -r requirements-speech-windows.txt
$env:SPEAKER_PYTHON = (Resolve-Path '.venv\Scripts\python.exe').Path
npm run build
npm start
```

源码仓库不存放大型模型及 Node/Python 运行时。模型下载会校验 `MODEL_MANIFEST.json` 和 `SPEAKER_MODEL_MANIFEST.json` 的 SHA256。`npm start` 使用现有运行依赖，不会修改全局 Node 配置。开发页面可分别运行 `npm run server` 和 `npm run dev`。

```sh
# 完整测试需要上游公开测试音频（不是个人录音）
node scripts/download-models.mjs --test
node scripts/download-speaker-models.mjs --test
npm test
npm run test:asr
npm run test:installer
npm run build
```

`PORT`、`AI_AUDIO_DATA_ROOT`、`PARAFORMER_MODEL_DIR`、`SPEAKER_PYTHON`、`SPEAKER_MODEL_ROOT` 可选；源码开发可用 `SPEAKER_DIARIZATION=false` 关闭分人以运行纯快速转写。端口被其他程序占用时启动器会提示，不会打开或停止其他程序。保存 AI 配置后新任务立即使用；已开始的录音继续使用原配置。

## 许可与来源

应用代码采用 MIT，模型及第三方组件保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Paraformer 模型来源于 [sherpa-onnx 的中英双语模型](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en)，按其模型卡声明为 Apache-2.0。
