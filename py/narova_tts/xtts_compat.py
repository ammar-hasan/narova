"""Compatibility shims so XTTS (coqui-tts) runs on the NEWEST transformers,
instead of pinning an old version. Import this BEFORE `from TTS.api import TTS`.

transformers 5.x removed `isin_mps_friendly` from pytorch_utils; coqui-tts's
tortoise layer still imports it. It's a 4-line helper — we restore it.
"""
import torch as _t
import transformers.pytorch_utils as _pu

if not hasattr(_pu, "isin_mps_friendly"):
    def isin_mps_friendly(elements, test_elements):
        # mirrors the removed transformers helper, incl. scalar test_elements handling
        if elements.device.type == "mps":
            test_elements = _t.as_tensor(test_elements, device=elements.device)
            if test_elements.ndim == 0:
                test_elements = test_elements.unsqueeze(0)
            return elements.tile(test_elements.shape[0], 1).eq(test_elements.unsqueeze(1)).sum(dim=0).bool().squeeze()
        return _t.isin(elements, test_elements)
    _pu.isin_mps_friendly = isin_mps_friendly
    print("[compat] shimmed transformers.pytorch_utils.isin_mps_friendly")
