
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { tryValidateStruct } from '../types/validators.js';

import { loadYaml } from './schema-validate.js';
import { collectAllSteps } from './workflow-tree.js';

export interface LintWarning {
  readonly id: string;
  readonly step?: string;
  readonly message: string;
  readonly topic: string;
}

interface StepCtx {
  readonly step: Record<string, unknown>;
  readonly name: string;
  readonly sequence: string;
}

function collectStepsWithCtx(workflow: Record<string, unknown>): StepCtx[] {
  const out: StepCtx[] = [];
  const visit = (steps: ReadonlyArray<Record<string, unknown>> | undefined, seq: string): void => {
    for (const step of steps ?? []) {
      out.push({ step, name: String(step.name ?? '<unnamed>'), sequence: seq });
      const routes = step.routes as
        | { define?: ReadonlyArray<{ id?: string; steps?: ReadonlyArray<Record<string, unknown>> }> }
        | undefined;
      if (routes && Array.isArray(routes.define)) {
        for (const r of routes.define) visit(r.steps, `${seq}>${String(r.id ?? '?')}`);
      }
      const lanes = step.lanes as
        | { define?: ReadonlyArray<{ id?: string; steps?: ReadonlyArray<Record<string, unknown>> }> }
        | undefined;
      if (lanes && Array.isArray(lanes.define)) {
        for (const l of lanes.define) visit(l.steps, `${seq}>${String(l.id ?? '?')}`);
      }
    }
  };
  visit((workflow.steps ?? []) as ReadonlyArray<Record<string, unknown>>, 'main');
  return out;
}

function knownParams(workflow: Record<string, unknown>): Set<string> {
  const names = new Set<string>(['run_id', 'iteration']);
  for (const p of (workflow.params ?? []) as ReadonlyArray<Record<string, unknown>>) {
    if (typeof p.name === 'string') names.add(p.name);
  }
  for (const step of collectAllSteps({ steps: workflow.steps })) {
    for (const key of Object.keys((step.param_bindings ?? {}) as Record<string, unknown>)) {
      names.add(key);
    }
  }
  return names;
}

const TOKEN_RE = /\{([a-z][a-z0-9_]*)\}/g;

function ackSet(container: Record<string, unknown> | undefined): Set<string> {
  const raw = container?.acknowledge_warnings;
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
}

function countDeclaredOutputs(workflow: Record<string, unknown>): number {
  let count = 0;
  for (const s of collectAllSteps({ steps: workflow.steps })) {
    if (Array.isArray(s.outputs)) count += s.outputs.length;
  }
  return count;
}

export const STRUCT_FIELD_CONTAINERS: ReadonlyArray<string> = [
  'properties',
  'json_schema',
  'yaml_schema',
  'frontmatter',
  'required_sections',
  'file_checks',
];

export function structHasFieldContainer(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  return STRUCT_FIELD_CONTAINERS.some((k) => k in obj);
}

export function structUnknownTopLevelKeys(parsed: unknown): string[] {
  const outcome = tryValidateStruct(parsed);
  if (outcome.ok) return [];
  return outcome.errors
    .filter((err) => err.keyword === 'additionalProperties')
    .map((err) => String((err.params as { additionalProperty?: string }).additionalProperty ?? ''))
    .filter((k) => k.length > 0);
}

export function isLocalWebhookUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/i.test(url);
}

export const LINT_WARNING_IDS: ReadonlyArray<string> = [
  'inline-agent-gate',
  'input-token',
  'goal-token',
  'delegate-target',
  'delegate-param',
  'empty-default',
  'no-outputs',
  'all-optional',
  'json-no-struct',
  'dup-output',
  'periter-outside',
  'inline-noop-fields',
  'planning-fields',
  'tools-on-nonexec',
  'tool-cross-type',
  'handoff-write-proof',
  'handoff-source',
  'struct-extra-keys',
  'tool-name-length',
  'webhook-url',
  'lane-cross-param',
  'decider-no-interpreter',
  'outside-templates-tree',
];

export function lintWorkflow(
  workflow: Record<string, unknown>,
  opts: { readonly definitionDir?: string } = {},
): LintWarning[] {
  const warnings: LintWarning[] = [];
  const steps = collectStepsWithCtx(workflow);
  const params = knownParams(workflow);
  const wfAck = ackSet(workflow);

  const push = (w: LintWarning, stepObj?: Record<string, unknown>): void => {
    const stepAck = ackSet(stepObj);
    if (stepAck.has(w.id) || wfAck.has(w.id)) return;
    warnings.push(w);
  };

  {
    const hook = workflow.inbox_webhook;
    if (typeof hook === 'string' && hook && !isLocalWebhookUrl(hook)) {
      push({
        id: 'webhook-url',
        message:
          `workflow inbox_webhook points at a non-localhost URL ('${hook}') inside a ` +
          `committed file. If every machine running this workflow should notify that ` +
          `address (a fixed team bot), this is fine — acknowledge it. Otherwise prefer ` +
          `the per-run override (--inbox-webhook / the /api/run field) or env/config.`,
        topic: 'inbox',
      });
    }
  }

  const warnedStructs = new Set<string>();
  for (const { step, name } of steps) {
    const inline = step.subagent === false;
    const isPlanning = step.type === 'planning';
    const isDelegation = typeof step.delegate_to === 'string' && step.delegate_to !== '';
    const gate = (step.gate ?? {}) as Record<string, unknown>;
    const outputs = Array.isArray(step.outputs)
      ? (step.outputs as Array<Record<string, unknown>>)
      : [];

    if (opts.definitionDir !== undefined) {
      const inputs = Array.isArray(step.inputs)
        ? (step.inputs as Array<Record<string, unknown>>)
        : [];
      for (const entry of [...inputs, ...outputs]) {
        const structName = typeof entry.struct === 'string' ? (entry.struct as string) : '';
        if (structName === '' || warnedStructs.has(structName)) continue;
        warnedStructs.add(structName);
        const schemaPath = join(opts.definitionDir, 'structs', `${structName}.schema.yaml`);
        if (!existsSync(schemaPath)) continue;
        let parsed: unknown;
        try {
          parsed = loadYaml<unknown>(schemaPath);
        } catch {
          continue;
        }
        if (!structHasFieldContainer(parsed)) continue;
        const extra = structUnknownTopLevelKeys(parsed);
        if (extra.length === 0) continue;
        push(
          {
            id: 'struct-extra-keys',
            step: name,
            message:
              `Struct '${structName}' (structs/${structName}.schema.yaml) carries top-level ` +
              `key(s) ${extra.map((k) => `'${k}'`).join(', ')} that no validator reads — they are ` +
              `silently inert (validation still runs from the recognized blocks).` +
              (extra.includes('additionalProperties')
                ? ` In particular top-level 'additionalProperties' is NOT enforced: the gate ` +
                  `does not reject extra fields in outputs.`
                : '') +
              ` Most common: delete the inert keys. Acknowledge if kept deliberately ` +
              `(e.g. for editor tooling that reads them).`,
            topic: 'struct-format',
          },
          step,
        );
      }
    }

    for (const blockKey of ['loop_back', 'routes'] as const) {
      const block = step[blockKey] as Record<string, unknown> | undefined;
      const when = (block?.when ?? undefined) as Record<string, unknown> | undefined;
      const cmd = typeof when?.script === 'string' ? when.script.trim() : '';
      const firstTok = cmd.split(/\s+/)[0] ?? '';
      if (firstTok && /\.(py|js|mjs|cjs|sh|ps1|rb|pl)$/i.test(firstTok)) {
        push(
          {
            id: 'decider-no-interpreter',
            step: name,
            message:
              `Step '${name}' ${blockKey}.when.script starts with the script file itself ` +
              `('${firstTok}') — no interpreter. The engine runs the command verbatim from ` +
              `the shell, so this depends on per-OS script handling and may fail on ` +
              `Windows. Prefix the interpreter (e.g. 'python ${firstTok}'). Acknowledge ` +
              `if the script is deliberately executable on every target machine.`,
            topic: blockKey === 'loop_back' ? 'loop-back' : 'routes',
          },
          step,
        );
      }
    }

    if (inline && (gate.semantic === true || gate.human === true)) {
      const wfGateLint = (workflow.gate ?? {}) as Record<string, unknown>;
      const chRaw = Object.prototype.hasOwnProperty.call(gate, 'human_channel')
        ? gate.human_channel
        : wfGateLint.human_channel;
      const inboxChannel = gate.human === true && (chRaw === 'external' || chRaw === 'both');
      push(
        {
          id: 'inline-agent-gate',
          step: name,
          message: inboxChannel
            ? `Step '${name}' is inline (subagent: false) with gate.human on the external ` +
              `channel — the approval IS enforced (step_complete refuses without a fresh ` +
              `inbox response), but the question only surfaces as that refusal: inline ` +
              `steps skip step_collect_result, so no upfront human-gate protocol is ` +
              `delivered` +
              (gate.semantic === true
                ? `, and gate.semantic stays inert (the gate hook fires only for subagent steps)`
                : ``) +
              `. Most common: make the step a subagent step (drop subagent: false). ` +
              `Acknowledge if the refusal-driven flow is deliberate.`
            : `Step '${name}' is inline (subagent: false) but declares gate.semantic/human — ` +
              `these gates have NO EFFECT today: the gate hook fires only for subagent steps, ` +
              `so the approval/quality check you configured will silently never run. ` +
              `Most common: make the step a subagent step (drop subagent: false). ` +
              `If the inline shape is deliberate, put the approval into the goal text and ` +
              `acknowledge_warnings: [inline-agent-gate] on the step.`,
          topic: inboxChannel ? 'inbox' : 'gate',
        },
        step,
      );
    }

    if (inline) {
      const noop: string[] = [];
      if (typeof step.model === 'string') noop.push('model');
      if ('max_gate_retries' in gate) noop.push('gate.max_gate_retries');
      if ('max_step_retries' in gate) noop.push('gate.max_step_retries');
      if ('allow_partial_step_complete' in gate) noop.push('gate.allow_partial_step_complete');
      if (Array.isArray(step.deny) && step.deny.length > 0) noop.push('deny');
      if (noop.length > 0) {
        push(
          {
            id: 'inline-noop-fields',
            step: name,
            message:
              `Step '${name}' is inline (subagent: false) but declares ${noop.join(', ')} — ` +
              `these act only on subagent steps (model modes drive subagent spawn; retry ` +
              `budgets live in the gate hook, which never fires for inline steps). ` +
              `Most common: drop them, or make the step a subagent if you wanted their effect. ` +
              `Acknowledge with acknowledge_warnings: [inline-noop-fields] if deliberate.`,
            topic: 'design-choices',
          },
          step,
        );
      }
    }

    if (!isPlanning) {
      const pf = ['max_substeps', 'max_plan_attempts', 'allow_parallel', 'allow_delegation'].filter(
        (f) => f in step,
      );
      if (pf.length > 0) {
        push(
          {
            id: 'planning-fields',
            step: name,
            message:
              `Step '${name}' declares ${pf.join(', ')} but is not a planning step — these ` +
              `fields are consumed only by type: planning steps and are silently ignored here. ` +
              `Most common: remove them (or add type: planning if dynamic decomposition was the intent).`,
            topic: 'planning',
          },
          step,
        );
      }
    }

    if ((isPlanning || isDelegation) && Array.isArray(step.tools)) {
      push(
        {
          id: 'tools-on-nonexec',
          step: name,
          message:
            `Step '${name}' declares a tools: filter but is a ${isPlanning ? 'planning' : 'delegation'} ` +
            `step — these steps return before tool composition, so the filter has no effect. ` +
            `Most common: remove it; expose tools on the executing (subagent) steps instead.`,
          topic: 'tools',
        },
        step,
      );
    }

    if (!isPlanning && !isDelegation && step.spec_authoring !== 'persist' && outputs.length === 0) {
      push(
        {
          id: 'no-outputs',
          step: name,
          message:
            `Step '${name}' declares no outputs — the structural gate has nothing to verify, ` +
            `so the step passes on any claim. Most common: declare the artifact the step ` +
            `produces (even a short report/JSON). Legitimate for pure-action steps — ` +
            `acknowledge_warnings: [no-outputs] on the step if so. (If this step exists only ` +
            `to "check" or "decide" something, note that loop/route deciders and gates are ` +
            `CONFIG on other steps, not steps themselves.)`,
          topic: 'outputs',
        },
        step,
      );
    }

    if (outputs.length > 0 && outputs.every((o) => o.optional === true)) {
      push(
        {
          id: 'all-optional',
          step: name,
          message:
            `Every output of step '${name}' is optional: true — the gate cannot fail on ` +
            `absence, so a subagent that writes nothing still passes. Most common: keep at ` +
            `least the primary artifact non-optional. Acknowledge if genuinely all-conditional.`,
          topic: 'outputs',
        },
        step,
      );
    }

    for (const o of outputs) {
      const p = typeof o.path === 'string' ? o.path : '';
      if (p.endsWith('.json') && !('struct' in o)) {
        push(
          {
            id: 'json-no-struct',
            step: name,
            message:
              `Output '${p}' of step '${name}' is JSON but declares no struct: — the gate ` +
              `checks only existence, so content errors compound downstream. Most common: ` +
              `declare a struct schema (structs/<name>.schema.yaml). Acknowledge if the ` +
              `JSON is deliberately free-form.`,
            topic: 'struct-format',
          },
          step,
        );
        break;
      }
    }

    const goal = typeof step.goal === 'string' ? step.goal : '';
    if (goal.includes('{{')) {
      push(
        {
          id: 'goal-token',
          step: name,
          message:
            `Goal of step '${name}' contains '{{ ... }}' — Riglane placeholders are SINGLE-brace ` +
            `{param}; double braces stay literal and the subagent will see raw mustache text. ` +
            `Most common: replace {{ x }} with {x}.`,
          topic: 'step-fields',
        },
        step,
      );
    }

    for (const inp of (step.inputs ?? []) as ReadonlyArray<Record<string, unknown>>) {
      const p = typeof inp.path === 'string' ? inp.path : '';
      const badTokens = [...p.matchAll(TOKEN_RE)]
        .map((m) => m[1] ?? '')
        .filter((t) => t !== '' && !params.has(t));
      const hasParallelNs = p.includes('{parallel_key');
      if (p.includes('{{') || badTokens.length > 0 || hasParallelNs) {
        const what = p.includes('{{')
          ? `'{{ ... }}' (double braces stay literal)`
          : hasParallelNs
            ? `{parallel_key.*} (never resolved in INPUT paths)`
            : `{${badTokens[0]}} (not a declared param)`;
        push(
          {
            id: 'input-token',
            step: name,
            message:
              `Input path '${p}' of step '${name}' contains ${what} — the token stays ` +
              `literal, the file is never found, and with file_if_exists (or any glob) the ` +
              `input VANISHES silently. Most common: declare the param or fix the typo.`,
            topic: 'inputs',
          },
          step,
        );
        break;
      }
    }


    for (const o of outputs) {
      if (typeof o.from_delegated === 'string' && typeof o.write_proof === 'string') {
        push(
          {
            id: 'handoff-write-proof',
            step: name,
            message:
              `Step '${name}' declares write_proof on a from_delegated output ('${String(o.path)}') — ` +
              `it has no effect: the engine itself copies the child artifact (the copy IS the ` +
              `write) and delegation steps have no pre-step snapshot, so freshness is never ` +
              `checked. Most common: drop write_proof from this entry (existence + struct ` +
              `still validate). Acknowledge with acknowledge_warnings: [handoff-write-proof] ` +
              `if you keep it for documentation.`,
            topic: 'delegation',
          },
          step,
        );
      }
    }

    if (isDelegation && opts.definitionDir !== undefined) {
      const targetName = String(step.delegate_to);
      const familyDir = dirname(opts.definitionDir);
      const templatesDir = dirname(familyDir);
      const candidates = ['my_workflows', 'predefined', 'examples'].map((fam) =>
        join(templatesDir, fam, targetName, 'workflow.yaml'),
      );
      const found = candidates.find((c) => existsSync(c));
      if (found === undefined) {
        push(
          {
            id: 'delegate-target',
            step: name,
            message:
              `Step '${name}' delegates to '${targetName}', which was not found under the ` +
              `workflow templates tree — the run will fail only at RUNTIME, after every ` +
              `prior step has already executed. Most common: fix the workflow name. ` +
              `Acknowledge if the target is installed separately on the runtime machine.`,
            topic: 'delegation',
          },
          step,
        );
      } else {
        try {
          const target = loadYaml<Record<string, unknown>>(found);
          const targetParams = new Set(
            ((target.params ?? []) as ReadonlyArray<Record<string, unknown>>)
              .map((p) => (typeof p.name === 'string' ? p.name : ''))
              .filter((n) => n !== ''),
          );
          const passed = Object.keys((step.params ?? {}) as Record<string, unknown>);
          const unknown = passed.filter((k) => !targetParams.has(k));
          if (unknown.length > 0) {
            push(
              {
                id: 'delegate-param',
                step: name,
                message:
                  `Step '${name}' passes param '${unknown[0]}' to '${targetName}', but the ` +
                  `target does not declare it — the child silently ignores unknown keys and ` +
                  `uses its own defaults (a typo here means a silently WRONG run). Most ` +
                  `common: match the target's declared param names (${[...targetParams].join(', ') || 'none'}).`,
                topic: 'delegation',
              },
              step,
            );
          }
        } catch {
        }
        const handoffs = outputs.filter((o) => typeof o.from_delegated === 'string');
        if (handoffs.length > 0) {
          try {
            const target = loadYaml<Record<string, unknown>>(found);
            const childOutputCount = countDeclaredOutputs(target);
            if (childOutputCount === 0) {
              push(
                {
                  id: 'handoff-source',
                  step: name,
                  message:
                    `Step '${name}' declares from_delegated, but the delegated workflow ` +
                    `'${targetName}' declares NO outputs on any of its steps — the handoff ` +
                    `will find nothing the child is contracted to produce. Most common: ` +
                    `declare the artifact as an output in the child workflow (its gate then ` +
                    `guarantees it exists before the handoff runs).`,
                  topic: 'delegation',
                },
                step,
              );
            }
          } catch {
          }
        }
      }
    }
  }


  for (const p of (workflow.params ?? []) as ReadonlyArray<Record<string, unknown>>) {
    if (p.default === '') {
      push({
        id: 'empty-default',
        message:
          `Param '${String(p.name)}' has default: "" — an empty string is a REAL value at ` +
          `every boundary: it OVERRIDES a delegated child's own default and resolves path ` +
          `placeholders to doubled separators (e.g. '.riglane/specs//…'), silently. Most common: ` +
          `omit the default entirely (an absent/null param leaves the child default intact). ` +
          `Acknowledge if empty-string is genuinely meaningful here.`,
        topic: 'delegation',
      });
    }
  }

  {
    const norm = (s: string): string => s.replace(/[^a-zA-Z0-9_]/g, '_');
    const wfNorm = norm((workflow.name as string | undefined) ?? '');
    for (const t of (workflow.tools ?? []) as ReadonlyArray<Record<string, unknown>>) {
      if (((t.type as string | undefined) ?? 'script') !== 'script') continue;
      const tn = typeof t.name === 'string' ? t.name : '';
      if (tn === '') continue;
      const surfaced = `workflow_tools_${wfNorm}__${norm(tn)}`;
      if (surfaced.length > 64) {
        push({
          id: 'tool-name-length',
          message:
            `Script tool '${tn}' surfaces to the model as '${surfaced}' ` +
            `(${surfaced.length} chars). Hosts may add their own prefix on top of that, and ` +
            `some providers cap tool names at 64 chars — an over-long name can make the tool ` +
            `silently unavailable there. Most common: shorten the tool or workflow name. ` +
            `Acknowledge if every host you run on is verified to accept it.`,
          topic: 'tools',
        });
      }
    }
  }

  {
    const loopSeqs = new Set(
      steps.filter((s) => s.step.loop_back !== undefined).map((s) => s.sequence),
    );
    const bySeq = new Map<string, Map<string, string>>();
    for (const { step, name, sequence } of steps) {
      if (loopSeqs.has(sequence)) continue;
      for (const o of (step.outputs ?? []) as ReadonlyArray<Record<string, unknown>>) {
        const p = typeof o.path === 'string' ? o.path : '';
        if (p === '' || /[*?[]/.test(p)) continue;
        const seqMap = bySeq.get(sequence) ?? new Map<string, string>();
        bySeq.set(sequence, seqMap);
        const first = seqMap.get(p);
        if (first !== undefined && first !== name) {
          push(
            {
              id: 'dup-output',
              step: name,
              message:
                `Steps '${first}' and '${name}' both declare output '${p}' in the same ` +
                `sequence — write_proof requires the LATER step to actually modify the file; ` +
                `a read-only consumer fails its gate with a misleading "subagent must write" ` +
                `message. Most common: declare the file as the producer's output only (a ` +
                `consumer lists it under inputs:). Acknowledge for deliberate overwrite chains.`,
              topic: 'outputs',
            },
            step,
          );
        } else {
          seqMap.set(p, name);
        }
      }
    }
  }

  {
    const seqSteps = new Map<string, StepCtx[]>();
    for (const s of steps) {
      const arr = seqSteps.get(s.sequence) ?? [];
      arr.push(s);
      seqSteps.set(s.sequence, arr);
    }
    for (const [, arr] of seqSteps) {
      const ranges: Array<[number, number]> = [];
      for (let i = 0; i < arr.length; i += 1) {
        const entry = arr[i];
        if (entry === undefined) continue;
        const lb = entry.step.loop_back as { to?: string } | undefined;
        if (lb && typeof lb.to === 'string') {
          const toIdx = arr.findIndex((s) => s.name === lb.to);
          if (toIdx >= 0 && toIdx <= i) ranges.push([toIdx, i]);
        }
      }
      for (let i = 0; i < arr.length; i += 1) {
        const entry = arr[i];
        if (entry === undefined) continue;
        const outs = (entry.step.outputs ?? []) as ReadonlyArray<Record<string, unknown>>;
        const hasPerIter = outs.some(
          (o) =>
            o.per_iteration === true ||
            (typeof o.path === 'string' && (o.path as string).includes('{iteration}')),
        );
        if (!hasPerIter) continue;
        const inRange = ranges.some(([a, b]) => i >= a && i <= b);
        if (!inRange) {
          push(
            {
              id: 'periter-outside',
              step: entry.name,
              message:
                `Step '${entry.name}' declares a per-iteration output but sits OUTSIDE the ` +
                `loop range of its sequence — {iteration} resolves to the FINAL counter, so ` +
                `you get ONE file whose name depends on run history, not per-pass files. ` +
                `Most common: move the output onto a step inside the loop range, or drop ` +
                `per_iteration.`,
              topic: 'loop-back',
            },
            entry.step,
          );
        }
      }
    }
  }

  for (const t of (workflow.tools ?? []) as ReadonlyArray<Record<string, unknown>>) {
    const tname = String(t.name ?? '<unnamed>');
    if (t.type === 'script' && 'expected_tools' in t) {
      push({
        id: 'tool-cross-type',
        message:
          `Script tool '${tname}' declares expected_tools — that field is consumed only for ` +
          `type: mcp tools (CC whitelist + call attribution) and is dead here. Most common: remove it.`,
        topic: 'tools',
      });
    }
    if (t.type === 'mcp' && 'input_schema' in t) {
      push({
        id: 'tool-cross-type',
        message:
          `MCP tool '${tname}' declares input_schema — that field is consumed only for ` +
          `type: script tools (arg validation) and is dead here. Most common: remove it.`,
        topic: 'tools',
      });
    }
  }

  {
    const lanesOwners = collectAllSteps({ steps: workflow.steps }).filter(
      (s) => (s.lanes as { define?: unknown[] } | undefined)?.define !== undefined,
    );
    for (const owner of lanesOwners) {
      const define = ((owner.lanes as { define?: Array<Record<string, unknown>> }).define ?? []);
      const boundBy = new Map<string, string>();
      const laneSteps = new Map<string, Array<Record<string, unknown>>>();
      for (const lane of define) {
        const laneId = String(lane.id ?? '?');
        const subtree = collectAllSteps({ steps: lane.steps });
        laneSteps.set(laneId, subtree);
        for (const s of subtree) {
          for (const key of Object.keys((s.param_bindings ?? {}) as Record<string, unknown>)) {
            if (!boundBy.has(key)) boundBy.set(key, laneId);
          }
        }
      }
      if (boundBy.size === 0) continue;
      for (const [laneId, subtree] of laneSteps) {
        for (const s of subtree) {
          const texts: string[] = [];
          if (typeof s.goal === 'string') texts.push(s.goal);
          for (const io of [
            ...((s.inputs ?? []) as Array<Record<string, unknown>>),
            ...((s.outputs ?? []) as Array<Record<string, unknown>>),
          ]) {
            if (typeof io.path === 'string') texts.push(io.path);
          }
          for (const v of Object.values((s.params ?? {}) as Record<string, unknown>)) {
            if (typeof v === 'string') texts.push(v);
          }
          const seen = new Set<string>();
          for (const text of texts) {
            for (const m of text.matchAll(TOKEN_RE)) {
              const token = m[1] as string;
              const binderLane = boundBy.get(token);
              if (binderLane === undefined || binderLane === laneId || seen.has(token)) continue;
              seen.add(token);
              push(
                {
                  id: 'lane-cross-param',
                  step: String(s.name ?? '<unnamed>'),
                  message:
                    `Step '${String(s.name)}' (lane '${laneId}' of fork step ` +
                    `'${String(owner.name)}') reads {${token}}, which sibling lane ` +
                    `'${binderLane}' binds via param_bindings. Sibling lanes complete in a ` +
                    `nondeterministic order, so the value seen here depends on timing (the ` +
                    `pre-fork value or the sibling's). Most common: read the sibling's OUTPUT ` +
                    `FILE after the join instead, or move the read to a step after the fork ` +
                    `step. Acknowledge if the timing dependence is deliberate.`,
                  topic: 'parallel',
                },
                s,
              );
            }
          }
        }
      }
    }
  }

  {
    const allAcks = new Set<string>([...wfAck]);
    for (const { step } of steps) for (const a of ackSet(step)) allAcks.add(a);
    for (const a of allAcks) {
      if (!LINT_WARNING_IDS.includes(a)) {
        warnings.push({
          id: 'unknown-ack',
          message:
            `acknowledge_warnings contains '${a}', which is not a known warning id — ` +
            `likely a typo. Known ids: ${LINT_WARNING_IDS.join(', ')}.`,
          topic: 'workflow-fields',
        });
      }
    }
  }

  return warnings;
}
