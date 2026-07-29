"""Registered external TTS provider manifests.

Narova only reads normalized manifests from ~/.narova/providers. It does not
scan installed skills or import provider code.
"""
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from typing import Any


PROVIDER_PROTOCOL = "narova-tts-provider/v1"
NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")
ENV_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def narova_home() -> Path:
    return Path(os.environ.get("NAROVA_HOME", Path.home() / ".narova")).resolve()


def providers_dir() -> Path:
    return narova_home() / "providers"


def _command_available(command: list[str]) -> bool:
    executable = command[0]
    if Path(executable).is_absolute():
        return Path(executable).is_file() and os.access(executable, os.X_OK)
    return shutil.which(executable) is not None


def validate_provider_manifest(value: Any) -> dict:
    if not isinstance(value, dict):
        raise ValueError("provider manifest must be a JSON object")
    name = value.get("name")
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise ValueError("provider.name is invalid")
    if value.get("protocol") != PROVIDER_PROTOCOL:
        raise ValueError(
            f"provider {name!r}: unsupported protocol {value.get('protocol')!r}; "
            f"expected {PROVIDER_PROTOCOL}")
    command = value.get("command")
    if (not isinstance(command, list) or not command
            or any(not isinstance(arg, str) or not arg or "\0" in arg for arg in command)):
        raise ValueError(f"provider {name!r}: command must be a non-empty argument array")
    if not _command_available(command):
        raise ValueError(f"provider {name!r}: executable or interpreter is unavailable")
    required = value.get("requiredEnvironment", [])
    if (not isinstance(required, list)
            or any(not isinstance(item, str) or not ENV_RE.fullmatch(item) for item in required)
            or len(set(required)) != len(required)):
        raise ValueError(f"provider {name!r}: requiredEnvironment is invalid")
    capabilities = value.get("capabilities", {})
    if (not isinstance(capabilities, dict)
            or any(not isinstance(item, bool) for item in capabilities.values())):
        raise ValueError(f"provider {name!r}: capabilities must contain boolean values")
    if capabilities.get("synthesis") is not True:
        raise ValueError(f"provider {name!r}: synthesis capability is required")
    version = value.get("providerVersion", "")
    if version and not isinstance(version, str):
        raise ValueError(f"provider {name!r}: providerVersion must be a string")
    return {
        "name": name,
        "displayName": value.get("displayName") or name,
        "protocol": PROVIDER_PROTOCOL,
        "command": list(command),
        "requiredEnvironment": list(required),
        "capabilities": dict(capabilities),
        "providerVersion": version,
    }


def load_provider(name: str) -> dict | None:
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        return None
    manifest_path = providers_dir() / f"{name}.json"
    if not manifest_path.is_file():
        return None
    try:
        manifest = validate_provider_manifest(json.loads(manifest_path.read_text()))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"registered provider {name!r} is invalid: {exc}") from exc
    if manifest["name"] != name:
        raise ValueError(f"registered provider filename/name mismatch for {name!r}")
    return manifest
