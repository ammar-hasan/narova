# Narova vision, need, and product direction

**Research date:** 2026-07-26  
**Evidence window:** 2026-05-01 through 2026-07-26

This document deliberately excludes research published before May 2026. Live
product pages without a publication date are identified as current pages
accessed on 2026-07-26.

## Executive verdict

There is a real and growing need, but Narova does not yet have proven
product-user fit.

The need is broader than generating a first video:

- more people and teams are expected to produce video;
- budgets and production capacity are not keeping pace;
- agent-native prompt, URL, document, and repository-to-video creation is
  rapidly becoming a baseline capability;
- the unresolved cost moves downstream into revisions, brand control,
  approvals, variants, localization, finding what was published, and keeping
  videos synchronized with changing source material.

Narova should therefore not define itself as another AI video generator or only
as "video as code." Both categories are already crowded.

### Vision

> **Give every person and every intelligence the creative power to make
> remarkable video—regardless of expertise, budget, hardware, or model
> sophistication.**

### Mission

> **Build an open and efficient creative system that lets a person or a simple
> LLM turn intent into exceptional video, then direct, evolve, organize, and
> reuse that work without production friction.**

### Product thesis

> **The quality should come from Narova's creative system, not from requiring
> an expensive model or an expert video operator.**

Generation, changeability, maintenance, management, provenance, and
distribution are functions of this vision. They are necessary because
universal creative power is hollow if the result is expensive, disposable,
hard to direct, or impossible to operate later. They are not the vision
itself.

Experience is equally foundational. Narova cannot transfer creative capability
through an interaction that assumes every person understands composition,
pacing, typography, shot language, audio mixing, rendering, or model
configuration. It must preserve the same creative ceiling while changing how
it communicates and how much machinery it exposes.

"Everyone can do wonders" is the long-term vision. It does not imply that the
first UX and every example must address every person at once. The initial
research cohort should be people whose source material changes often and who
already work with repositories, documents, URLs, and AI agents. That gives
Narova a repeated problem on which to prove the larger vision.

## What Narova already has

Narova 0.7 is not a concept. It is a working local compiler with:

- prompt, script, README, repository, and URL-to-video workflows;
- local multi-speaker TTS and voice cloning;
- word-timed captions and speech-triggered visuals;
- source and claims ledgers;
- platform-specific outputs and caption sidecars;
- music, sound effects, B-roll, transitions, annotations, series, and hook
  variants;
- deterministic HyperFrames rendering;
- visual-only rebuilds and sentence-level audio reuse, so unchanged narration
  can remain byte-identical;
- validation, preview, snapshot QA, and render commands.

That is a strong production engine. Two layers remain underdeveloped:

1. **Creative amplification:** encode enough story, art-direction, pacing,
   motion, audio, composition, and critique intelligence that a modest LLM and
   an inexperienced person can reliably produce something exceptional.
2. **Creative operations:** retain a durable model of the resulting work over
   its lifetime: dependencies, impact analysis, versions, releases, approvals,
   asset governance, localization families, publishing destinations, and
   source freshness.

The first fulfills the vision. The second ensures the vision survives contact
with real repeated use.

## What the May–July 2026 evidence says

### 1. Demand and activity are real

The IAB projects more than **$80 billion in U.S. digital video advertising
spend in 2026**, up 11%, with digital video exceeding 60% of total TV/video ad
spend. It also reports that two in three buyers are already using, testing, or
planning agentic AI for digital video in 2026, with another 28% investigating
it. This does not count Narova's potential users, but it confirms that video
and agentic workflows are becoming operational rather than experimental.

Pictory reported analysis of **more than 1.5 million videos created during the
first half of 2026**. Its most relevant findings for Narova are that
professionals are driving usage, professional users use URL-to-video nine
times as often as personal users, and training and education users use
PowerPoint-to-video four times as often as YouTube creators.

Grand View Research's industry estimate values the **2026 creator economy at
$310.37 billion**. This includes far more than creation software, so it is
context for the scale of the economic ecosystem, not a count of Narova users.

### 2. The constraint is doing more with limited production capacity

EMARKETER's May 2026 summary of current B2B video research reports:

- 51% of respondents have flat or declining video budgets;
- 66% cite company size and resources as a barrier to producing more video;
- 44% cite cost;
- 57% spend more time creating content than marketing it.

That is direct support for a low-cost, low-friction production system. It also
means "cheaper generation" alone is insufficient: the whole production and
maintenance loop must consume less human time.

### 3. Creation is becoming table stakes; operations are the new bottleneck

HeyGen's June 2026 enterprise survey says 78% of organizations feel pressure to
produce more video. More importantly:

- 67% say distributed teams cannot reliably produce on-brand video without
  central support;
- 84% say pre-publication review is important, yet 37% publish without formal
  review at least sometimes;
- 53% of leaders cannot account for what their organization published in the
  prior 90 days;
- 47% cannot confirm that video spend delivers measurable value;
- 60% have not achieved full organization-wide deployment.

This is vendor research and should be validated independently, but it closely
matches the product gap: management, governance, visibility, and lifecycle
control after the first generation.

### 4. Changeability is now an explicit competitive battleground

Runway's May 2026 Aleph 2.0 launch identifies a central failure of generative
editing: models often alter cuts, objects, or action beyond the requested
change. Its product promise is targeted edits that preserve the rest of the
input and reduce wasted generations.

Synthesia's current versioning system creates a version on each generation,
allows restoration, and lets a published version replace an older one without
changing existing share, embed, or SCORM links. Its May 2026 localization
documentation also exposes an unsolved maintenance cost: after a root video
changes, each translated video must be regenerated and republished.

Two June/July 2026 vendor guides independently describe the same operational
pattern for SOP and knowledge videos: treat a document as the source of truth,
identify the affected scenes, regenerate only those sections, review the
result, keep version history, update variants, and preserve a stable publishing
destination. These are not neutral market studies, but they demonstrate that
vendors are now building around the exact maintenance problem Narova is
positioned to solve.

### 5. Local and hybrid execution has strategic value

A July 2026 industry perspective argues that iterative creative production
creates cloud cost pressure and that local or private execution improves cost
predictability, IP control, customization, and data governance. As an opinion
from the CEO of a local video company, it is directional rather than neutral
proof. It nevertheless supports Narova's open, local-first architecture and a
hybrid future in which expensive cloud models remain optional adapters.

## The competitive reality

Current product pages and releases show that Narova is entering a fast-moving
market.

| Product/category | Current strength | Implication for Narova |
|---|---|---|
| HeyGen + HyperFrames | Agent skills, CLI, MCP, prompt/website/PR-to-video, deterministic HTML rendering, tested components, timeline editor, cloud rendering, avatars, localization, publishing | "An agent can make video" and "video as code" are no longer differentiators. Narova must deliver more creative leverage from simpler models, at lower cost, while preserving openness, ownership, and precise control. |
| Poko Motion | Repository/URL/PDF/PPT input, brand extraction, live preview, chat editing, local rendering, project canvas, parallel agents | Poko is the closest workflow competitor. A GUI, local rendering, and source-to-video are also not enough by themselves. |
| Remotion | Mature React renderer, broad ecosystem, programmable and personalized video | Narova should not compete as a lower-level renderer. It should remain renderer-adaptable and own the creative and project intelligence above rendering. |
| Pictory | Professional source repurposing, URL/PDF/PPT workflows, brand kits, avatars, voice cloning, project management | Source-to-video has validated demand, but its surface is increasingly commoditized. |
| Synthesia | Enterprise version history, collaboration identity, stable publishing links, localization, SCORM | Versions, publishing aliases, translation families, and auditability are expected lifecycle features. |
| Runway | High-end generative footage plus localized edits that preserve unrequested content | Precise change is a value users understand. Narova can apply the same promise to an entire structured video, not only pixels in a short clip. |
| JSON2Video and similar APIs | Accessible programmable rendering at substantial output volume | Rendering itself is becoming a commodity. The unresolved work is creative intelligence, direction, reliability, management, and time saved. |

### Table stakes by July 2026

- prompt, URL, document, deck, or repository to video;
- agent, CLI, MCP, and API entry points;
- captions, voice, brand extraction, and multi-format output;
- chat-based edits and visual preview;
- reusable components or templates;
- local or cloud rendering;
- project organization and basic versions.

### The strategic product bet

Narova's opening is the combination of three systems, not one lifecycle
feature:

1. **A creative intelligence substrate.** Narova encodes production knowledge
   in planning stages, visual grammars, components, pacing systems, direction
   controls, examples, evaluation, and repair loops. A simple LLM supplies
   intent and judgment; it should not need to invent a production pipeline or
   hand-author every animation.
2. **A living creative project.** Facts, source passages, script turns, scenes,
   assets, voices, translations, variants, outputs, and destinations remain
   connected. Narova can detect a change, explain its impact, preserve approved
   work, rebuild the smallest safe set, and keep derivatives synchronized.
3. **An open, economical runtime.** Local execution is the default, paid media
   models are optional, files remain owned by the user, and models and
   renderers can be replaced as the market changes.

Narova already has early pieces of all three: skill-level creative guidance,
source and claim ledgers, deterministic rendering, `--reuse`, stable scene IDs,
local speech, and the sentence cache. The opportunity is to turn them into a
coherent system that raises the creative floor without lowering the ceiling.

## Who needs Narova

"Everyone" becomes actionable when segmented by repeated job, urgency, and the
gap between what people want to express and what they can currently produce.

| Segment | Repeated job | Pain/frequency | Current Narova fit | Research priority |
|---|---|---:|---:|---:|
| Developer relations, product marketing, open-source maintainers, technical founders | Turn releases, repositories, docs, and product pages into launch, demo, and education videos; update them when the product changes | High | Very high | **First research cohort** |
| L&D, SOP, compliance, customer education | Keep authoritative training and process videos synchronized with changing policies, interfaces, and documents | Very high | Medium | **Next research cohort** |
| Agencies and in-house content operations | Produce many on-brand variants, manage revisions and approvals, reuse assets across clients and campaigns | High | Medium | **Next research cohort** |
| Educators, researchers, and publishers | Convert papers, lessons, articles, and briefings into sourced explainers and series | Medium–high | High | Community learning |
| Independent creators, freelancers, and small businesses | Make polished video without production expertise or per-generation anxiety | Medium | High for CLI users, low for nontechnical users | Universal UX after simplification |
| Regulated and IP-sensitive organizations | Generate locally, retain evidence and audit history, avoid uploading proprietary material | High but deployment-heavy | Architecturally high, operationally low | Later systems research |
| Developers embedding video in products | Add headless, repeatable video generation and updates through an SDK/API/CI pipeline | High at scale | Medium | Later integration research |
| Filmmakers seeking frontier cinematic footage | Generate or edit photorealistic scenes | High creative standards | Low | Not an initial research priority |

## Recommended first research cohort

### Initial ideal user profile

A technical content team of 1–10 people at a software company, developer-tool
company, open-source project, or technical agency that:

- ships product or documentation changes at least monthly;
- publishes launch, explainer, changelog, demo, or education videos;
- already uses a coding agent;
- has source material in repositories, URLs, Markdown, documentation, or
  issue/PR systems;
- finds ordinary video tools slow to revise and difficult to keep current;
- cares more about clarity, speed, evidence, and repeatability than avatars or
  cinema-grade footage.

**Likely first user:** developer advocate, technical marketer, content
engineer, founder, or design engineer.  
**Trigger:** launch, release, pull request, docs refresh, product-plan change,
rebrand, event, or recurring series.

This wedge is better for initial distribution than "all creators" because
Narova's current CLI, skill,
Git compatibility, URL ingestion, source ledger, and deterministic compilation
are native to how these users already work. It is a proving ground, not a
limit on the product. The same creative system can later expand into training,
compliance, agencies, education, entertainment, personal expression, and
mass-market creation.

## Product-user-fit hypothesis

> For technical content teams that repeatedly turn changing software and
> documentation into video, Narova is an open creative system that lets even a
> lightweight LLM produce distinctive, production-ready work and lets the team
> keep directing, changing, and multiplying it over time. Unlike timeline-first
> editors, prompt-only generators, or cloud render APIs, Narova supplies the
> creative and operational intelligence around the models, runs local-first,
> preserves ownership, and does not recreate unaffected work.

### Core jobs to be done

1. **Create:** "Turn this source into a strong video without making me learn
   video production."
2. **Direct:** "Let me make a precise change in ordinary language without
   disturbing everything I approved."
3. **Maintain:** "Tell me which videos became stale when the source changed,
   and safely update them."
4. **Manage:** "Show me what exists, who changed it, what is approved, what it
   cost, and where it is published."
5. **Multiply:** "Create platform, audience, language, brand, and campaign
   variants from one controlled source."
6. **Trust:** "Prove the claims, preserve my assets, run locally when needed,
   and produce the same result from the same inputs."

### Product promise

The product promise should be measurable across both creation and continued
operation:

- a user without video-production expertise can create and revise a complete
  video through intent rather than timeline mechanics;
- a defined lightweight reference LLM can produce a video that passes Narova's
  creative and technical quality gates without hand-authored scene code;
- first useful preview from a supported source in under 10 minutes on a
  supported machine;
- the local base path requires no paid generation API;
- creative direction remains adjustable rather than collapsing into a fixed
  template;
- visual-only revisions do not invoke TTS;
- unchanged narration is not synthesized again;
- every planned rebuild explains affected and unaffected artifacts first;
- every release records source, configuration, model/provider, asset, and
  output hashes;
- base local creation has zero marginal third-party generation cost after
  dependencies and models are installed;
- optional paid adapters expose an estimated and actual cost before and after
  each build;
- one approved source change can update all selected formats and languages
  without recreating unrelated work.

## How large is the need?

The available post-April-2026 evidence can establish scale and breadth, but it
cannot honestly produce an exact count of people who need Narova.

### Scale indicators

- **$80B+**: projected U.S. digital video advertising spend in 2026. This
  establishes the economic importance of video communication; it does not
  quantify Narova's potential users.
- **$310.37B**: commercial estimate of the global creator economy in 2026.
  This includes advertising, commerce, services, subscriptions, and creator
  income. It demonstrates the size of the surrounding creative ecosystem, not
  a Narova TAM.
- **1.5M+ videos in H1 2026 on one AI video platform**: direct evidence that
  assisted creation is already being used at meaningful volume.
- **78% of surveyed organizations feel pressure to produce more video**:
  evidence that the need is not confined to dedicated creators.
- **51% report flat or declining video budgets while 66% cite limited
  resources**: evidence that accessibility and production efficiency are core
  to the need.

### Breadth of need

The need exists wherever there is a gap between an idea and the person's
ability to express it through video:

- people who have something to teach, explain, launch, report, sell, document,
  entertain with, or preserve;
- professionals whose primary job is not video but whose work increasingly
  requires it;
- creators who can already make video but cannot economically produce the
  volume, variation, or quality they imagine;
- teams whose video becomes difficult to coordinate, update, localize, verify,
  and reuse;
- agents and applications that can reason about communication but lack a
  complete creative production system.

This makes the potential need universal in the same sense that presentation,
document, image, or website creation is broadly useful. It does **not** mean
every person has the same urgency or should be approached through the same
workflow.

### Immediate observable need

The strongest near-term evidence is among:

1. professionals already producing recurring product, educational, social,
   training, and communication video;
2. non-video professionals now expected to create it;
3. teams repurposing frequently changing documents, URLs, decks, and software;
4. creators constrained by production cost, time, tooling expertise, or
   repetitive manual work;
5. organizations that cannot safely use cloud-only systems or cannot keep
   generated work governed and current.

The right next step is to measure how often the problem occurs, what people
fail to create today, how far current output falls short of their intent, and
whether Narova closes that capability gap.

## Open-source enablement and UX

Narova is MIT-licensed open-source software. That is not merely a distribution
choice. It determines how the product should work:

- no account should be required for the core experience;
- the useful local path must not be a crippled demonstration;
- projects and assets must remain inspectable, portable, and user-owned;
- models, renderers, voices, and media providers must be replaceable;
- the community must be able to improve the creative system itself, not only
  submit bug fixes;
- documentation, examples, schemas, quality tests, and extension contracts are
  part of the product.

### The enablement objective

The unit of success is **capability transferred**:

> What can this person or agent express with Narova that they could not express
> before, at their available level of skill, compute, time, and model
> intelligence?

This shifts attention away from feature count. A capability is not truly
enabled when it exists in the CLI but requires the user to understand TTS
engines, render architecture, scene code, asset pipelines, timing math, and
environment repair.

### UX principles

1. **Intent first.** Begin with what the user wants to communicate or make,
   not with a configuration file.
2. **Recommend before exposing controls.** Narova should propose a creative
   direction and explain it briefly; deeper choices appear only when useful.
3. **Fast path to something visible.** Produce a low-cost storyboard or
   animatic before expensive synthesis and final rendering.
4. **Direct, do not operate.** Users express changes in language and visual
   references; Narova converts them into bounded, inspectable edits.
5. **Progressive disclosure.** A beginner sees idea, direction, preview,
   change, and export. An expert can inspect and edit every source file,
   manifest, component, and build decision.
6. **Simple-model first.** The golden path is tested against a modest reference
   LLM. Frontier models may improve results but must not be required to make
   the system coherent.
7. **Local by default, providers optional.** Narova discovers available
   capabilities, recommends a viable path, and states when an optional service
   would materially improve the result.
8. **No creative dead ends.** Every generated result remains editable,
   composable, reusable, and exportable. The user never receives only an opaque
   MP4.
9. **Explain without burden.** Plans, sources, affected artifacts, and costs
   are available for trust, but ordinary users are not forced to manage them.
10. **Accessible output and interface.** Captions, contrast, safe areas,
    reduced-motion previews, keyboard operation, transcripts, and alt
    descriptions should be defaults rather than specialist modes.

### Adaptive experience model

Narova should not have one "simple mode" and one "advanced mode." It should
adapt continuously to the person, the task, and the moment.

Three distinctions matter:

- **Fluency is not ambition.** A first-time user may want an artistically
  ambitious result; Narova should not reduce the quality or creative range
  because the person lacks vocabulary.
- **Technical fluency is not video fluency.** A developer may understand
  schemas and automation while knowing little about pacing or composition. A
  filmmaker may be the reverse.
- **A mode is not an identity.** The same person may want Narova to take over
  on a quick social post and want detailed control on a flagship film.

The experience profile is therefore task-scoped and revisable, not a permanent
label attached to a person.

#### What Narova adapts to

- familiarity with video and motion-design language;
- familiarity with technical tools and structured configuration;
- clarity of intent;
- desired amount of creative control;
- desire to learn versus desire to finish quickly;
- consequence of the output: casual experiment, public campaign, training,
  research, or sensitive communication;
- whether the work is new, repeated, or derived from an existing project;
- signals in the person's language, edits, accepted recommendations, and
  requested detail.

#### Interaction levels

| Experience | Likely signals | Narova's behavior | What Narova avoids |
|---|---|---|---|
| **Guided** | Vague outcome language; little video vocabulary; wants a result quickly | Chooses a strong direction, explains it in ordinary language, asks only consequential questions, shows visual alternatives, and offers simple changes such as "calmer," "faster," or "more playful" | Codec, TTS, easing, keyframe, safe-zone, alignment, renderer, or schema terminology; long option lists |
| **Collaborative** | Can discuss audience, pacing, format, examples, brand, or scenes; wants meaningful input | Shares a concise creative plan, presents a few genuine trade-offs, exposes scene-level direction, and explains why choices affect the result | Unnecessary implementation detail or pretending there is only one good direction |
| **Director** | Uses production language precisely; supplies references and constraints; asks for exact control | Accepts detailed direction for composition, motion, timing, typography, audio, transitions, assets, continuity, and preservation; exposes measurements and lets the person override recommendations | Simplifying away requested control, repeating basic explanations, or silently changing specified decisions |
| **Automation** | Another agent, script, CI workflow, or application is operating Narova | Uses structured contracts, declared capabilities, deterministic plans, machine-readable errors, idempotent actions, and explicit assumptions | Conversational ceremony, ambiguous choices, or hidden state |

These levels change the interaction, not the quality target or the underlying
project.

#### Adaptation rules

1. **Begin outcome-first.** Start with the lowest vocabulary burden that can
   preserve the person's intent.
2. **Infer gently.** Use the person's wording, provided references, project
   history, and requested controls. Do not begin with a proficiency
   questionnaire.
3. **Calibrate only when useful.** If desired involvement is genuinely unclear,
   ask one concrete question such as: "I can take the creative lead and show
   you a direction, or we can shape the scenes together—which would you
   prefer?"
4. **Let the person override immediately.** Every surface should offer a clear
   way to ask for more control, less detail, or a different explanation.
5. **Reveal controls in context.** Show pacing controls while discussing
   pacing, audio controls while reviewing sound, and source details while
   validating claims—not one permanent wall of settings.
6. **Translate both ways.** "Make it hit harder" can become tighter cuts,
   larger contrast shifts, stronger beat synchronization, and more emphatic
   captions. An expert can inspect or change that translation.
7. **Explain at the chosen depth.** The same decision can be expressed as
   "this will feel calmer," "we'll hold each beat longer," or exact scene and
   easing values.
8. **Remember locally and transparently.** Reusable preferences may be stored
   in the open project or local profile, with visible scope and an easy reset.
9. **Never punish exploration.** A person can enter the director view, inspect
   details, and return to guided creation without breaking the project.
10. **Adapt the recovery experience.** A guided user receives one recommended
    fix; an expert or agent can inspect the full cause, affected artifacts,
    logs, and alternatives.

#### Example: the same creative decision

Suppose the opening is too slow.

- **Guided:** "The opening takes too long to reach the point. I'll make the
  first line immediate and bring the main visual in sooner."
- **Collaborative:** "The hook currently lands at 2.4 seconds. I recommend
  opening on the result, shortening the setup, and moving the product reveal
  into the first beat. Want the punchier or more explanatory version?"
- **Director:** "Move the reveal from turn 1 to turn 0, trim the establishing
  hold to 180 ms, use a 6-frame scale entrance, and preserve the existing
  caption rhythm and audio bed."
- **Automation:** Narova returns a structured impact plan containing the
  affected scene, timing delta, protected elements, rebuild set, and validation
  checks.

#### Interface architecture

The local Studio should offer progressively deeper views over the same project:

1. **Create:** intent, references, Narova's recommendation, storyboard, and a
   few outcome-level adjustments.
2. **Direct:** story beats, scenes, pacing, visual language, voice, audio,
   variants, and bounded natural-language edits.
3. **Inspect:** exact timing, assets, sources, manifests, dependency graph,
   build plan, QA, and code.

The view may adapt automatically, but the person can always choose another.
There is no destructive conversion between them.

### One coherent user journey

1. **Express:** "Make a 45-second explanation of this idea," optionally with a
   URL, repository, document, assets, or reference video.
2. **Align:** Narova returns a concise creative recommendation: audience,
   story, voice, visual direction, duration, and why.
3. **See:** a fast storyboard/animatic makes the direction concrete.
4. **Direct:** the user says what feels wrong or points at the relevant scene;
   Narova previews the bounded change.
5. **Finish:** Narova performs voice, timing, captions, audio, QA, and render
   with the best available local stack.
6. **Keep:** the complete editable project joins a local library where it can
   be revised, repurposed, translated, organized, or handed to another agent.

### Product surfaces

- **Skill:** the agent-facing creative director and operating knowledge.
- **CLI:** the precise, scriptable interface and automation foundation.
- **Local Studio:** the primary visual UX for people who should never need to
  read scene code.
- **Open project format:** the durable handoff between people, agents, versions,
  and tools.
- **SDK/MCP/adapters:** ways for other open tools and agents to use Narova's
  capabilities without duplicating its production knowledge.

These are different doors into one project model, not separate products.

### Open-source success measures

- clean-install success rate on supported systems;
- median time from intent to first useful visual preview;
- percentage of first-time users who finish without editing config or code;
- completion and confusion rates for guided, collaborative, director, and
  automation workflows;
- percentage of users who change interaction depth without losing work or
  restarting;
- number of questions Narova asks before the first preview, segmented by
  experience level;
- rate at which users accept, modify, or reverse Narova's inferred creative
  direction;
- creative preference for the reference LLM with Narova versus without it;
- quality achievable with no paid generation API;
- successful revisions that preserve explicitly protected work;
- second-project and project-reuse rate;
- number and diversity of working adapters, community components, examples,
  languages, voices, and platform workflows;
- documentation task-completion rate;
- percentage of issues that produce reusable tests, clearer errors, or shared
  production knowledge.

### Community architecture

- keep the canonical project schema and core runtime provider-neutral;
- publish compatibility and conformance tests for renderers and adapters;
- make creative components small, documented, remixable, and independently
  testable;
- attach examples to source, prompt, model tier, hardware tier, build time, and
  reproducibility information;
- maintain a public lightweight-model benchmark;
- use small RFCs for project-format and extension-contract changes;
- provide contributor fixtures that reproduce real creative and UX failures;
- keep telemetry off by default and make any diagnostic sharing explicit and
  inspectable.

## Capability architecture

Narova should be designed as a creative system, compiler, and operating layer,
with replaceable models and renderers.

### 1. Creative intelligence substrate

- translate loose intent into story, audience, format, art direction, pacing,
  audio direction, and a structured production plan;
- provide composable visual and motion primitives with a much higher creative
  ceiling than fixed templates;
- package production knowledge so smaller LLMs make bounded creative decisions
  instead of generating an entire implementation from scratch;
- evaluate hierarchy, distinctiveness, rhythm, clarity, emotional effect, and
  platform fit;
- run critique and repair loops before asking the user to inspect the result;
- learn from approved edits without locking the project to one model.

### 2. Intent, sources, and truth

- ingest URLs, repositories, documents, decks, feeds, and structured data;
- accept an idea, conversation, rough script, existing footage, or structured
  brief even when no external source exists;
- retain source snapshots, passages, claims, licenses, and timestamps;
- assign stable source IDs and detect meaningful changes;
- map each claim and visual asset to the script and output that uses it.

### 3. Durable project model

- stable project, scene, turn, asset, voice, variant, locale, release, and
  destination IDs;
- declarative project manifest;
- dependency graph from source to every derived artifact;
- explicit inherited and overridden values for brands, series, and variants.

### 4. Agent planning and direction

- LLM-neutral context package and task contract;
- a shared adaptive-interaction contract used by the skill, CLI, Studio, SDK,
  and MCP;
- separate video fluency, technical fluency, control preference, and
  explanation depth rather than one crude beginner/expert flag;
- separate research, script, art direction, construction, and QA stages so a
  small model does not need to solve the whole problem in one prompt;
- capability negotiation based on installed local tools and optional providers;
- structured edit intents rather than unrestricted rewrites.

### 5. Media compilation

- local-first TTS, alignment, captions, assets, music, and render;
- replaceable adapters for premium speech, image, footage, avatar, and render
  providers;
- deterministic base compositions;
- content-addressed caching and the smallest safe rebuild.

### 6. Change engine

- semantic diff between project/source versions;
- impact plan before execution;
- preservation contracts: what may change, must change, and must not change;
- dependency-aware incremental rebuild;
- visual, audio, script, source, and output comparisons.

### 7. Quality and policy

- existing schema and platform checks;
- screenshot, motion, overlap, safe-zone, contrast, caption, loudness,
  pronunciation, and accessibility checks;
- claim, source-freshness, disclosure, rights, and brand checks;
- test fixtures and regression baselines for reusable components.

### 8. Versions, review, and release

- immutable build manifests and named releases;
- compare, restore, branch, approve, and audit;
- time-coded or scene-level comments and structured change requests;
- stable publish aliases that can point to a newly approved release;
- destination registry and rollback.

### 9. Library and scale

- shared brands, voices, components, assets, series, and project families;
- audience, platform, locale, and campaign matrices;
- batch, API, MCP, SDK, scheduled, and CI modes;
- local studio and optional team/cloud control plane.

## What to build first

### P0: creative kernel and durable project primitives

1. Define a lightweight reference-model benchmark and a set of briefs that
   measure how much production intelligence Narova supplies.
2. Define the adaptive-experience contract and test the same brief in guided,
   collaborative, director, and automation interactions.
3. Introduce a structured creative plan: audience, story, beat map, art
   direction, composition system, motion language, audio direction, and
   intended emotional effect.
4. Build and test composable creative primitives plus automated critique and
   repair checks.
5. Add `narova.manifest.json` with stable IDs and project metadata.
6. Add a build manifest containing hashes, dependency versions, providers,
   settings, costs, timings, and artifacts.
7. Add a dependency graph and `narova plan` command that reports the impact and
   expected cost of a change before building.
8. Add `narova diff` for source, script, visual, audio, and artifact changes.
9. Extend content-addressed builds beyond the existing sentence cache.
10. Add named releases, restore, and a stable local publishing alias.

The creative kernel fulfills the vision; the durable project primitives keep
its output controllable and reusable.

### P1: the maintenance loop

1. `narova source check` to detect source freshness and meaningful changes.
2. Source-to-scene and claim-to-turn dependency mapping.
3. `narova update` to propose script and visual changes while preserving
   approved unaffected content.
4. Variant and locale families updated from the same root.
5. Approval gates, regression QA, and release notes generated from the diff.
6. Destination registry and controlled replacement of a published version.

### P2: reusable creative systems

1. brand profiles with enforced typography, color, logo, audio, disclosure,
   and safe-area rules;
2. reusable, tested components rather than rigid output templates;
3. governed voice and asset libraries with rights metadata;
4. multi-platform, multi-audience, and multi-language matrices;
5. series-level identity and continuity;
6. performance feedback attached to versions and variants.

### P3: management and scale

1. a local Studio showing projects, sources, changes, builds, versions, costs,
   comments, and approvals;
2. review links or portable review packages;
3. batch, API, MCP, SDK, webhook, scheduled, and CI interfaces;
4. an optional cloud control plane and remote renderer;
5. plugin/adaptor ecosystem for models, renderers, publishers, and source
   systems.

### Do not prioritize yet

- training a proprietary foundation video model;
- competing with Runway on cinematic footage generation;
- building a full nonlinear editor;
- an avatar-first product identity;
- a large template marketplace before reusable component quality is proven;
- enterprise SSO, procurement, and analytics before a repeated workflow has
  strong retention;
- a cloud-only architecture that removes Narova's cost, privacy, and ownership
  advantage.

## Need and product-user-fit research

Desk research can establish a plausible need. It cannot establish product-user
fit. The next eight weeks should be organized around falsifying the initial
research-cohort hypothesis.

### User discovery

Interview at least 30 people:

- 10 technical marketers or developer advocates;
- 8 founders or open-source maintainers who publish product videos;
- 6 technical agencies or content studios;
- 6 L&D, customer-education, or SOP owners as an adjacent comparison group.

Do not demo first. Ask for the last two videos they produced, every revision,
the source material, collaborators, elapsed time, outside spend, what changed
after publication, and what remains out of date. Evidence is an actual recent
workflow, not agreement that the idea sounds useful.

### Concierge pilots

Run 10 pilots using real source material and at least one real source change:

1. create the first video;
2. wait for or introduce a legitimate product/document change;
3. show the impact plan;
4. update only affected outputs;
5. compare time, cost, unwanted drift, and approval effort with the prior
   workflow;
6. ask the user to bring the next real creation or update into Narova rather
   than returning to the prior workflow.

The second build is the product test. A beautiful first build only tests
generation.

### Need and enablement scorecard

Promising signal after the pilots would be:

- at least 8/10 reach a useful preview without developer intervention;
- guided users encounter no unexplained production or implementation jargon;
- collaborative and director users can request more precision without leaving
  the project or being forced into code;
- the same project can move between guided, collaborative, director, and
  automation interaction without information loss;
- at least 7/10 say the result exceeds what they could have made with their
  existing skill, time, and budget;
- a lightweight reference LLM completes the benchmark without hand-authored
  scene implementation;
- median first preview under 10 minutes after installation;
- median source-change-to-approved-release under 15 minutes for a short video;
- at least 90% of explicitly protected elements remain unchanged;
- at least 6/10 create a second project or update within 30 days;
- at least 4/10 would be "very disappointed" if Narova disappeared;
- at least 5/10 bring a second real project, invite a collaborator, or
  recommend Narova to someone with the same need;
- users cite creative quality relative to effort and cost as the reason to try
  Narova, while repeatability, direction, or changeability becomes a reason to
  keep using it.

### Access and cost research

"Cheap" is a product requirement, not a packaging exercise at this stage.
Measure:

- whether a complete useful video can be produced without a paid generation
  API;
- minimum practical hardware and installation burden;
- compute time and energy for first builds and revisions;
- how much a lightweight LLM can accomplish before a larger model materially
  improves the result;
- which optional media-generation steps dominate cost;
- whether caching, selective rebuilds, and reusable assets make repeated work
  progressively less expensive;
- where low cost begins to damage creative quality.

The aim is to establish an accessibility frontier: the best result Narova can
produce for a given level of model capability, hardware, time, and external
spend.

## Positioning and landing-page implications

The landing page should lead with creative possibility and then prove that the
result remains under the user's control:

1. **Imagine:** anyone can begin with an idea, source, or rough instruction.
2. **Create:** even a simple LLM can direct a distinctive, polished video
   through Narova's creative system.
3. **Direct:** change tone, pacing, story, look, voice, or individual details
   without learning production software.
4. **Evolve:** edit one fact, sentence, color, scene, or source and see the
   exact impact before rebuilding.
5. **Operate:** know which videos are stale and update every affected format
   and language.
6. **Own:** versions, sources, assets, approvals, costs, and destinations stay
   attached to an open, local-first project.

A stronger hero direction:

> **Remarkable video, within everyone's reach.**
>
> Narova gives people and AI agents a complete creative system for turning an
> idea or source into distinctive, production-ready video—even with a simple
> LLM and a local, low-cost stack. Everything remains yours to direct, change,
> organize, and build upon.

The canonical demonstration should prove the vision first and the enabling
functions second:

- give the same ordinary brief to a lightweight LLM with and without Narova;
- show the creative plan and a clearly stronger Narova result;
- show that the local path incurred no paid generation cost;
- change one source fact;
- show the impact plan;
- rebuild only two affected scenes;
- verify everything else stayed unchanged;
- publish all selected variants as one controlled release.

That demonstration shows that Narova supplies creative leverage rather than
merely forwarding a prompt to a model. The revision then proves that the result
is living work, not a disposable generation.

## Principal risks

1. **Competitive velocity:** HeyGen and Poko are shipping directly into
   agent-native, local, code-based workflows. Narova must move quickly from
   feature parity to lifecycle depth.
2. **Output quality:** cheap creation can amplify generic, low-trust video.
   Creative direction, grounding, and QA are core product work, not polish.
3. **Installation friction:** "anyone" is impossible if local dependencies are
   fragile. A packaged desktop experience or zero-friction installer will be
   required after the CLI wedge.
4. **Lifecycle breadth:** management can expand into an enormous suite. Build
   the dependency and version primitives first, then only the workflows
   validated by real use.
5. **Access erosion:** optional cloud models can quietly become practical
   requirements. The reference local path and lightweight-model benchmark must
   remain first-class so the universal-access claim stays true.
6. **Open-source UX fragmentation:** a powerful CLI, skill, Studio, and SDK can
   drift into inconsistent experiences. One project model, terminology set,
   capability detector, and golden workflow must connect every surface.
7. **Model churn:** Narova must remain model-neutral. Its durable value should
   be the project graph, change engine, quality gates, and reproducible
   workflow, not whichever media model is best this month.

## Decision

Proceed with a universal vision, a focused initial distribution wedge, and a
product architecture broad enough to serve both:

- make exceptional creative capability for everyone the center of the product;
- prove that a simple LLM becomes dramatically more capable through Narova;
- study the first repeated job with technical content teams;
- treat direction, changeability, maintenance, and management as the functions
  that keep this creative power useful;
- make low-cost local creation the default, with paid models optional;
- develop creative intelligence and durable project foundations together;
- validate both the first moment of wonder and the second real update before
  claiming product-user fit.

## Sources

Only sources published or updated after April 2026 are used for market claims.
Live current product pages are labeled separately.

### Market and workflow evidence

- [IAB, “U.S. Digital Video Ad Spend to Surpass $80B in 2026,” 2026-05-05](https://www.iab.com/news/u-s-digital-video-ad-spend-to-surpass-80b-in-2026/)
- [EMARKETER, “B2B video budgets tighten as content demands climb,” 2026-05-05](https://www.emarketer.com/content/b2b-video-budgets-tighten-content-demands-climb/)
- [Pictory/Business Wire, “2026 State of the AI Video-Creation Industry,” 2026-06-10](https://www.businesswire.com/news/home/20260610439066/en/Pictory-Releases-2026-State-of-the-AI-Video-Creation-Industry-Report-Analyzing-More-Than-1.5-Million-Videos)
- [HeyGen, “The state of enterprise video 2026,” updated 2026-06-22](https://www.heygen.com/blog/the-state-of-enterprise-video-2026)
- [Grand View Research/PR Newswire, creator-economy estimate, 2026-06-22](https://www.prnewswire.com/news-releases/creator-economy-market-to-reach-usd-1-345-54-billion-by-2033--driven-by-ai-powered-content-creation-direct-monetization-models-and-expanding-digital-entrepreneurship-302806507.html)
- [TechRadar Pro, “The case for moving creative production AI to the edge,” 2026-07-24](https://www.techradar.com/pro/the-case-for-moving-creative-production-ai-to-the-edge)

### Product direction and lifecycle evidence

- [Runway, “Introducing Aleph 2.0 and Edit Studio,” 2026-05-21](https://runway.com/news/introducing-aleph-2-and-edit-studio)
- [Pictory release notes, May 2026 release](https://kb.pictory.ai/en/articles/8468770-pictory-release-notes)
- [HeyGen, June product release, updated 2026-07-08](https://www.heygen.com/blog/heygen-june-2026-release)
- [Synthesia, version history, updated in July 2026](https://help.synthesia.io/en/articles/10925065-how-do-i-use-version-history-in-synthesia)
- [Synthesia, updating translations after edits, 2026-05-14](https://help.synthesia.io/en/articles/14312285-how-do-i-update-translations-after-editing-a-video)
- [Leadde, keeping SOP videos updated, updated 2026-06-14](https://leadde.ai/blog/how-to-keep-sop-training-videos-updated)
- [Golpo, automated video refresh workflow, 2026-07-17](https://video.golpoai.com/guide/automated-video-refresh-workflow)
- [JSON2Video plan documentation, updated 2026-05-12](https://json2video.com/docs/v2/reference/credits/plans)

### Current product pages accessed 2026-07-26

- [Poko Motion](https://poko.video/)
- [Remotion](https://www.remotion.dev/)
- [JSON2Video](https://json2video.com/)
