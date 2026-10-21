# Third-party components

The application code is MIT licensed. Third-party components keep their own licenses.

- Paraformer bilingual streaming ONNX weights: csukuangfj / FunASR / DAMO Academy; Apache-2.0 as declared by the upstream model card. Source: https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en . Origin: https://www.modelscope.cn/models/damo/speech_paraformer_asr_nat-zh-cn-16k-common-vocab8404-online . The release includes the unchanged int8 encoder/decoder and token vocabulary, with checksums in MODEL_MANIFEST.json and Apache license in licenses/Apache-2.0.txt.
- sherpa-onnx: Apache-2.0; https://github.com/k2-fsa/sherpa-onnx . Included as the unmodified npm dependency with its license files.
- Official Node.js macOS arm64 distribution: https://nodejs.org/ . The binary package retains runtime/LICENSE, and the upstream checksummed distribution metadata. The user launcher does not invoke npm.
- React, Vite, Lucide and the other JavaScript dependencies retain their package licenses.
- FFmpeg/FFprobe platform binaries are NOT redistributed inside this release; the JavaScript wrapper packages are included with their package notices. They are downloaded directly from the public npm tarballs pinned by SHA512 in AUDIO_TOOLS_MANIFEST.json on first launch. Their package notices and licenses apply (FFmpeg may contain GPL components; FFprobe package declares LGPL-2.1). Sources: https://github.com/kribblo/node-ffmpeg-installer , https://github.com/SavageCore/node-ffprobe-installer , https://ffmpeg.org/ . Do not repackage third-party binaries without retaining their licenses and satisfying applicable source requirements.

No personal API credentials, recordings, transcript history or private dictionaries are part of this repository or the release archive.

## Speaker runtime added in v0.2.0

- FSMN-VAD and CAM++: unchanged weights from the official FunASR Hugging Face repositories, both model cards declare Apache-2.0. Pinned revisions, URLs and SHA256 are in SPEAKER_MODEL_MANIFEST.json; model cards are shipped with the weights. Only those two speaker models are included; no SenseVoice weights.
- FunASR: MIT; https://github.com/modelscope/FunASR . Spectral clustering is provided by its CAM++ clustering backend, derived from 3D-Speaker.
- CPython 3.11.17, distributed by Astral python-build-standalone: https://github.com/astral-sh/python-build-standalone/releases/tag/20261020 . Original runtime license files are retained.
- PyTorch, TorchAudio, NumPy, SciPy, scikit-learn and other Python dependencies retain their licenses and notices in runtime/python/lib/python3.11/site-packages, including distribution metadata and license directories. Pinned versions are in requirements-speech.txt. Runtime provenance and checksums are in PYTHON_RUNTIME_MANIFEST.json.
- Public CAM++ example WAVs are only downloaded for source tests with --test; they are not included in the user download package.

## Lightweight bootstrap in v0.3.0

The lightweight ZIP carries application code and a small pure-Python crcmod 1.7 wheel (MIT license retained in its metadata), avoiding a compiler requirement on clean Macs. It downloads only missing components from the pinned official Node, Astral Python, npm and model sources, and pinned Python requirements from PyPI. Download hashes are recorded in the runtime/model manifests. The full ZIP retains the runtime licenses and dependency notices described above.
