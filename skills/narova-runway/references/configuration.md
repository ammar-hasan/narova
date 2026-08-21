# Runway video-generation configuration

Register the manifest, then select Runway explicitly:

```bash
narova providers add <narova-runway-skill-dir>/tool/provider.json
narova providers doctor runway
narova generate "A practical miniature city waking at sunrise" --provider runway
```

The worker maps Narova options to Runway's `POST /v1/text_to_video` task API:

| Option | Default | Mapping |
|---|---:|---|
| `model` | `gen4.5` | `model` |
| `size` | `1280x720` | converted to Runway `ratio` (`1280:720`) |
| `ratio` | unset | direct `ratio`; mutually exclusive with `size` |
| `duration` | `5` | generated seconds |
| `requestTimeoutSeconds` | `600` | total submit/poll/download wait |

The companion validates structural values; Runway remains authoritative for
model-specific ratios, durations, and availability. The prompt is limited to
1,000 characters to match the current text-to-video contract.

The worker sends one generation submission, polls that task, downloads its
first output URL to Narova's private stage, and returns protocol metadata. It
does not resubmit automatically. Narova then validates and commits the file,
generation recipe, hashes, and asset registry entry transactionally.

Set `RUNWAYML_API_SECRET` in the process environment. Prompts leave the machine
and generation may consume credits. Confirm current pricing, data terms, model
access, and output rights before use. To unregister without deleting the skill
or existing assets:

```bash
narova providers remove runway
```
