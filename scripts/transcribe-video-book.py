"""Read a local movie with the existing, cached Whisper model. No downloads."""
import json, os, sys
from pathlib import Path
import torch
import whisper

source, model_path, target = sys.argv[1:4]
if not Path(model_path).is_file():
    raise RuntimeError("Local Whisper model is missing")
torch.set_num_threads(min(4, os.cpu_count() or 1))
model = whisper.load_model(model_path, device="cpu")
result = model.transcribe(source, fp16=False, verbose=False, condition_on_previous_text=False)
segments = [{"start":round(s["start"],3), "end":round(s["end"],3), "text":s["text"].strip()}
            for s in result.get("segments", []) if s.get("text", "").strip() and s.get("no_speech_prob", 0)<.8]
Path(target).write_text(json.dumps({"text":"\n".join(s["text"] for s in segments), "segments":segments},ensure_ascii=False))
