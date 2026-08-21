"""CLI entry: `python -m narova_tts`. Node invokes this as the `synth` stage.

    python -m narova_tts \
        --narration out/narration.json \
        --config    reel.config.json \
        --out       out \
        --backend   piper \
        [--reuse]

Emits <out>/audio/NN.wav, <out>/audio/NN.mp3, <out>/timings.json, and prints a
one-line JSON summary to stdout.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .backends import BUILTIN_BACKENDS, ExternalProviderBackend
from .pipeline import run
from .providers import load_provider

# Well-known starter voices per backend, with a spread of genders/accents so a
# multi-host cast can sound distinct without the heavy backends. `list` stays
# lightweight (no model load, no network); XTTS ships 58 studio speakers built
# into the cached model.
KNOWN_VOICES = {
    "piper": [
        "en_US-ryan-high",           # male, energetic
        "en_US-hfc_female-medium",   # female
        "en_US-hfc_male-medium",     # male
        "en_US-amy-medium",          # female, warm
        "en_US-joe-medium",          # male, neutral
        "en_US-kristin-medium",      # female, conversational
        "en_US-lessac-medium",       # male, narrator
        "en_US-libritts_r-medium",   # male, audiobook
        "en_GB-alan-medium",         # male, British
    ],
    "xtts": ["Damien Black", "Sofia Hellen", "Craig Gutsy", "Alison Dietlinde"],
    # Qwen3-TTS CustomVoice presets (all 9): first five suit English well;
    # Dylan/Uncle_Fu are Chinese-flavored, Ono_Anna Japanese, Sohee Korean.
    "qwen": ["Ryan", "Serena", "Vivian", "Eric", "Aiden",
             "Dylan", "Uncle_Fu", "Ono_Anna", "Sohee"],
    # chatterbox has no preset voices — it clones from a recording.
    "chatterbox": [],
}


def _voices(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="narova_tts voices", description="list / get TTS voices")
    ap.add_argument("sub", nargs="?", default="list", choices=["list", "get"])
    ap.add_argument("name", nargs="?", help="voice to get (piper only)")
    ap.add_argument("--backend", default="piper",
                    help="built-in backend or explicitly registered external provider")
    args = ap.parse_args(argv)

    if args.sub == "list":
        if args.backend in BUILTIN_BACKENDS:
            for name in KNOWN_VOICES.get(args.backend, []):
                print(name)
            if args.backend == "xtts":
                print("… + 58 studio speakers built into the cached XTTS-v2 model", file=sys.stderr)
            elif args.backend == "qwen":
                print("… all 9 CustomVoice presets; voice cloning/design not wired into narova yet", file=sys.stderr)
            elif args.backend == "chatterbox":
                print("chatterbox has no preset voices — clone your own: set a voice's "
                      "`speaker` to an ABSOLUTE path to a clean 10–20s recording.", file=sys.stderr)
            else:
                print("… more at https://github.com/rhasspy/piper/blob/master/VOICES.md", file=sys.stderr)
            return 0
        provider = load_provider(args.backend)
        if provider is None:
            print(
                f"unknown backend or unregistered provider {args.backend!r} — "
                "register it with `narova providers add <manifest>`",
                file=sys.stderr,
            )
            return 2
        try:
            for voice in ExternalProviderBackend.list_voices(provider):
                print(f"{voice['id']}\t{voice['name']}")
        except (RuntimeError, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 1
        return 0

    # get
    if args.backend == "chatterbox":
        print("chatterbox has no downloadable preset voices — set `speaker` to an "
              "ABSOLUTE path to a clean 10–20s recording.", file=sys.stderr)
        return 2
    if args.backend not in BUILTIN_BACKENDS:
        if load_provider(args.backend) is None:
            print(
                f"unknown backend or unregistered provider {args.backend!r}",
                file=sys.stderr,
            )
        else:
            print(
                f"provider {args.backend!r} does not support `voices get`; "
                "provider voices are managed by that service",
                file=sys.stderr,
            )
        return 2
    if args.backend != "piper":
        print(f"{args.backend} speakers are built into the model — nothing to download", file=sys.stderr)
        return 0
    if not args.name:
        print("usage: voices get <name> --backend piper", file=sys.stderr)
        return 2
    import os
    from .backends import download_piper_voice
    # Same default as PiperBackend (honors NAROVA_PIPER_DIR); the shared
    # routine verifies received bytes against the declared content length.
    data_dir = Path(os.environ.get("NAROVA_PIPER_DIR", Path.home() / ".cache" / "narova" / "piper"))
    download_piper_voice(args.name, data_dir)
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "voices":
        return _voices(argv[1:])

    ap = argparse.ArgumentParser(prog="narova_tts", description="narova TTS + timing")
    ap.add_argument("--narration", required=True, type=Path, help="path to narration.json")
    ap.add_argument("--config", required=True, type=Path, help="path to config JSON (voices, timing)")
    ap.add_argument("--out", required=True, type=Path, help="output directory")
    ap.add_argument("--backend", default="piper",
                    help="default built-in backend or registered provider; per-voice config.backend overrides it")
    ap.add_argument("--reuse", action="store_true",
                    help="skip synth; rescale existing timings to existing audio")
    ns = ap.parse_args(argv)

    summary = run(ns.narration, ns.config, ns.out,
                  default_backend=ns.backend, reuse=ns.reuse)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
