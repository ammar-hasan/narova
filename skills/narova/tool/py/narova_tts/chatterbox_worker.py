"""Chatterbox synthesis worker — runs INSIDE the isolated chatterbox venv.

narova's main venv cannot host Chatterbox (it hard-pins torch==2.6 /
transformers==5.2 / diffusers==0.29, which conflict with the xtts/qwen
backends). So `ChatterboxBackend` (in the main venv) launches this script with
the chatterbox venv's Python and talks to it over a line-delimited JSON
protocol on stdio:

    stdin  <- one request per line: {"text","out","ref","exaggeration"?,"cfg_weight"?,"lang"?}
    stdout -> one reply per line:   {"ready":true} once, then {"ok":true} | {"ok":false,"error":...}

The English model is loaded ONCE at startup and reused for every request. A
request carrying `lang` (e.g. "fr", "zh") is synthesized with the Multilingual
model instead — loaded lazily on first use, v3 checkpoint by default
($NAROVA_CHATTERBOX_T3_MODEL overrides; v3 = June 2026 release: better speaker
similarity, fewer hallucinations, 23+ languages). All Chatterbox output is
PerTh-watermarked by the library itself. All library chatter (model download,
sampling progress) is redirected to stderr so stdout carries only protocol
JSON; the parent inherits stderr, so the user still sees progress exactly like
the other backends.

Run standalone (no narova_tts import needed): the parent passes this file's
absolute path to the chatterbox venv python, which has only chatterbox on it.
"""
import json
import os
import sys

# Unsupported MPS ops fall back to CPU (Apple Silicon).
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

# Split the protocol channel from log noise: dup the real stdout for JSON
# replies, then point fd 1 at fd 2 so every library print goes to stderr.
_proto = os.fdopen(os.dup(1), "w", buffering=1)
os.dup2(2, 1)
sys.stdout = sys.stderr  # any Python `print` also lands on stderr


def _pick_device(torch) -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        # MPS hits "Output channels > 65536 not supported" in conv1d ops
        # used by both ChatterboxTTS and the multilingual model — force CPU.
        print("[chatterbox] mps detected but known-broken — using cpu", flush=True)
        return "cpu"
    return "cpu"


def _reply(obj: dict) -> None:
    _proto.write(json.dumps(obj) + "\n")
    _proto.flush()


def _load_multilingual(device: str):
    """Chatterbox Multilingual, v3 checkpoint by default. Loaded lazily on the
    first request that carries a `lang`, so an all-English build never pays
    the second model load. Falls back to the installed package's default (v2)
    checkpoint when the package predates the t3_model kwarg (PyPI 0.1.7) —
    v3-capable chatterbox is currently git-only, see requirements-chatterbox.txt."""
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    t3 = os.environ.get("NAROVA_CHATTERBOX_T3_MODEL", "v3")
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model=t3)
        print(f"[chatterbox] multilingual ready (t3={t3})", flush=True)
    except TypeError:
        print("[chatterbox] installed chatterbox has no t3_model (v3) support — "
              "using its default multilingual checkpoint (v2). For v3, reinstall "
              "with: bash <skill>/tool/setup.sh --chatterbox", flush=True)
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    return model


def main() -> int:
    import torch
    import torchaudio as ta
    from chatterbox.tts import ChatterboxTTS

    device = _pick_device(torch)
    print(f"[chatterbox] loading model on {device} …", flush=True)
    model = ChatterboxTTS.from_pretrained(device=device)
    mtl = None  # multilingual (v3) model — lazy, only if a request asks for a lang
    print("[chatterbox] ready", flush=True)
    _reply({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            kw = {}
            ref = req.get("ref")
            if ref:
                kw["audio_prompt_path"] = ref
            if req.get("exaggeration") is not None:
                kw["exaggeration"] = float(req["exaggeration"])
            if req.get("cfg_weight") is not None:
                kw["cfg_weight"] = float(req["cfg_weight"])
            lang = req.get("lang")
            if lang:
                if mtl is None:
                    mtl = _load_multilingual(device)
                wav = mtl.generate(req["text"], language_id=lang, **kw)
                ta.save(req["out"], wav, mtl.sr)
            else:
                wav = model.generate(req["text"], **kw)
                ta.save(req["out"], wav, model.sr)
            _reply({"ok": True, "out": req["out"]})
        except Exception as e:  # keep the worker alive; report per-request
            _reply({"ok": False, "error": f"{type(e).__name__}: {e}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
