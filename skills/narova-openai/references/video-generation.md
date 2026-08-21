# OpenAI Sora video generation

The OpenAI companion registers Sora separately from its speech backend:

```bash
narova providers add <narova-openai-skill-dir>/tool/video-provider.json
narova providers doctor sora
narova generate "A paper boat crossing a stormy sea" --provider sora
```

Set `OPENAI_API_KEY` only in the Narova process environment. The worker accepts
`model` (`sora-2` or `sora-2-pro`), `size` (`720x1280`, `1280x720`,
`1024x1792`, or `1792x1024`), `duration` (4, 8, or 12 seconds), and
`requestTimeoutSeconds`. Defaults are `sora-2`, `1280x720`, 4 seconds, and a
300-second total wait.

The prompt is sent to OpenAI and generation may be billed. Narova does not
automatically retry a failed submission because the remote job may already
exist. The worker polls the submitted job, downloads the completed clip into
Narova's private stage path, and returns only protocol metadata; Narova owns
the final asset, generation recipe, registry entry, hashes, and rollback.

OpenAI currently marks the Sora Videos API deprecated and schedules it to shut
down on September 24, 2026. Confirm current API access, model availability,
pricing, retention, and policy before relying on it. Remove only the
registration with `narova providers remove sora`; that does not delete this
skill or existing project assets.
