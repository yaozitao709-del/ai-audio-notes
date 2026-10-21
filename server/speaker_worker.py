#!/usr/bin/env python3
"""Local, persistent FSMN-VAD/CAM++ worker. No ASR model is loaded here."""
import contextlib
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('MKL_NUM_THREADS', '2')

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio.compliance.kaldi as kaldi
    from speaker_clustering import cluster_speakers
    from funasr import AutoModel
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    root = Path(os.environ.get('SPEAKER_MODEL_ROOT', str(Path(__file__).resolve().parent.parent / 'models/speakers')))
    vad_dir = root / 'speech_fsmn_vad_zh-cn-16k-common-pytorch'
    cam_dir = root / 'speech_campplus_sv_zh-cn_16k-common'
    for filename in [vad_dir / 'model.pt', cam_dir / 'campplus_cn_common.bin']:
        if not filename.is_file():
            raise FileNotFoundError('讲话人模型未安装：' + str(filename))
    vad = AutoModel(model=str(vad_dir), device='cpu', ncpu=2, disable_update=True, disable_pbar=True)
    cam_device = 'mps' if os.environ.get('SPEAKER_DEVICE','auto') != 'cpu' and torch.backends.mps.is_available() else 'cpu'
    cam = AutoModel(model=str(cam_dir), device='cpu', ncpu=2, disable_update=True, disable_pbar=True).model.eval().to(cam_device)

def diarize(filename, speaker_count, progress):
    global cam_device
    started = time.monotonic()
    audio, rate = sf.read(filename, dtype='float32')
    if rate != 16000 or audio.ndim != 1:
        raise ValueError('分人音频须为16kHz单声道')
    if speaker_count is not None and (type(speaker_count) is not int or not 1 <= speaker_count <= 8):
        raise ValueError('讲话人数须为1到8，或自动识别')
    duration = len(audio) / rate
    regions = []
    with torch.inference_mode():
        for start in range(0, len(audio), rate * 60):
            part = audio[start:start + rate * 60]
            result = vad.generate(input=part, fs=rate, disable_pbar=True, max_end_silence_time=250)
            for left, right in result[0].get('value', []):
                a = max(0., start / rate + left / 1000 - .08)
                b = min(duration, start / rate + right / 1000 + .08)
                if b - a >= .15:
                    if regions and a <= regions[-1][1]:
                        regions[-1][1] = max(b, regions[-1][1])
                    else:
                        regions.append([a, b])
            progress('vad', min(duration, (start + len(part)) / rate), duration)
        windows = []
        for region, (a, b) in enumerate(regions):
            starts = np.arange(a, max(a + .001, b - 1.5), .75).tolist()
            tail = max(a, b - 1.5)
            if not starts or tail - starts[-1] > .15:
                starts.append(tail)
            for left in starts:
                right = min(b, left + 1.5)
                windows.append((left, right, region))
        vectors = []
        for start in range(0, len(windows), 32):
            features = []
            for a, b, _ in windows[start:start + 32]:
                part = audio[round(a * rate):round(b * rate)]
                if len(part) < 24000:
                    part = np.pad(part, (0, 24000 - len(part)), mode='wrap' if len(part) else 'constant')
                waveform = torch.from_numpy(part.copy()).unsqueeze(0)
                feat = kaldi.fbank(waveform, num_mel_bins=80, sample_frequency=rate, dither=0)
                features.append(feat - feat.mean(dim=0, keepdim=True))
            # Padding is at most one frame due to rounding audio boundaries.
            frames = min(f.shape[0] for f in features)
            batch = torch.stack([f[:frames] for f in features])
            try:
                embeddings = cam(batch.to(cam_device)).cpu().numpy()
            except RuntimeError:
                if cam_device != 'mps':
                    raise
                # Unsupported/low-memory MPS operation falls back without discarding audio.
                cam_device = 'cpu'
                cam.to('cpu')
                torch.mps.empty_cache()
                embeddings = cam(batch).cpu().numpy()
            vectors.append(embeddings)
            progress('embedding', min(len(windows), start + 32), len(windows))
    if not windows:
        return {'turns': [], 'duration': duration, 'speakerCount': 0, 'elapsedSeconds': time.monotonic() - started}
    vectors = np.concatenate(vectors)
    vectors /= np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-10)
    if os.environ.get('SPEAKER_DEBUG_FILE'):
        np.savez_compressed(os.environ['SPEAKER_DEBUG_FILE'], vectors=vectors, windows=np.array(windows), regions=np.array(regions))
    labels = cluster_speakers(vectors, speaker_count)
    turns = []
    mapping = {}
    for region, (a, b) in enumerate(regions):
        indexes = [i for i, window in enumerate(windows) if window[2] == region]
        centers = [(windows[i][0] + windows[i][1]) / 2 for i in indexes]
        for j, index in enumerate(indexes):
            label = int(labels[index])
            mapping.setdefault(label, len(mapping))
            left = a if j == 0 else (centers[j - 1] + centers[j]) / 2
            right = b if j + 1 == len(indexes) else (centers[j] + centers[j + 1]) / 2
            if turns and turns[-1]['spk'] == mapping[label] and left - turns[-1]['end'] <= .35:
                turns[-1]['end'] = right
            else:
                turns.append({'start': left, 'end': right, 'spk': mapping[label]})
    progress('complete', 1, 1)
    return {'turns': turns, 'duration': duration, 'speakerCount': len(mapping),
            'models': ['FSMN-VAD', 'CAM++'], 'embeddingDevice': cam_device, 'elapsedSeconds': time.monotonic() - started}

emit({'ready': True, 'models': ['FSMN-VAD', 'CAM++'], 'embeddingDevice': cam_device})
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        ident = request['id']
        def progress(stage, completed, total):
            emit({'id': ident, 'progress': {'stage': stage, 'completed': completed, 'total': total}})
        with contextlib.redirect_stdout(sys.stderr):
            if request['method'] == 'health':
                result = {'status': 'ready', 'models': ['FSMN-VAD', 'CAM++'], 'embeddingDevice': cam_device}
            elif request['method'] == 'diarize':
                # progress uses the original stdout despite library redirection.
                def progress(stage, completed, total):
                    sys.__stdout__.write(json.dumps({'id': ident, 'progress': {'stage': stage, 'completed': completed, 'total': total}}) + '\n')
                    sys.__stdout__.flush()
                result = diarize(request['payload']['audioPath'], request['payload'].get('speakerCount'), progress)
            else:
                raise ValueError('未知分人请求')
        emit({'id': ident, 'result': result})
    except Exception as error:
        emit({'id': request.get('id') if isinstance(request, dict) else None, 'error': str(error)})
