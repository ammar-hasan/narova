'use strict';
/* Read-only option expansion for Video CI (CHANGE-2026-038 / NAR-023-024..029). */

const PLAN_SCHEMA = 'narova.intervention-plan/1';
const CREATIVE_CLASSES = new Set([
  'continuity', 'creative-intent', 'creative-hypothesis', 'deliberate-violation',
  'deliberate-choice', 'narrative', 'experimental',
]);

function mappedTargets(state = {}) {
  const targets = [];
  if (state.scene) targets.push({ kind: 'scene', value: state.scene, basis: state.mappingBasis || 'UNAVAILABLE' });
  for (const kind of ['beat', 'component']) {
    if (state[kind]) targets.push({ kind, value: state[kind], basis: 'AUTHORED' });
  }
  for (const kind of ['source', 'asset', 'generation', 'creativeLineage']) {
    if (state[kind] && state[kind].value) {
      targets.push({ kind, value: state[kind].value, basis: state[kind].basis || 'UNSPECIFIED' });
    }
  }
  return targets;
}

function option(observation, stance, title, rationale, consequences, reversibility) {
  return {
    id: `${observation.id}-${stance}`,
    stance,
    title,
    rationale,
    consequences,
    reversibility,
    authority: 'creator-choice',
    mutation: 'none',
  };
}

function keepOption(observation) {
  return option(
    observation,
    'keep-unchanged',
    'Keep the rendered result unchanged',
    'Treat the observed result as an intentional or acceptable part of this version.',
    [
      'Preserves the current artifact and its unexpected or unresolved property.',
      'Leaves the declared assertion and rendered result visibly different or uncertain.',
    ],
    'No production change.',
  );
}

function divergentOptions(observation) {
  if (CREATIVE_CLASSES.has(observation.assertion.class)) {
    return [
      keepOption(observation),
      option(observation, 'align-to-intent', 'Align execution to the declared intent',
        'Change only mapped production state that plausibly affects the measured difference, while preserving protected concerns.',
        ['May make the declared effect more faithfully perceptible.', 'May remove an emergent quality present in the current render.'],
        'Make the change in a separate proof or branch so the current render remains available.'),
      option(observation, 'embrace-result', 'Embrace and restate the rendered result',
        'Keep the rendered property and revise the creative hypothesis only if the creator decides the surprise is valuable.',
        ['Preserves the discovered result as an authored choice.', 'Changes the declared intent rather than the artifact.'],
        'Retain the previous assertion and decision history so the reinterpretation can be reversed.'),
      option(observation, 'compare-branch', 'Compare intent and emergence side by side',
        'Create one reversible proof aligned to the assertion and compare it with the unchanged render before choosing.',
        ['Makes the consequence of alignment inspectable.', 'Requires a later, explicitly invoked branch/proof workflow.'],
        'Branch-isolated comparison; this plan does not create it.'),
    ];
  }
  return [
    keepOption(observation),
    option(observation, 'inspect-source', 'Inspect the mapped source of the constraint',
      'Check the declared requirement and available mapped production state before changing the artifact.',
      ['May reveal that the assertion or source evidence should change.', 'Adds inspection work but avoids a blind correction.'],
      'Inspection only; no production change.'),
    option(observation, 'align-to-intent', 'Minimally align the render to the assertion',
      'Change the smallest available mapped target that can restore the declared measurable condition.',
      ['May restore the declared constraint.', 'Could disturb protected concerns unless the later change is regression-checked.'],
      'Make the change in a separate proof or branch so it can be discarded.'),
    option(observation, 'compare-branch', 'Compare a minimal correction with the current render',
      'Preserve the current artifact and test one isolated correction before choosing.',
      ['Makes collateral differences inspectable.', 'Requires a later, explicitly invoked branch/proof workflow.'],
      'Branch-isolated comparison; this plan does not create it.'),
  ];
}

function uncertainOptions(observation) {
  return [
    keepOption(observation),
    option(observation, 'clarify-intent', 'Clarify the intended observable condition',
      'Refine what should be perceptible without assuming a conventional creative objective.',
      ['Can make a later judgement more decisive.', 'May intentionally leave the effect subjective rather than measurable.'],
      'Assertion-only proposal; this plan does not rewrite it.'),
    option(observation, 'gather-evidence', 'Gather the missing evidence',
      'Add or select evidence capable of answering the existing assertion while retaining uncertainty until then.',
      ['Can distinguish an execution gap from a perception gap.', 'May require a specialized perceiver or new reference evidence later.'],
      'Evidence proposal only; this plan does not invoke a provider or network.'),
    option(observation, 'cheap-proof', 'Test the hypothesis with a cheap proof',
      'Design a bounded comparison that makes the uncertain property easier to perceive.',
      ['Can reduce uncertainty without committing the production.', 'Requires a later, explicitly invoked proof workflow.'],
      'Branch-isolated proof; this plan does not create or render it.'),
  ];
}

function interventionPlan(judgement) {
  if (!judgement || judgement.schema !== 'narova.judgement/1') {
    throw new Error('intervention planning requires narova.judgement/1');
  }
  const optionSets = judgement.observations
    .filter(observation => observation.assertion
      && (observation.outcome === 'DIVERGED' || observation.outcome === 'UNCERTAIN'))
    .map(observation => {
      const state = observation.relatedProductionState || {};
      return {
        observationId: observation.id,
        assertion: {
          id: observation.assertion.id,
          class: observation.assertion.class,
          expect: observation.assertion.expect,
        },
        outcome: observation.outcome,
        timeRange: { ...observation.timeRange },
        relatedProductionState: {
          targets: mappedTargets(state),
          protectedConcerns: Array.isArray(state.protected) ? state.protected.slice() : [],
          causality: state.causality || 'not-established',
        },
        options: observation.outcome === 'DIVERGED'
          ? divergentOptions(observation) : uncertainOptions(observation),
      };
    });
  return {
    schema: PLAN_SCHEMA,
    purpose: 'expand creator option space; no option is selected or executed',
    authority: 'creator',
    mutation: 'none',
    selection: null,
    basedOn: {
      judgementSchema: judgement.schema,
      artifact: {
        path: judgement.artifact.path,
        sha256: judgement.artifact.sha256,
      },
    },
    optionSets,
  };
}

function formatInterventionPlan(plan) {
  const lines = [
    '',
    'Narova Video CI — intervention options',
    'Creative authority: the creator decides. Options are unranked.',
    'No option selected or executed. No project or output state changed.',
    `Option sets: ${plan.optionSets.length}`,
  ];
  for (const set of plan.optionSets) {
    lines.push('', `OPTIONS FOR ${set.observationId} — ${set.assertion.id} (${set.outcome})`);
    lines.push(`Intent: ${set.assertion.expect}`);
    lines.push(`Time range: ${JSON.stringify(set.timeRange)}`);
    lines.push(`Targets: ${set.relatedProductionState.targets.length ? JSON.stringify(set.relatedProductionState.targets) : 'unavailable'}`);
    lines.push(`Protected: ${set.relatedProductionState.protectedConcerns.length ? JSON.stringify(set.relatedProductionState.protectedConcerns) : 'none recorded'}`);
    lines.push(`Causality: ${set.relatedProductionState.causality}`);
    for (const candidate of set.options) {
      lines.push(`- ${candidate.id} [${candidate.stance}]: ${candidate.title}`);
      lines.push(`  Rationale: ${candidate.rationale}`);
      lines.push(`  Consequences: ${candidate.consequences.join(' | ')}`);
      lines.push(`  Reversibility: ${candidate.reversibility}`);
      lines.push(`  Authority: ${candidate.authority}; Mutation: ${candidate.mutation}`);
    }
  }
  return lines.join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, character => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

module.exports = { PLAN_SCHEMA, interventionPlan, formatInterventionPlan, mappedTargets };
