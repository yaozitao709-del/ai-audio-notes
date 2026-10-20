# AI 录音纪要

适用于苹果芯片 Mac 的本地录音纪要工具。中文/英文 Paraformer 快速转写，AI 结合上下文校对和轻度整理完整文字，再根据保存的完整成稿生成总结与章节。

## 产品预览

以下为发布版界面的真实截图，文字为专门编写的演示数据；不含个人录音、历史笔记或 API 密钥。首次使用时笔记列表为空。

**导入音频，或直接开始录音。** 首页集中管理笔记，右上角进入 AI 设置。

![首页：音频导入、录音入口与笔记列表](docs/images/home.jpg)

**左侧读全文，右侧看重点。** 全文经 AI 校对和轻度整理后，再生成总结与章节；支持查找、编辑、回听定位和导出。

![纪要详情：校对后的全文、总结概要与音频控制](docs/images/transcript-summary.jpg)

**使用自己的 AI 服务。** 填写密钥即可测试并保存；展开高级设置可修改 API 地址、获取可用模型列表或手动填写模型名称。

![AI 设置：服务选择、密钥输入与连接测试](docs/images/ai-settings.jpg)

## 普通用户下载

到 [Releases](https://github.com/yaozitao709-del/ai-audio-notes/releases/latest) 下载 **AI-Audio-Notes-v0.1.0-macos-arm64.zip**，不要下载 GitHub 自动生成的 Source code ZIP 来当安装包。

1. 完整解压到自己的电脑，保留整个文件夹。
2. 双击 **启动AI录音纪要.command**。包内已带官方 Node.js 运行环境和 Paraformer 快速模型，常用运行依赖已附带，不需要安装 Homebrew、Python 或 Node.js。
3. **第一次启动需要联网下载 FFmpeg/FFprobe 音频工具**；终端会显示进度。以后不会重复安装。浏览器自动打开本机页面。
4. 点首页右上角 **AI 设置**，填写自己的 API Key。默认 DeepSeek Flash；高级设置支持兼容服务、自定义模型及“获取模型”列表。
5. 测试连接、保存，之后即可导入音频或录音。双击 **关闭AI录音纪要.command** 停止后台。

此包需要 **M 系列苹果芯片 Mac、macOS 14 Sonoma 或更新版本**；不包含 Intel Mac、Windows、Linux 运行包。它是脚本启动包，不是经过 Apple 签名公证的 DMG。macOS 首次询问是否打开时，请检查下载来源并使用系统提供的正常打开方式；不要关闭系统安全保护。

## 数据与隐私

- 包内 **不含任何个人 API 密钥、录音、历史转写、总结、专名词表或开发日志**。首次打开应是空白笔记和未配置 AI 状态。
- 数据保存在自己的 `~/Library/Application Support/AI Audio Notes`。升级前先关闭旧版，重新下载时保留此目录即可；不要把它转发给别人。
- 语音识别在本机完成，原音不会被本应用上传到 AI 服务。**校对与总结会把文字发送给用户自行配置的 AI 服务**，并遵循该服务的规则和费用。
- API Key 保存在本机配置文件中，文件权限限制为当前用户；页面不回显完整旧密钥。分享应用时不要附带本机数据目录或 `.env`。
- 不会自动识别讲话人。时间是段落/音频块定位参考，不是逐字字幕对齐。
- 整理保留强调、犹豫、数字、否定与自我纠正，无法确定的地方可能继续保留原词；不保证消除所有识别错误。

## 开发者运行源码

请从 GitHub 克隆源码后开发，不要直接修改分发包中的合并文件。需要苹果芯片 Mac 和 Node.js 26+：

```sh
npm ci
npm run setup:models
npm run build
npm start
```

源码仓库不存放大型模型和 Node 运行时。模型下载会校验 `MODEL_MANIFEST.json` 的 SHA256。`npm start` 使用现有运行依赖，不会修改全局 Node 配置。开发页面可分别运行 `npm run server` 和 `npm run dev`。

```sh
# 完整测试需要上游公开测试音频（不是个人录音）
node scripts/download-models.mjs --test
npm test
npm run test:asr
npm run build
```

`PORT`、`AI_AUDIO_DATA_ROOT`、`PARAFORMER_MODEL_DIR` 可选。端口被其他程序占用时启动器会提示，不会打开或停止其他程序。保存 AI 配置后新任务立即使用；已开始的录音继续使用原配置。

## 许可与来源

应用代码采用 MIT，模型及第三方组件保留各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Paraformer 模型来源于 [sherpa-onnx 的中英双语模型](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en)，按其模型卡声明为 Apache-2.0。
