# Changelog

## v0.2.0 — 2026-10-21

- Restore independent FSMN-VAD/CAM++ speaker diarization while retaining Paraformer transcription.
- Fix clustering that merged normal voices when rare outliers consumed a speaker group; use bounded deterministic spectral clustering for longer recordings.
- Apply the same speaker pipeline to imports, recording finalization and explicit reprocessing; preserve backups and speaker/timestamp exports.
- Use Apple Silicon MPS acceleration with CPU fallback.
- Include a relocatable Python runtime and the two lightweight speaker models in the Mac package. No personal data or SenseVoice weights.

Existing notes are not reprocessed automatically. Close the old app before starting the new version; keep the existing Application Support data folder.
