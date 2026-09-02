
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { PRODUCT_DIR } from '../config/paths.js';
import {
  type HostBridge,
  type OutgoingRequest,
  runWithCallContext,
  setHostBridge,
} from '../engine/host-bridge.js';
import { type ClientInfo, recordEngineClient } from '../engine/host-context.js';
import { toIsoLocal } from '../engine/iso-time.js';
import {
  toolSpecCreateBatch,
  toolSpecMove,
  toolSpecLink,
  toolSpecSearch,
  toolSpecWrite,
} from '../engine/spec-tools.js';
import type { SpecBatchArgs, SpecMoveArgs, SpecWriteArgs } from '../engine/spec-tools.js';
import {
  appendMcpCall,
  toolAgentNotesSearch,
  toolInbox,
  toolAgentNotesWrite,
  toolListAgentFiles,
  toolStepBegin,
  toolStepBeginDynamic,
  toolStepCollectResult,
  toolStepCollectResultDynamic,
  toolStepComplete,
  toolStepCompleteDynamic,
  toolWorkflowFinalize,
  toolWorkflowFinalizeDynamic,
  toolWorkflowInit,
  toolWorkflowInvokeDynamic,
  toolWorkflowReplanDynamic,
  toolWorkflowResolve,
  toolWorkflowResume,
  toolWorkflowValidate,
  toolWorkflowValidateDynamic,
} from '../engine/workflow-engine.js';
import { AVAILABLE_TOPICS, toolWorkflowLearn } from '../engine/workflow-learn.js';


function log(message: string): void {
  process.stderr.write(`[workflow-engine] ${message}\n`);
}


export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export const TOOLS: ReadonlyArray<ToolDescriptor> = [
  {
    name: 'workflow_resolve',
    description:
      'Find a workflow definition and return its metadata: ' +
      'name, version, description, params, steps, gate config. ' +
      'Use this to inspect a workflow before running it.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: "Workflow name (e.g., 'spec-audit', 'loop-demo')",
        },
      },
    },
  },
  {
    name: 'workflow_init',
    description:
      'Create a new workflow run: generate manifest.json, trace file, ' +
      'and run_token. Returns run identifiers and first step name. ' +
      'Call this after workflow_resolve to start execution.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        params: {
          type: 'object',
          description: 'User-provided params (key-value pairs)',
          default: {},
        },
        model_override: {
          type: 'string',
          enum: ['inherit', 'auto', 'lightest', 'strongest'],
          description:
            'Run-level model MODE override for every subagent step (the --model flag).',
        },
        inbox_webhook: {
          type: 'string',
          description:
            "Run-level inbox webhook override — the http(s) URL this run's question " +
            'envelopes are POSTed to (outranks the workflow inbox_webhook field and ' +
            'the env/config fallbacks).',
        },
        trace_viewer: {
          type: 'string',
          enum: ['off'],
          description:
            "Run-level trace-viewer suppression (the launcher's --no-trace-viewer flag). " +
            "'off' means: do NOT auto-open the trace viewer for this run, whatever the " +
            'ambient engine.auto_open_trace_viewer config says. Pass it ONLY when the ' +
            'launch actually carried --no-trace-viewer — it is the launching human or ' +
            "application's decision to forward, never one to make on their behalf.",
        },
      },
    },
  },
  {
    name: 'workflow_resume',
    description:
      'Resume an existing workflow run. Returns current state, ' +
      'completed step summaries, and the step to resume from. ' +
      'Use when --resume flag is passed.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        run_id: {
          type: 'string',
          description:
            'WHICH run to resume. Omit and the latest resumable run of this workflow is ' +
            'picked — right when there is one, ambiguous when there are two. Pass the id ' +
            'when the user named a run (a stalled older one while a newer is alive); a ' +
            'wrong id is refused, never silently redirected.',
        },
      },
    },
  },
  {
    name: 'step_begin',
    description:
      'Prepare a step for execution. Returns pre-composed text blocks ' +
      '(goal, params, constraints, spec_check, run_token, inputs, ' +
      'outputs) ready for subagent task composition. Also marks the ' +
      'step as in_progress in the manifest. For delegation steps, ' +
      'returns delegation metadata instead of text blocks.',
    inputSchema: {
      type: 'object',
      required: ['name', 'step'],
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        step: { type: 'string', description: 'Step name to begin' },
      },
    },
  },
  {
    name: 'step_collect_result',
    description:
      'After a subagent completes, read gate-result.json and determine ' +
      'the next action: PROCEED (gate passed), RETRY_STEP (gate failed, ' +
      'spawn new subagent), or STOP_WORKFLOW (infrastructure failure).',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        step: {
          type: 'string',
          description: 'Expected step name (for staleness check)',
        },
      },
    },
  },
  {
    name: 'step_complete',
    description:
      'Mark a step as completed. Writes summary to context/, applies ' +
      'param_bindings if defined, advances current_step to the next ' +
      'step. Returns next step name or signals workflow completion. ' +
      'Steps with a loop_back block may return action LOOP_BACK (obey: ' +
      'begin next_step) or AWAITING_LOOP_DECISION (follow the returned ' +
      'engine_instructions, then call step_complete again with ' +
      'loop_decision).',
    inputSchema: {
      type: 'object',
      required: ['name', 'step', 'summary'],
      properties: {
        name: { type: 'string', description: 'Workflow name' },
        step: { type: 'string', description: 'Step name to complete' },
        summary: {
          type: 'string',
          description: 'Brief summary of what the step accomplished (2-3 sentences)',
        },
        loop_decision: {
          type: 'string',
          enum: ['loop', 'proceed'],
          description:
            'Answer to a prior AWAITING_LOOP_DECISION response. Only ' +
            'honored when the step has a loop_back block with semantic/' +
            'human conditions pending.',
        },
        loop_rationale: {
          type: 'string',
          description: 'Short rationale accompanying loop_decision (recorded by the engine).',
        },
        route_decision: {
          type: 'string',
          description:
            'Answer to a prior AWAITING_ROUTE_DECISION response — a route id or ' +
            '"proceed". Only honored when the step has a routes block with ' +
            'semantic/human conditions pending.',
        },
        route_rationale: {
          type: 'string',
          description: 'Short rationale accompanying route_decision (recorded by the engine).',
        },
        delegated_run_id: {
          type: 'string',
          description:
            "Delegation steps only: the child run's run_id (as returned by the " +
            "child's workflow_init). Makes param_bindings resolve against exactly " +
            'that child run (deterministic under parallel runs).',
        },
      },
    },
  },
  {
    name: 'workflow_finalize',
    description:
      'Finalize a completed workflow. Sets manifest status, finalizes ' +
      'trace with aggregates and synthetic entries for missing steps. ' +
      'Call after all steps are completed.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', description: 'Workflow name' } },
    },
  },
  {
    name: 'list_agent_files',
    description: `List files under ${PRODUCT_DIR}/ (bypasses gitignore). Use this instead of Glob/Grep to discover files in ${PRODUCT_DIR}/. IDE search tools skip gitignored paths, but ${PRODUCT_DIR}/ is gitignored by design. Optional pattern filter (e.g. '*.md').`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: `Directory to list (default: '${PRODUCT_DIR}/'). Example: '${PRODUCT_DIR}/specs/'`,
        },
        pattern: {
          type: 'string',
          description:
            "Filename pattern filter (e.g. '*.md', '*.json'). " +
            'If omitted, all files are returned.',
        },
      },
    },
  },
  {
    name: 'workflow_validate',
    description:
      'Validate a workflow YAML draft (raw text). Runs the full validation ' +
      'suite: ajv schema (riglane-workflow-v1) + step-name uniqueness + no ' +
      '`_branch_*` literal in parallel outputs + struct-schema file existence ' +
      '+ planning-no-outputs. Pure check — does NOT write anything. Use this ' +
      'from interactive flows (e.g. /riglane-create-workflow) BEFORE writing the YAML ' +
      'to disk. Returns { ok: boolean, errors: string[] }. ' +
      '`workflow_name` is optional: when provided AND the workflow directory ' +
      'already exists on disk (update flow), the struct-schemas-exist file ' +
      'check runs; otherwise that single check is skipped (drafting a new ' +
      'workflow). Schema + in-memory rules always run.',
    inputSchema: {
      type: 'object',
      required: ['workflow_yaml'],
      properties: {
        workflow_yaml: {
          type: 'string',
          description: 'Raw YAML text of the workflow definition to validate.',
        },
        workflow_name: {
          type: 'string',
          description:
            'Optional. Workflow name — used to locate the on-disk directory for ' +
            'the struct-schemas-exist file check. Skipped when omitted or when ' +
            'directory does not exist.',
        },
      },
    },
  },
  {
    name: 'workflow_validate_dynamic',
    description:
      'Validate an orchestrator-drafted child workflow against the parent ' +
      "planning step's restrictions. Pure validation — does NOT commit to disk. " +
      'Each call bumps the parent step plan-draft attempts counter; when it ' +
      'reaches max_plan_attempts, returns BLOCKED_PLANNING_FAILURE. Call this ' +
      'from the planning-step procedure (Step 2) until ok=true, then proceed ' +
      'to workflow_invoke_dynamic.',
    inputSchema: {
      type: 'object',
      required: ['parent_workflow', 'parent_step', 'workflow_yaml'],
      properties: {
        parent_workflow: {
          type: 'string',
          description: "Parent workflow name (one with the type: 'planning' step)",
        },
        parent_step: {
          type: 'string',
          description: 'Name of the planning step in the parent workflow',
        },
        workflow_yaml: {
          type: 'string',
          description: 'Raw YAML text of the drafted child workflow',
        },
      },
    },
  },
  {
    name: 'workflow_invoke_dynamic',
    description: `Commit an orchestrator-drafted child workflow to disk and initialize a fresh child run. Re-validates the YAML defensively (does NOT bump the attempts counter on failure). On success: writes generated workflow.yaml under the parent run's ${PRODUCT_DIR}/local/workflow_runs/<parent_run_id>/dynamic/<step>/, initializes child manifest, updates parent's planning.phase='executing'. Returns child_run_id + child_workflow_path + step_names. Planning-step procedure Step 3.`,
    inputSchema: {
      type: 'object',
      required: ['parent_workflow', 'parent_step', 'workflow_yaml'],
      properties: {
        parent_workflow: { type: 'string', description: 'Parent workflow name' },
        parent_step: { type: 'string', description: 'Planning step name' },
        workflow_yaml: { type: 'string', description: 'Validated child workflow YAML' },
        inherit_params: {
          type: 'object',
          description: 'Subset of parent params to pass to child (default: {})',
          default: {},
        },
        orchestrator_model_hint: {
          type: 'string',
          description: 'Optional: orchestrator model name for forensics in _dynamic_origin',
        },
      },
    },
  },
  {
    name: 'workflow_finalize_dynamic',
    description:
      'Finalize a planning-step child workflow run. Bridges child terminal ' +
      "status to parent: sets parent's planning.phase to 'completed' (if " +
      "child status === 'completed') or 'failed' (otherwise). After this " +
      'call, you may call step_complete on the parent planning step to ' +
      'advance the parent workflow. Planning-step procedure Step 5.',
    inputSchema: {
      type: 'object',
      required: ['parent_workflow', 'parent_step'],
      properties: {
        parent_workflow: { type: 'string', description: 'Parent workflow name' },
        parent_step: { type: 'string', description: 'Planning step name' },
      },
    },
  },
  {
    name: 'step_begin_dynamic',
    description:
      'Prepare a child substep for execution. Thin wrapper around step_begin ' +
      "that resolves the dynamic child runtime from the parent's planning " +
      'state. Returns the same envelope shape as step_begin (regular ' +
      'composition / parallel / etc). Call this for each substep in the ' +
      'order returned by workflow_invoke_dynamic. Planning-step procedure ' +
      'Step 4 (per substep).',
    inputSchema: {
      type: 'object',
      required: ['parent_workflow', 'parent_step', 'step'],
      properties: {
        parent_workflow: { type: 'string', description: 'Parent workflow name' },
        parent_step: { type: 'string', description: 'Planning step name' },
        step: { type: 'string', description: 'Child substep name to begin' },
      },
    },
  },
  {
    name: 'step_collect_result_dynamic',
    description:
      'After a child substep subagent completes, read the gate-result.json ' +
      'in the dynamic child runtime and determine next action. Thin wrapper ' +
      'around step_collect_result. Planning-step procedure Step 4 (per ' +
      'substep, between begin and complete).',
    inputSchema: {
      type: 'object',
      required: ['parent_workflow', 'parent_step'],
      properties: {
        parent_workflow: { type: 'string', description: 'Parent workflow name' },
        parent_step: { type: 'string', description: 'Planning step name' },
        step: {
          type: 'string',
          description: 'Expected substep name (for staleness check)',
        },
      },
    },
  },
  {
    name: 'step_complete_dynamic',
    description:
      "Mark a child substep as completed. Writes summary to the child's " +
      'context/, applies param_bindings if defined, advances current_step ' +
      'to the next child substep. Thin wrapper around step_complete. ' +
      'Planning-step procedure Step 4 (per substep, on PROCEED).',
    inputSchema: {
      type: 'object',
      required: ['parent_workflow', 'parent_step', 'step', 'summary'],
      properties: {
        parent_workflow: { type: 'string', description: 'Parent workflow name' },
        parent_step: { type: 'string', description: 'Planning step name' },
        step: { type: 'string', description: 'Child substep name to complete' },
        summary: {
          type: 'string',
          description: 'Brief summary of what the substep accomplished',
        },
      },
    },
  },
  {
    name: 'agent_notes_write',
    description:
      'Record a reflection note after a planning-step child workflow ' +
      'finalizes. Engine auto-sets project, date, and version fields. Body ' +
      'is free-form markdown. Pick confidence honestly: high = validated ' +
      'across multiple cases; medium = worked once on this case; low = ' +
      'incomplete or unsure. Planning-step procedure Step 5 (after finalize).',
    inputSchema: {
      type: 'object',
      required: ['step_template', 'topic', 'status', 'confidence', 'run_id', 'body'],
      properties: {
        step_template: {
          type: 'string',
          description: "Planning step name (e.g. 'analyze-and-implement')",
        },
        topic: {
          type: 'string',
          description: "Kebab-case slug summarizing the goal (e.g. 'memory-leak-c++')",
        },
        status: {
          type: 'string',
          enum: ['success', 'partial', 'failed', 'experimental'],
          description: 'Lifecycle outcome of the planning run',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Self-assessed confidence in the recorded experience',
        },
        run_id: {
          type: 'string',
          description: 'Parent (planning) run id — NOT the child run id',
        },
        body: { type: 'string', description: 'Markdown body of the note' },
        generated_workflow_path: {
          type: 'string',
          description: 'Optional: path to the generated child workflow.yaml',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: tags for search filtering',
          default: [],
        },
        related_runs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: related parent run ids for cross-reference',
          default: [],
        },
      },
    },
  },
  {
    name: 'agent_notes_search',
    description:
      'Search reflection notes for a planning step template. Returns ' +
      'summaries (frontmatter subset + absolute path) — NOT full body. Use ' +
      'the path with the Read tool when a match is relevant. Defaults hide ' +
      "noise: status=['success','partial'], confidence=['high','medium'], " +
      'limit=5. Sorted by date desc. Planning-step procedure Step 0 (before ' +
      'drafting).',
    inputSchema: {
      type: 'object',
      required: ['step_template'],
      properties: {
        step_template: {
          type: 'string',
          description: 'Planning step name (scope of search)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tag filter (OR semantics; empty array = no filter)',
        },
        status: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['success', 'partial', 'failed', 'experimental'],
          },
          description: "Status filter (default: ['success', 'partial'])",
        },
        confidence: {
          type: 'array',
          items: { type: 'string', enum: ['high', 'medium', 'low'] },
          description: "Confidence filter (default: ['high', 'medium'])",
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'workflow_learn',
    description:
      'Learn about workflow system capabilities. Returns knowledge content ' +
      'for the requested topic. Call with topic="overview" for a summary of ' +
      'all capabilities, or a specific topic for details. Available topics: ' +
      `${AVAILABLE_TOPICS.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: `Topic to learn about. Default: "overview". Options: ${AVAILABLE_TOPICS.join(', ')}.`,
          default: 'overview',
        },
      },
    },
  },
  {
    name: 'workflow_replan_dynamic',
    description:
      'Reset a planning step for iterative improvement. After a child workflow ' +
      'is finalized but the result is not satisfactory (semantic gate), call this ' +
      'to reset planning.phase back to "planning" so you can draft a new fix ' +
      'workflow. Archives previous child_run_id, increments attempts counter. ' +
      'Precondition: phase must be "completed" or "failed".',
    inputSchema: {
      type: 'object',
      required: ['parent_workflow', 'parent_step'],
      properties: {
        parent_workflow: {
          type: 'string',
          description: 'Name of the parent workflow containing the planning step.',
        },
        parent_step: {
          type: 'string',
          description: 'Name of the planning step to replan.',
        },
      },
    },
  },
  {
    name: 'inbox',
    description:
      'The run inbox — human gate / loop / route questions delivered OUTSIDE the ' +
      "terminal, op-polymorphic (the spec_write model). Lifecycle: op:'rules' " +
      'returns the message-composition rules and UNLOCKS posting for the current pass ' +
      "(asking without a fresh rules fetch is refused, even a valid one); op:'ask' is " +
      'the PREFERRED way to ask — ONE call that validates + stores the message, delivers ' +
      'it on every channel (inbox UI, webhook, and the terminal via a native host dialog ' +
      'when the host supports it), HOLDS the call open until the answer arrives, records ' +
      "it, and returns it. The lower-level ops remain: op:'post' stores without holding; " +
      "op:'check' polls for the answer (bounded wait_ms); op:'respond' records an answer " +
      'the orchestrator heard in the terminal (via is stamped "terminal"; web/API answers ' +
      'arrive through the Local API). Never answer for the user and never invent options ' +
      'a message does not carry.',
    inputSchema: {
      type: 'object',
      required: ['op', 'name'],
      properties: {
        op: {
          type: 'string',
          enum: ['rules', 'ask', 'post', 'check', 'respond'],
          description:
            "The operation: rules (fetch composition rules; unlocks posting this pass) | " +
            'ask (store + deliver everywhere + HOLD until answered — preferred) | ' +
            'post (store a validated message) | check (poll for the answer) | respond ' +
            '(record a terminal answer).',
        },
        name: { type: 'string', description: 'Workflow name (the current run).' },
        step: {
          type: 'string',
          description: "The step the message belongs to (rules + post).",
        },
        message: {
          type: 'object',
          description:
            "ask + post. Message content: { title (short), body? (markdown), kind? " +
            '(human_gate | loop_decision | route_decision | info; default human_gate), ' +
            'request? { action, args?, choices?, recommended? }, options? { accept?, reject?, respond?, ' +
            'edit? }, items? [{ id, title, body?, options?, request? }] }. Single form: at ' +
            'least one response kind must be allowed (offered choices allow a pick on their ' +
            'own; options.respond adds free text, valid alongside choices). Grouped form: ' +
            'items (2+ questions) replaces top-level options/request; each item allows >=1 ' +
            'kind. ONE question is never a group.',
        },
        message_id: {
          type: 'string',
          description:
            "The id op:'ask'/op:'post' returned (check + respond; on ask it RESUMES the " +
            'hold on an already-posted message instead of posting a new one).',
        },
        wait_ms: {
          type: 'integer',
          minimum: 0,
          maximum: 15000,
          description: 'check only. Optional bounded server-side wait for the response.',
        },
        type: {
          type: 'string',
          enum: ['accept', 'reject', 'choice', 'respond', 'edit', 'items'],
          description:
            'respond only. The response kind the user chose: "choice" picks one offered ' +
            'entry (text = the entry), "respond" is free text, "items" answers a grouped ' +
            'message.',
        },
        text: {
          type: 'string',
          description:
            "respond only. The user's words (the picked entry for choice; required for " +
            'respond/edit unless args given).',
        },
        args: { type: 'object', description: 'respond only. Edited request args (edit responses).' },
        items: {
          type: 'object',
          description:
            'respond only. Grouped answers keyed by item id: { <id>: { type, text?, args? }, ' +
            '... } — every item of the message, in one call.',
        },
      },
    },
  },
  {
    name: 'spec_write',
    description:
      'Author/commit/delete a behavioral spec. The engine owns identity (mints ' +
      '<domain>-<NNN>), validates against the canonical schema, and derives the ' +
      '_index.json entry — never write _index/_registry by hand. On create, supply ' +
      'the spec markdown (frontmatter WITHOUT spec_id/scope/created_at/updated_at — ' +
      'those are engine-set — plus the required sections) via content. Use ' +
      'dry_run:true to validate without writing. On a dedup hit the tool returns ' +
      'candidates instead of creating. Use op:create_batch (see the drafts arg) to ' +
      'bulk-author many mutually-referencing specs in one call.',
    inputSchema: {
      type: 'object',
      required: ['op'],
      properties: {
        op: {
          type: 'string',
          enum: ['create', 'create_batch', 'update', 'delete', 'move', 'rename_domain'],
          description:
            'create (new spec) · create_batch (bulk create N mutually-ref specs — see drafts) · ' +
            'update (existing by spec_id) · delete (remove) · move (relocate spec(s) to another ' +
            'domain/scope — new id minted; engine cascades index+registry+same-scope related_specs ' +
            'and warns on prose/cross-scope refs; see to_domain/to_scope/spec_ids) · rename_domain ' +
            '(rename a domain = batch-move all its specs into new_domain).',
        },
        scope: {
          type: 'string',
          description:
            'Target scope (the spec lives here). Agent DECIDES it here (generic vs ' +
            'active); default = active scope. Engine writes it into the frontmatter.',
        },
        content: {
          type: 'string',
          description: 'Spec markdown (frontmatter + body). For create/update unless draft_path.',
        },
        draft_path: { type: 'string', description: 'Alternative to content: path to a draft .md.' },
        spec_id: { type: 'string', description: 'Required for update/delete: which spec.' },
        dry_run: {
          type: 'boolean',
          description: 'Validate (+ dedup) without minting or writing.',
          default: false,
        },
        acknowledge_distinct: {
          type: 'boolean',
          description:
            'Override a near-certain dedup HOLD: set true to create anyway when your spec is ' +
            'genuinely distinct from the flagged match (recorded for audit). The create-with-ack ' +
            'path of the 3-way resolution (the others: abandon = do nothing; op:update the match).',
          default: false,
        },
        acknowledge_single_rule: {
          type: 'boolean',
          description:
            'Override a multi_rule HOLD (Rule Statement structurally flagged as an enumerated ' +
            'list of 2+ obligations): set true to create anyway when it is genuinely ONE rule ' +
            '(recorded for audit). Otherwise split into one spec per obligation and re-submit.',
          default: false,
        },
        set_domain_description: {
          type: 'boolean',
          description:
            "op:update only — overwrite the target domain's description in _index with the " +
            'domain_description from the frontmatter of THE SPEC BEING UPDATED (spec_id). Requires a ' +
            'non-empty domain_description (else error). Default false (leave it untouched, no thrash). ' +
            'The only sanctioned way to change an existing domain description (manual _index edits are blocked).',
          default: false,
        },
        drafts: {
          type: 'array',
          description:
            'For op:create_batch ONLY — bulk-author N mutually-referencing specs in one call. Each ' +
            'item: {path (draft .md), temp_key (batch-unique cross-ref key, NOT a spec_id), ' +
            'related_by_temp_key? (temp_keys of OTHER drafts in this batch it references)}. The engine ' +
            'mints all ids, resolves intra-batch cross-refs, dedups the whole set, and writes ALL ' +
            'atomically — or writes NOTHING and returns per-draft verdicts if any is flagged ' +
            '(all-or-nothing; fix the flagged drafts and re-submit the WHOLE batch). Refs to ' +
            'already-existing / cross-scope specs go in the draft frontmatter.related_specs, NOT here.',
          items: {
            type: 'object',
            required: ['path', 'temp_key'],
            properties: {
              path: { type: 'string', description: 'Path to the draft .md (frontmatter + body).' },
              temp_key: {
                type: 'string',
                description: 'Batch-unique cross-ref key (NOT a spec_id).',
              },
              related_by_temp_key: {
                type: 'array',
                items: { type: 'string' },
                description: 'temp_keys of OTHER drafts in this batch that this draft references.',
              },
            },
          },
        },
        acknowledge_distinct_temp_keys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'For op:create_batch — temp_keys you assert are distinct despite a near-certain dedup ' +
            'match (per-draft create-with-ack). Include them in the re-submitted batch payload.',
        },
        acknowledge_single_rule_temp_keys: {
          type: 'array',
          items: { type: 'string' },
          description:
            'For op:create_batch — temp_keys you assert are genuinely ONE rule despite the ' +
            'multi_rule structural flag (per-draft override, recorded for audit). Include them ' +
            'in the re-submitted batch payload.',
        },
        to_domain: {
          type: 'string',
          description:
            'For op:move — destination domain the spec(s) move into. If new in the destination ' +
            'scope, to_domain_description is required.',
        },
        to_scope: {
          type: 'string',
          description: 'For op:move — destination scope (cross-scope move). Default: source scope.',
        },
        to_domain_description: {
          type: 'string',
          description: 'For op:move — one-line description; required iff to_domain is a NEW domain.',
        },
        spec_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'For op:move — batch relocate several specs together (all-or-nothing). Use spec_id for a ' +
            'single spec.',
        },
        domain: {
          type: 'string',
          description: 'For op:rename_domain — the existing domain to rename.',
        },
        new_domain: {
          type: 'string',
          description:
            'For op:rename_domain — the new name (must NOT already exist — that would be a merge).',
        },
      },
    },
  },
  {
    name: 'spec_search',
    description:
      'Deterministic query over the spec _index (NOT embeddings — you are the ' +
      'semantic layer above it). Returns { results, domains }: results = matching ' +
      'spec SUMMARIES (spec_id/title/summary/domain/applies_to/path — Read the ' +
      'chosen path directly); domains = the whole scope landscape (name + ' +
      'description), ALWAYS present. Not sure which specs apply? Read `domains`, ' +
      'then call again with domain:<name> for that domain\'s complete spec-set — ' +
      'the `domain` filter is the RELIABLE path (exact/prefix), while `query` ' +
      '(title+summary substring) and `applies_to` (exact set-membership, not glob) ' +
      'are recall-limited. All params are optional (spec_search({}) is valid); a ' +
      'first call need NOT know a domain — the returned `domains` unlock the ' +
      'domain-filtered follow-up. Filters are AND-combined; default scope = active + generic.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring over title + summary.' },
        domain: { type: 'string', description: 'Exact or prefix match on domain.' },
        applies_to: {
          type: 'array',
          items: { type: 'string' },
          description: 'Match specs whose applies_to overlaps any of these.',
        },
        scope: {
          type: 'string',
          description: 'Restrict to one scope; default = active + generic.',
        },
      },
    },
  },
  {
    name: 'spec_link',
    description:
      'Maintain _registry.json (spec → implementing files). Call at IMPLEMENTATION ' +
      'time when code satisfies a spec. add appends a {file, role} mapping; remove ' +
      'requires a reason and warns with provenance (no silent removal). Remove only ' +
      'if YOUR change is the cause; flag a suspected pre-existing wrong mapping, do ' +
      'not remove it.',
    inputSchema: {
      type: 'object',
      required: ['spec_id', 'op', 'file'],
      properties: {
        spec_id: { type: 'string', description: 'The spec to link.' },
        scope: { type: 'string', description: 'Scope of the spec; default = active.' },
        op: { type: 'string', enum: ['add', 'remove'] },
        file: { type: 'string', description: 'Source file path (project-root-relative).' },
        role: {
          type: 'string',
          enum: ['implements', 'configures', 'verifies', 'uses', 'affects'],
          description:
            'Required for add. implements=produces behavior (verify ALL) · configures=sets ' +
            'constrained values · verifies=tests it · uses=consumes the contract · ' +
            'affects=indirect dependency (re-verify on change).',
        },
        reason: { type: 'string', description: 'Required for remove.' },
        note: { type: 'string', description: 'Optional free-text specifics (add).' },
      },
    },
  },
];


export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

function specWriteDispatch(args: Record<string, unknown>): unknown {
  if (args.op === 'create_batch') return toolSpecCreateBatch(args as unknown as SpecBatchArgs);
  if (args.op === 'move' || args.op === 'rename_domain')
    return toolSpecMove(args as unknown as SpecMoveArgs);
  return toolSpecWrite(args as unknown as SpecWriteArgs);
}

export const TOOL_HANDLERS: ReadonlyMap<string, ToolHandler> = new Map<string, ToolHandler>([
  ['workflow_resolve', toolWorkflowResolve as unknown as ToolHandler],
  ['workflow_init', toolWorkflowInit as unknown as ToolHandler],
  ['workflow_resume', toolWorkflowResume as unknown as ToolHandler],
  ['step_begin', toolStepBegin as unknown as ToolHandler],
  ['step_collect_result', toolStepCollectResult as unknown as ToolHandler],
  ['step_complete', toolStepComplete as unknown as ToolHandler],
  ['workflow_finalize', toolWorkflowFinalize as unknown as ToolHandler],
  ['list_agent_files', toolListAgentFiles as unknown as ToolHandler],
  ['workflow_validate', toolWorkflowValidate as unknown as ToolHandler],
  ['workflow_validate_dynamic', toolWorkflowValidateDynamic as unknown as ToolHandler],
  ['workflow_invoke_dynamic', toolWorkflowInvokeDynamic as unknown as ToolHandler],
  ['workflow_finalize_dynamic', toolWorkflowFinalizeDynamic as unknown as ToolHandler],
  ['step_begin_dynamic', toolStepBeginDynamic as unknown as ToolHandler],
  ['step_collect_result_dynamic', toolStepCollectResultDynamic as unknown as ToolHandler],
  ['step_complete_dynamic', toolStepCompleteDynamic as unknown as ToolHandler],
  ['agent_notes_write', toolAgentNotesWrite as unknown as ToolHandler],
  ['agent_notes_search', toolAgentNotesSearch as unknown as ToolHandler],
  ['inbox', toolInbox as unknown as ToolHandler],
  ['workflow_replan_dynamic', toolWorkflowReplanDynamic as unknown as ToolHandler],
  ['workflow_learn', toolWorkflowLearn as unknown as ToolHandler],
  ['spec_write', specWriteDispatch],
  ['spec_search', toolSpecSearch as unknown as ToolHandler],
  ['spec_link', toolSpecLink as unknown as ToolHandler],
]);


export function summarizeCall(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): string {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return '';
  }
  const r = result as Record<string, unknown>;
  try {
    if (toolName === 'workflow_resolve') {
      return `Resolved ${r.name ?? '?'} v${r.version ?? '?'}, ${r.step_count ?? '?'} steps`;
    }
    if (toolName === 'workflow_init') {
      return `Initialized run ${r.run_id ?? '?'}`;
    }
    if (toolName === 'workflow_resume') {
      return `Resumed ${args.name ?? '?'}, step: ${r.current_step ?? '?'}`;
    }
    if (toolName === 'step_begin') {
      const stype = (r.type as string | undefined) ?? 'regular';
      const step = (r.step_name as string | undefined) ?? args.step ?? '?';
      if (stype === 'delegation') {
        return `Delegation ${step} → ${r.delegate_to ?? '?'}`;
      }
      const sub = r.subagent === undefined ? true : r.subagent;
      return `Prepared ${step} (${stype}, subagent: ${sub})`;
    }
    if (toolName === 'step_collect_result') {
      const passed = r.passed;
      const step = (r.step as string | undefined) ?? args.step ?? '?';
      const action = (r.action as string | undefined) ?? '?';
      if (passed === true) return `Gate passed for ${step} → ${action}`;
      if (passed === false) return `Gate failed for ${step} → ${action}`;
      return `${action} for ${step}`;
    }
    if (toolName === 'step_complete') {
      const step = (r.step as string | undefined) ?? args.step ?? '?';
      const nxt = r.next_step;
      if (r.workflow_done) return `Completed ${step} (workflow done)`;
      return `Completed ${step}, next: ${nxt}`;
    }
    if (toolName === 'workflow_finalize') {
      return `Finalized ${r.workflow ?? '?'}, status: ${r.status ?? '?'}`;
    }
    if (toolName === 'list_agent_files') {
      return `Listed ${r.count ?? '?'} files`;
    }
    if (toolName === 'workflow_validate_dynamic') {
      if ('error' in r) {
        const action = r.action as string | undefined;
        return action === 'BLOCKED_PLANNING_FAILURE'
          ? `Planning blocked: attempts exhausted for ${args.parent_step ?? '?'}`
          : `Validate failed: ${r.error}`;
      }
      const ctx = `${args.parent_workflow ?? '?'}/${args.parent_step ?? '?'}`;
      const attempts = r.attempts ?? '?';
      if (r.ok === true) {
        return `Validated draft for ${ctx} (attempts=${attempts}, ok)`;
      }
      const errs = Array.isArray(r.errors) ? (r.errors as unknown[]) : [];
      const errCount = errs.length;
      const firstErr = typeof errs[0] === 'string' ? (errs[0] as string).slice(0, 120) : '';
      return firstErr
        ? `Validated draft for ${ctx} (attempts=${attempts}, ${errCount} errors: ${firstErr})`
        : `Validated draft for ${ctx} (attempts=${attempts}, ${errCount} errors)`;
    }
    if (toolName === 'workflow_invoke_dynamic') {
      if ('error' in r) return `Invoke failed: ${r.error}`;
      return `Invoked dynamic child ${r.child_run_id ?? '?'} for ${args.parent_workflow ?? '?'}/${args.parent_step ?? '?'}`;
    }
    if (toolName === 'workflow_finalize_dynamic') {
      if ('error' in r) return `Finalize-dynamic failed: ${r.error}`;
      return `Finalized child ${r.child_run_id ?? '?'}, child status: ${r.child_status ?? '?'}, parent phase: ${r.parent_planning_phase ?? '?'}`;
    }
    if (toolName === 'step_begin_dynamic') {
      if ('error' in r) return `Begin-dynamic failed: ${r.error}`;
      return `Prepared dynamic substep ${args.step ?? '?'} for ${args.parent_workflow ?? '?'}/${args.parent_step ?? '?'}`;
    }
    if (toolName === 'step_collect_result_dynamic') {
      if ('error' in r) return `Collect-dynamic failed: ${r.error}`;
      const action = (r.action as string | undefined) ?? '?';
      return `Dynamic substep ${args.step ?? '?'} → ${action}`;
    }
    if (toolName === 'step_complete_dynamic') {
      if ('error' in r) return `Complete-dynamic failed: ${r.error}`;
      return `Completed dynamic substep ${args.step ?? '?'}, next: ${r.next_step ?? '(end)'}`;
    }
    if (toolName === 'agent_notes_write') {
      if ('error' in r) return `Notes write failed: ${r.error}`;
      return `Wrote note ${r.filename ?? '?'} for template ${args.step_template ?? '?'}`;
    }
    if (toolName === 'agent_notes_search') {
      if ('error' in r) return `Notes search failed: ${r.error}`;
      const matches = (r.matches as ReadonlyArray<unknown> | undefined)?.length ?? 0;
      return `Searched ${args.step_template ?? '?'}: ${matches}/${r.total_before_limit ?? '?'} matches`;
    }
    if (toolName === 'workflow_replan_dynamic') {
      if ('error' in r) return `Replan failed: ${r.error}`;
      return `Reset planning phase for ${args.parent_step ?? '?'}, attempt ${r.attempt ?? '?'}, ${((r.previous_runs as unknown[]) ?? []).length} prior run(s)`;
    }
    if (toolName === 'workflow_learn') {
      if ('error' in r) return `Learn failed: ${r.error}`;
      return `Topic: ${args.topic ?? 'overview'}`;
    }
    if (toolName === 'workflow_validate') {
      if ('error' in r) return `Validate failed: ${r.error}`;
      const errs = Array.isArray(r.errors) ? (r.errors as unknown[]) : [];
      const wfName = args.workflow_name ?? '(unnamed draft)';
      if (r.ok) return `Validated ${wfName} — ok`;
      return `Validated ${wfName} — ${errs.length} error(s)`;
    }
  } catch {
  }
  return '';
}


export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result: Record<string, unknown>;
}

export interface JsonRpcError {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly error: { readonly code: number; readonly message: string };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export function makeResponse(
  msgId: string | number | null,
  result: Record<string, unknown>,
): JsonRpcSuccess {
  return { jsonrpc: '2.0', id: msgId, result };
}

export function makeError(
  msgId: string | number | null,
  code: number,
  message: string,
): JsonRpcError {
  return { jsonrpc: '2.0', id: msgId, error: { code, message } };
}



export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0] as string;

let negotiatedProtocolVersion: string = LATEST_PROTOCOL_VERSION;
let clientCapabilities: Record<string, unknown> = {};

export function getNegotiatedProtocolVersion(): string {
  return negotiatedProtocolVersion;
}
export function getClientCapabilities(): Record<string, unknown> {
  return clientCapabilities;
}
export function _resetConnectionState(): void {
  negotiatedProtocolVersion = LATEST_PROTOCOL_VERSION;
  clientCapabilities = {};
}

interface PendingOutgoing {
  resolve(value: unknown): void;
  reject(reason: Error): void;
}
const pendingOutgoing = new Map<string, PendingOutgoing>();
let outgoingSeq = 0;

export function routeIncomingResponse(msg: {
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}): boolean {
  const key = typeof msg.id === 'string' || typeof msg.id === 'number' ? String(msg.id) : null;
  if (key === null) return false;
  const pending = pendingOutgoing.get(key);
  if (!pending) return false;
  pendingOutgoing.delete(key);
  if (msg.error) {
    pending.reject(new Error(`client error ${msg.error.code ?? ''}: ${msg.error.message ?? ''}`));
  } else {
    pending.resolve(msg.result);
  }
  return true;
}

export function makeStdioBridge(write: (line: string) => void): HostBridge {
  return {
    sendRequest(method: string, params: Record<string, unknown>): OutgoingRequest {
      const id = `rl-srv-${++outgoingSeq}`;
      let settle: PendingOutgoing | null = null;
      const result = new Promise<unknown>((resolve, reject) => {
        settle = { resolve, reject };
      });
      pendingOutgoing.set(id, settle as unknown as PendingOutgoing);
      write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      return {
        result,
        cancel(): void {
          if (!pendingOutgoing.has(id)) return;
          pendingOutgoing.delete(id);
          write(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/cancelled',
              params: { requestId: id, reason: 'answered through another channel' },
            }),
          );
          (settle as unknown as PendingOutgoing).reject(new Error('cancelled'));
        },
      };
    },
    sendNotification(method: string, params: Record<string, unknown>): void {
      write(JSON.stringify({ jsonrpc: '2.0', method, params }));
    },
    clientCapabilities(): Record<string, unknown> {
      return clientCapabilities;
    },
    protocolVersion(): string {
      return negotiatedProtocolVersion;
    },
  };
}

export interface DispatchOptions {
  readonly handlers?: ReadonlyMap<string, ToolHandler>;
  readonly tools?: ReadonlyArray<ToolDescriptor>;
  readonly appendMcpCall?: (entry: import('../types/mcp.js').McpCallLogEntry) => void;
}

export async function handleMessage(
  msg: JsonRpcRequest,
  options: DispatchOptions = {},
): Promise<JsonRpcResponse | null> {
  const handlers = options.handlers ?? TOOL_HANDLERS;
  const toolsList = options.tools ?? TOOLS;
  const logCall = options.appendMcpCall ?? appendMcpCall;
  const method = msg.method ?? '';
  const msgId = msg.id ?? null;
  const params = (msg.params ?? {}) as Record<string, unknown>;

  if (method === 'initialize') {
    const requested =
      typeof params.protocolVersion === 'string' ? params.protocolVersion : null;
    const negotiated =
      requested !== null && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
    negotiatedProtocolVersion = negotiated;
    const caps =
      typeof params.capabilities === 'object' &&
      params.capabilities !== null &&
      !Array.isArray(params.capabilities)
        ? (params.capabilities as Record<string, unknown>)
        : {};
    clientCapabilities = caps;
    recordEngineClient(params.clientInfo as ClientInfo | undefined, process.cwd(), log, {
      ...(requested !== null ? { protocolVersion: requested } : {}),
      capabilities: caps,
    });
    return makeResponse(msgId, {
      protocolVersion: negotiated,
      capabilities: { tools: {} },
      serverInfo: { name: 'workflow-engine', version: '1.0.0' },
    });
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  if (method === 'tools/list') {
    return makeResponse(msgId, { tools: toolsList });
  }

  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : '';
    const argsRaw = params.arguments;
    const args =
      typeof argsRaw === 'object' && argsRaw !== null && !Array.isArray(argsRaw)
        ? (argsRaw as Record<string, unknown>)
        : {};

    const handler = handlers.get(toolName);
    if (!handler) {
      return makeResponse(msgId, {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      });
    }

    const callStart = new Date();
    try {
      const result = await Promise.resolve(handler(args));
      const callEnd = new Date();
      const durationMs = Math.max(0, callEnd.getTime() - callStart.getTime());

      const entry: import('../types/mcp.js').McpCallLogEntry = {
        timestamp: toIsoLocal(callStart) as import('../types/branded.js').IsoDateTime,
        tool: toolName,
        duration_ms: durationMs,
        success: true,
        ...buildContextFields(args),
        ...maybeSummary(toolName, args, result),
      };
      logCall(entry);

      const text =
        typeof result === 'object' && result !== null
          ? JSON.stringify(result, null, 2)
          : String(result);
      return makeResponse(msgId, {
        content: [{ type: 'text', text }],
      });
    } catch (e) {
      const callEnd = new Date();
      const durationMs = Math.max(0, callEnd.getTime() - callStart.getTime());

      const errorName = e instanceof Error ? e.constructor.name : e === null ? 'null' : typeof e;
      const errorMsg = e instanceof Error ? e.message : String(e);
      const errorStr = `${errorName}: ${errorMsg}`;

      const entry: import('../types/mcp.js').McpCallLogEntry = {
        timestamp: toIsoLocal(callStart) as import('../types/branded.js').IsoDateTime,
        tool: toolName,
        duration_ms: durationMs,
        success: false,
        error: errorStr,
        ...buildContextFields(args),
      };
      logCall(entry);

      log(`Tool '${toolName}' error: ${errorStr}`);
      return makeResponse(msgId, {
        content: [{ type: 'text', text: `Error: ${errorStr}` }],
        isError: true,
      });
    }
  }

  if (msgId !== null) {
    return makeError(msgId, -32601, `Unknown method: ${method}`);
  }
  return null;
}

function buildContextFields(args: Record<string, unknown>): { workflow?: string; step?: string } {
  const out: { workflow?: string; step?: string } = {};
  const wfName =
    (typeof args.name === 'string' && args.name) ||
    (typeof args.workflow_name === 'string' && args.workflow_name) ||
    (typeof args.parent_workflow === 'string' && args.parent_workflow);
  const step =
    (typeof args.step === 'string' && args.step) ||
    (typeof args.step_name === 'string' && args.step_name) ||
    (typeof args.parent_step === 'string' && args.parent_step);
  if (typeof wfName === 'string' && wfName) out.workflow = wfName;
  if (typeof step === 'string' && step) out.step = step;
  return out;
}

function maybeSummary(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): { summary?: string } {
  if (typeof result !== 'object' || result === null) return {};
  const summary = summarizeCall(toolName, args, result);
  return summary ? { summary } : {};
}


export async function serverLoop(options: DispatchOptions = {}): Promise<void> {
  const write = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  setHostBridge(makeStdioBridge(write));
  const inFlight = new Map<string, AbortController>();
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(line) as JsonRpcRequest;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      log(`Invalid JSON input: ${m}`);
      continue;
    }
    if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
      if (!routeIncomingResponse(msg as Parameters<typeof routeIncomingResponse>[0])) {
        log(`Unmatched response id ${JSON.stringify(msg.id)} — ignored`);
      }
      continue;
    }
    if (msg.method === 'notifications/cancelled') {
      const reqId = (msg.params as { requestId?: unknown } | undefined)?.requestId;
      const key = typeof reqId === 'string' || typeof reqId === 'number' ? String(reqId) : null;
      if (key !== null) inFlight.get(key)?.abort();
      continue;
    }
    const progressToken = (
      (msg.params as { _meta?: { progressToken?: string | number } } | undefined)?._meta ?? {}
    ).progressToken;
    const abort = new AbortController();
    const flightKey = msg.id !== undefined && msg.id !== null ? String(msg.id) : null;
    if (flightKey !== null) inFlight.set(flightKey, abort);
    void runWithCallContext(
      {
        ...(progressToken !== undefined ? { progressToken } : {}),
        signal: abort.signal,
      },
      () => handleMessage(msg, options),
    )
      .then((response) => {
        if (response !== null) write(JSON.stringify(response));
      })
      .catch((e: unknown) => {
        log(`Dispatch error: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        if (flightKey !== null) inFlight.delete(flightKey);
      });
  }
}

export async function runWorkflowEngineCli(options: DispatchOptions = {}): Promise<void> {
  log('Starting workflow-engine MCP server');
  await serverLoop(options);
  log('workflow-engine MCP server shutting down');
}

const __argv1 = process.argv[1];
if (__argv1 !== undefined) {
  let __argv1Real: string;
  let __metaReal: string;
  try {
    __argv1Real = realpathSync(__argv1);
    __metaReal = realpathSync(fileURLToPath(import.meta.url));
  } catch {
    __argv1Real = __argv1;
    __metaReal = fileURLToPath(import.meta.url);
  }
  if (__argv1Real === __metaReal) {
    void runWorkflowEngineCli();
  }
}
