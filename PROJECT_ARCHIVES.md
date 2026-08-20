# Narova project archives

Narova project archives are portable, untrusted project source. Pack one with
`narova pack`, verify or materialize it with `narova open`, and start a fresh
lineage with `narova remix`.

```bash
narova pack --project ./my-video --output my-video.narova
narova open my-video.narova --inspect
narova open my-video.narova --dir ./my-video-copy
narova remix my-video.narova --dir ./my-remix
narova remix github:owner/repository#main --dir ./remote-remix
```

Opening and remixing never execute archived authoring code. They print a trust
notice because a later `check` or `build` may load executable project source
with the user's ambient authority. Inspection is the safe first step.

## Compatibility profile: `narova.project/1`

- Filename convention: `<title-or-directory>.narova`.
- Container: single-disk, non-ZIP64 ZIP with UTF-8 relative member names. The
  Narova writer uses stored (uncompressed) members; readers accept ZIP methods
  0 (store) and 8 (deflate). Encryption and non-regular Unix member types are
  rejected.
- Manifest: `narova.archive.json`, a UTF-8 JSON object whose `format` is
  `narova.project/1`. Unknown fields are ignored; unknown major versions are
  rejected.
- Manifest members: `members[]` lists every non-manifest member with `path`,
  `bytes`, lowercase SHA-256 `sha256`, and a non-empty semantic `role`. The
  manifest also records `packer.product`, `packer.version`, `source.title`, a
  source creative-identity digest, and `packedAt`.
- Stable source metadata: JSON configs record their resolved title and creative
  fingerprint. Executable configs record the project-directory name and a null
  creative fingerprint so runtime entropy or environment reads cannot change
  archive bytes. Statically declared executable-module and file dependencies
  must be project-local and included when packing. Readers preserve executable
  authoring bytes without evaluating or behaviorally filtering them; the trust
  notice is the boundary for a recipient's later explicit build.
- Project shape: exactly one of `reel.config.mjs`, `reel.config.js`,
  `reel.config.json`, or `reel.config.cjs` is present at archive root.
- Determinism: paths use ascending UTF-8 byte order; ZIP timestamps are the DOS
  representation of `1980-01-01T00:00:00.000Z`; file mode is `0644`; the writer
  always stores members. `packedAt` is that normalization instant rather than
  wall-clock pack time. Therefore identical source bytes packed by the same
  Narova version produce a byte-identical complete archive.
- Bounds: at most 10,000 project members plus the manifest, 128 MiB expanded
  bytes per member, 512 MiB expanded project bytes, an 8 MiB manifest, and
  546,539,648 local container bytes. Remix lineage counts within those project
  limits. A fetched repository archive is limited to 256 MiB compressed bytes
  and a 60-second request timeout; the commit-metadata response is limited to
  2 MiB.
- Remote grammar: exactly `github:<owner>/<repo>` or
  `github:<owner>/<repo>#<ref>`. Narova resolves the ref to a 40-hex commit over
  HTTPS before fetching the repository ZIP. No other remote scheme is defined.

Every declared size, CRC-32, and SHA-256 digest is verified before extraction.
Absolute paths, backslashes, empty or dot path components, traversal, links,
explicit directory entries, invalid UTF-8, path components over 255 bytes,
relative paths over 4,096 bytes, or cross-platform path aliases,
file/directory prefix conflicts, undeclared or hidden payload bytes, and
expansion beyond the bounds are rejected before project publication.
Inspection and extraction apply the same archive-content profile, including
tracked-asset closure. Extraction is staged and an occupied target is
preserved unless `--overwrite` is explicit.

Archives exclude output and cache directories, revision history, `.git`, local
environments, nested archives, credentials, secret-shaped files, and Narova
user-global state. Remix adds `.narova-remix.json` with an archive digest, a
local-project content identity, or a GitHub locator plus resolved commit. It
does not carry output history, releases, or proof branches into the new project.
Browser-loading HTML, SVG, and CSS references are canonicalized and recursively
close over project-local members; URL-base/refresh/nested-frame behavior and
remote dependencies are rejected.
