
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ajvNs from 'ajv';
import { lockedJsonReadModifyWrite } from './file-lock.js';
import { toIsoLocal } from './iso-time.js';
import { inboxWebhookUrl } from '../config/config.js';

const Ajv = (ajvNs as unknown as { default: typeof ajvNs.Ajv }).default ?? ajvNs.Ajv;


export type InboxKind = 'human_gate' | 'loop_decision' | 'route_decision' | 'info';
export type ResponseType = 'accept' | 'reject' | 'choice' | 'respond' | 'edit';
export type ResponseVia = 'terminal' | 'web' | 'api' | 'webhook';

export interface InboxOptions {
  readonly accept?: boolean;
  readonly reject?: boolean;
  readonly respond?: boolean;
  readonly edit?: boolean;
}

export interface InboxRequest {
  readonly action: string;
  readonly args?: Record<string, unknown>;
  readonly choices?: readonly string[];
  readonly recommended?: string;
}

export interface InboxItem {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly options?: InboxOptions;
  readonly request?: InboxRequest;
}

export interface InboxMessageContent {
  readonly kind?: InboxKind;
  readonly title: string;
  readonly body?: string;
  readonly request?: InboxRequest;
  readonly options?: InboxOptions;
  readonly items?: readonly InboxItem[];
}

export interface InboxItemResponse {
  readonly type: ResponseType;
  readonly text?: string;
  readonly args?: Record<string, unknown>;
}

export interface InboxResponse {
  readonly type: ResponseType | 'items';
  readonly text?: string;
  readonly args?: Record<string, unknown>;
  readonly items?: Record<string, InboxItemResponse>;
  readonly responded_at: string;
  readonly via: ResponseVia;
}

export interface VerifiedOutput {
  readonly path: string;
  readonly exists: boolean;
  readonly size?: number;
  readonly mtime?: string;
  readonly value_preview?: string | null;
  readonly truncated?: boolean;
  readonly binary?: boolean;
}

export interface InboxMessage extends InboxMessageContent {
  readonly message_id: string;
  readonly run_id: string;
  readonly workflow: string;
  readonly step: string;
  readonly kind: InboxKind;
  readonly created_at: string;
  readonly response: InboxResponse | null;
  readonly respond_token: string;
  readonly delivery?: InboxDelivery;
  readonly superseded_by?: string;
  readonly superseded_at?: string;
  readonly verified_context?: readonly VerifiedOutput[];
}

export type MessageState = 'open' | 'answered' | 'superseded';

export function messageState(
  msg: Pick<InboxMessage, 'response'> & { readonly superseded_by?: string },
): MessageState {
  if (msg.response !== null && msg.response !== undefined) return 'answered';
  if (msg.superseded_by !== undefined) return 'superseded';
  return 'open';
}

export function expectsAnswer(kind: InboxKind): boolean {
  return kind !== 'info';
}

export interface InboxDelivery {
  readonly url: string;
  readonly event: WebhookEvent;
  readonly attempts: number;
  readonly delivered_at?: string;
  readonly last_attempt_at?: string;
  readonly last_error?: string;
  readonly settled: boolean;
}


const OPTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accept: { type: 'boolean' },
    reject: { type: 'boolean' },
    respond: { type: 'boolean' },
    edit: { type: 'boolean' },
  },
} as const;

const REQUEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', minLength: 1, maxLength: 200 },
    args: { type: 'object' },
    choices: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 200 },
      minItems: 1,
      maxItems: 50,
      uniqueItems: true,
    },
    recommended: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

const CONTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    kind: { enum: ['human_gate', 'loop_decision', 'route_decision', 'info'] },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', maxLength: 16384 },
    request: REQUEST_SCHEMA,
    options: OPTIONS_SCHEMA,
    items: {
      type: 'array',
      minItems: 2,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          body: { type: 'string', maxLength: 4096 },
          options: OPTIONS_SCHEMA,
          request: REQUEST_SCHEMA,
        },
      },
    },
  },
} as const;

const ajv = new Ajv({ strict: false, allErrors: true });
const validateContent = ajv.compile(CONTENT_SCHEMA as unknown as Record<string, unknown>);

function hasAnyAllowed(o: InboxOptions | undefined, req: InboxRequest | undefined): boolean {
  return allowedFor(o, req).length > 0;
}

function recommendedError(req: InboxRequest | undefined, label: string): string | null {
  if (req?.recommended === undefined) return null;
  if (!req.choices || req.choices.length === 0) {
    return `${label}: request.recommended suggests one of YOUR predefined answers — it requires request.choices`;
  }
  if (!req.choices.includes(req.recommended)) {
    return `${label}: request.recommended ('${req.recommended}') must be EXACTLY one of request.choices: ${req.choices.join(', ')}`;
  }
  return null;
}

function allowedFor(o: InboxOptions | undefined, req: InboxRequest | undefined): ResponseType[] {
  const out: ResponseType[] = (['accept', 'reject', 'respond', 'edit'] as const).filter(
    (k) => (o ?? {})[k] === true,
  );
  if (req?.choices && req.choices.length > 0) out.unshift('choice');
  return out;
}

export function validateMessageContent(content: unknown): string[] | null {
  const maybeItems = (content as { items?: unknown } | null)?.items;
  if (Array.isArray(maybeItems) && maybeItems.length === 1) {
    return [
      "items: a single question is not a group — carry it in the top-level title/body/request/options; 'items' is for 2+ related questions answered together",
    ];
  }
  if (!validateContent(content)) {
    const errors = (validateContent.errors ?? []).map(
      (e) => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`,
    );
    return errors.length > 0 ? errors : ['invalid message content'];
  }
  const c = content as InboxMessageContent;
  const grouped = Array.isArray(c.items);
  if (grouped && c.options !== undefined) {
    return ["options and items are mutually exclusive — a grouped message carries per-item options; drop the top-level 'options'"];
  }
  if (grouped && c.request !== undefined) {
    return ["request and items are mutually exclusive — a grouped message carries per-item requests; drop the top-level 'request'"];
  }
  if (grouped) {
    const errs: string[] = [];
    const seen = new Set<string>();
    for (const it of c.items as readonly InboxItem[]) {
      if (seen.has(it.id)) errs.push(`items: duplicate id '${it.id}' — item ids must be unique within the message`);
      seen.add(it.id);
      if (!hasAnyAllowed(it.options, it.request)) {
        errs.push(`items['${it.id}']: no response kind is allowed — set at least one of options.accept/reject/respond/edit, or offer request.choices`);
      }
      const rec = recommendedError(it.request, `items['${it.id}']`);
      if (rec) errs.push(rec);
    }
    return errs.length > 0 ? errs : null;
  }
  if (!hasAnyAllowed(c.options, c.request)) {
    return ['options: at least one of accept/reject/respond/edit must be true (offered request.choices allow a pick on their own)'];
  }
  const rec = recommendedError(c.request, 'request');
  return rec ? [rec] : null;
}

export function allowedResponseTypes(msg: InboxMessageContent): ResponseType[] {
  return allowedFor(msg.options, msg.request);
}

export function allowedItemResponseTypes(item: InboxItem): ResponseType[] {
  return allowedFor(item.options, item.request);
}


const MESSAGE_ID_RE = /^msg-\d{8}-\d{6}-[0-9a-f]{4}$/;

export function isValidMessageId(id: string): boolean {
  return MESSAGE_ID_RE.test(id) && !id.includes('/') && !id.includes('\\') && !id.includes('..');
}

function mintMessageId(now: Date): string {
  const p = (n: number, w: number): string => String(n).padStart(w, '0');
  const ts = `${p(now.getFullYear(), 4)}${p(now.getMonth() + 1, 2)}${p(now.getDate(), 2)}-${p(now.getHours(), 2)}${p(now.getMinutes(), 2)}${p(now.getSeconds(), 2)}`;
  return `msg-${ts}-${randomBytes(2).toString('hex')}`;
}

export function inboxDir(runtimeDir: string): string {
  return join(runtimeDir, 'inbox');
}

export function messagePath(runtimeDir: string, messageId: string): string {
  if (!isValidMessageId(messageId)) throw new Error(`Invalid message id '${messageId}'`);
  return join(inboxDir(runtimeDir), `${messageId}.json`);
}

export async function postMessage(
  runtimeDir: string,
  identity: { run_id: string; workflow: string; step: string },
  content: InboxMessageContent,
  opts: {
    respondUrl?: string | null;
    webhookUrl?: string | null;
    stepStartedAt?: string | null;
    verifiedContext?: readonly VerifiedOutput[] | null;
  } = {},
): Promise<{ message: InboxMessage } | { errors: string[] }> {
  const errors = validateMessageContent(content);
  if (errors) return { errors };
  const now = new Date();
  const message: InboxMessage = {
    ...content,
    ...(opts.verifiedContext && opts.verifiedContext.length > 0
      ? { verified_context: opts.verifiedContext }
      : {}),
    kind: content.kind ?? 'human_gate',
    message_id: mintMessageId(now),
    run_id: identity.run_id,
    workflow: identity.workflow,
    step: identity.step,
    created_at: toIsoLocal(now),
    response: null,
    respond_token: randomBytes(16).toString('hex'),
  };
  mkdirSync(inboxDir(runtimeDir), { recursive: true });
  const written = await lockedJsonReadModifyWrite<InboxMessage>(
    messagePath(runtimeDir, message.message_id),
    () => message,
    message,
  );
  if (written === null) return { errors: ['inbox store is locked — try again'] };
  await supersedeEarlierPasses(runtimeDir, message, opts.stepStartedAt ?? null, opts);
  const delivery = await pushInboxEvent(runtimeDir, message, 'question', opts);
  return { message: delivery ? { ...message, delivery } : message };
}

async function supersedeEarlierPasses(
  runtimeDir: string,
  fresh: InboxMessage,
  stepStartedAt: string | null,
  opts: { respondUrl?: string | null; webhookUrl?: string | null } = {},
): Promise<void> {
  if (!stepStartedAt) return;
  const boundary = Date.parse(stepStartedAt);
  if (Number.isNaN(boundary)) return;
  for (const m of listMessages(runtimeDir)) {
    if (m.step !== fresh.step || m.kind !== fresh.kind) continue;
    if (m.message_id === fresh.message_id) continue;
    if (m.response !== null || m.superseded_by !== undefined) continue;
    if (Date.parse(m.created_at) >= boundary) continue;
    const retired = await lockedJsonReadModifyWrite<InboxMessage>(
      messagePath(runtimeDir, m.message_id),
      (c) => ({ ...c, superseded_by: fresh.message_id, superseded_at: toIsoLocal() }),
      m,
    );
    if (retired !== null) await pushInboxEvent(runtimeDir, retired, 'superseded', opts);
  }
}

export type PublicInboxMessage = Omit<InboxMessage, 'respond_token' | 'delivery'>;

export function publicMessage(msg: InboxMessage): PublicInboxMessage {
  const { respond_token: _t, delivery: _d, ...rest } = msg;
  return rest;
}

export function readMessage(runtimeDir: string, messageId: string): InboxMessage | null {
  try {
    return JSON.parse(readFileSync(messagePath(runtimeDir, messageId), 'utf-8')) as InboxMessage;
  } catch {
    return null;
  }
}

export function listMessages(runtimeDir: string): InboxMessage[] {
  let names: string[] = [];
  try {
    names = readdirSync(inboxDir(runtimeDir)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: InboxMessage[] = [];
  for (const n of names.sort()) {
    const id = n.slice(0, -'.json'.length);
    if (!isValidMessageId(id)) continue;
    const m = readMessage(runtimeDir, id);
    if (m) out.push(m);
  }
  return out;
}

export async function respondMessage(
  runtimeDir: string,
  messageId: string,
  response: {
    type: string;
    text?: string;
    args?: Record<string, unknown>;
    items?: Record<string, { type: string; text?: string; args?: Record<string, unknown> }>;
  },
  via: ResponseVia,
  opts: { webhookUrl?: string | null; respondUrl?: string | null } = {},
): Promise<{ message: InboxMessage } | { error: string }> {
  if (!isValidMessageId(messageId)) return { error: `Invalid message id '${messageId}'` };
  const existing = readMessage(runtimeDir, messageId);
  if (!existing) return { error: `Unknown message '${messageId}'` };
  if (messageState(existing) === 'superseded') {
    return {
      error:
        `Message '${messageId}' was superseded by '${existing.superseded_by}': its step asked ` +
        `again (the run continued after a stop), so an answer here would be recorded and then ` +
        `ignored. Answer '${existing.superseded_by}' instead.`,
    };
  }

  const grouped = Array.isArray(existing.items) && existing.items.length > 0;
  let record: InboxResponse;

  if (grouped) {
    if (response.type !== 'items' || typeof response.items !== 'object' || response.items === null) {
      const ids = (existing.items as readonly InboxItem[]).map((i) => i.id).join(', ');
      return { error: `This message groups several questions — answer them together: { type: "items", items: { ${ids ? `${ids.split(', ')[0]}: {type, text?}, …` : ''} } } covering every item (${ids}).` };
    }
    const answers = response.items;
    const cleanItems: Record<string, InboxItemResponse> = {};
    for (const it of existing.items as readonly InboxItem[]) {
      const a = answers[it.id];
      if (!a || typeof a.type !== 'string') {
        return { error: `Missing answer for item '${it.id}' — a grouped message is answered in full, every item at once` };
      }
      const err = validateSingleAnswer(a, allowedItemResponseTypes(it), it.request?.choices, `item '${it.id}'`);
      if (err) return { error: err };
      cleanItems[it.id] = {
        type: a.type as ResponseType,
        ...(a.text !== undefined ? { text: a.text } : {}),
        ...(a.args !== undefined ? { args: a.args } : {}),
      };
    }
    for (const key of Object.keys(answers)) {
      if (!(existing.items as readonly InboxItem[]).some((i) => i.id === key)) {
        return { error: `Unknown item id '${key}' in the answer — this message's items are: ${(existing.items as readonly InboxItem[]).map((i) => i.id).join(', ')}` };
      }
    }
    record = { type: 'items', items: cleanItems, responded_at: toIsoLocal(), via };
  } else {
    const err = validateSingleAnswer(response, allowedResponseTypes(existing), existing.request?.choices, 'this message');
    if (err) return { error: err };
    record = {
      type: response.type as ResponseType,
      ...(response.text !== undefined ? { text: response.text } : {}),
      ...(response.args !== undefined ? { args: response.args } : {}),
      responded_at: toIsoLocal(),
      via,
    };
  }

  let conflict = false;
  const updated = await lockedJsonReadModifyWrite<InboxMessage>(
    messagePath(runtimeDir, messageId),
    (current) => {
      if (current.response) {
        conflict = true;
        return current;
      }
      return { ...current, response: record };
    },
    existing,
  );
  if (updated === null) return { error: 'inbox store is locked — try again' };
  if (conflict) return { error: `Message '${messageId}' already has a response` };
  await pushInboxEvent(runtimeDir, updated, 'answered', opts);
  return { message: updated };
}

function validateSingleAnswer(
  a: { type: string; text?: string; args?: Record<string, unknown> },
  allowed: ResponseType[],
  choices: readonly string[] | undefined,
  label: string,
): string | null {
  const type = a.type as ResponseType;
  if (!allowed.includes(type)) {
    return `Response type '${a.type}' is not allowed for ${label} — allowed: ${allowed.join(', ')}`;
  }
  if (type === 'choice') {
    if (typeof a.text !== 'string' || !choices || !choices.includes(a.text)) {
      return `The choice for ${label} must be one of the offered entries: ${(choices ?? []).join(', ')}`;
    }
  }
  if ((type === 'respond' || type === 'edit') && !a.text && !a.args) {
    return `Response type '${type}' for ${label} needs text and/or args`;
  }
  return null;
}

export function findStepMessage(
  runtimeDir: string,
  step: string,
  kind: InboxKind = 'human_gate',
): InboxMessage | null {
  const all = findStepMessages(runtimeDir, step, kind);
  return all.length > 0 ? (all[all.length - 1] as InboxMessage) : null;
}

export function findStepMessages(
  runtimeDir: string,
  step: string,
  kind: InboxKind = 'human_gate',
): InboxMessage[] {
  return listMessages(runtimeDir).filter((m) => m.step === step && m.kind === kind);
}


interface TerminalEntry {
  readonly label: string;
  readonly answer: string;
}

function entriesFor(o: InboxOptions | undefined, req: InboxRequest | undefined): TerminalEntry[] {
  const out: TerminalEntry[] = [];
  if (o?.accept === true) out.push({ label: 'Approve', answer: "type:'accept'" });
  if (o?.reject === true) out.push({ label: 'Refuse', answer: "type:'reject'" });
  for (const c of req?.choices ?? []) {
    out.push({
      label: c === req?.recommended ? `${c}   (recommended)` : c,
      answer: `type:'choice', text:'${c.replace(/'/g, "\\'")}'`,
    });
  }
  if (o?.respond === true) {
    out.push({ label: '(free answer — the user writes it)', answer: "type:'respond', text:<their words>" });
  }
  if (o?.edit === true) {
    out.push({ label: '(edit the proposed args)', answer: "type:'edit', args:<their edited object>" });
  }
  return out;
}

export function composeTerminalPresentation(msg: InboxMessage): string {
  const lines: string[] = [
    'PRESENT THIS QUESTION IN THE TERMINAL AS PLAIN TEXT — verbatim, exactly',
    'these entries, nothing added (no "wait", no "simulate", no options of',
    'your own). NEVER use a blocking prompt/questionnaire widget: while it',
    'waits you cannot see an answer arriving through another channel, and',
    'widgets inject entries of their own.',
    '',
    `  ${msg.title}`,
  ];
  if (msg.body) lines.push(`  ${msg.body}`);
  if (msg.verified_context && msg.verified_context.length > 0) {
    lines.push('', '  VERIFIED FROM DISK (engine-read, not composed by the agent):');
    for (const v of msg.verified_context) {
      if (!v.exists) {
        lines.push(`  · ${v.path} — not written yet`);
        continue;
      }
      const meta = [v.mtime ? `written ${v.mtime}` : null, v.binary ? 'binary' : null]
        .filter(Boolean)
        .join(', ');
      lines.push(`  · ${v.path}${meta ? ` (${meta})` : ''}:`);
      if (typeof v.value_preview === 'string' && v.value_preview.length > 0) {
        for (const pl of v.value_preview.split('\n')) lines.push(`      ${pl}`);
        if (v.truncated) lines.push('      … (truncated)');
      }
    }
  }
  const grouped = Array.isArray(msg.items) && msg.items.length > 0;
  if (grouped) {
    const answerParts: string[] = [];
    for (const it of msg.items as readonly InboxItem[]) {
      lines.push('', `  — ${it.title}${it.body ? ` (${it.body})` : ''}   [item '${it.id}']`);
      const entries = entriesFor(it.options, it.request);
      entries.forEach((e, i) => lines.push(`    ${i + 1}. ${e.label}`));
      answerParts.push(`${it.id}: {<their pick: ${entries.map((e) => `{${e.answer}}`).join(' | ')}>}`);
    }
    lines.push(
      '',
      'The user answers EVERY item, then record ALL answers in ONE call:',
      `  inbox(op:'respond', name: '${msg.workflow}', message_id: '${msg.message_id}', type: 'items',`,
      `    items: { ${answerParts.join(', ')} })`,
    );
  } else {
    const entries = entriesFor(msg.options, msg.request);
    lines.push('');
    entries.forEach((e, i) => lines.push(`  ${i + 1}. ${e.label}`));
    lines.push(
      '',
      'Their pick maps mechanically to the recorded answer:',
      ...entries.map(
        (e, i) =>
          `  ${i + 1} → inbox(op:'respond', name: '${msg.workflow}', message_id: '${msg.message_id}', ${e.answer})`,
      ),
    );
  }
  lines.push(
    '',
    'Present the entries exactly as listed — never preselect, and add no',
    'recommendation of your own (a suggestion travels only through',
    "request.recommended and is already rendered in its entry): the pick is",
    "the user's alone. Record only an answer",
    'that maps to an entry above; if their words fit none, repeat the',
    'entries or post a follow-up message that allows free text.',
    'A terminal answer reaches the store ONLY through the respond call',
    "above — op:'check' never reports an answer you did not record.",
    'If the user answers through another channel first, that answer wins —',
    'a message answers exactly once.',
  );
  return lines.join('\n');
}


export interface ElicitationForm {
  readonly message: string;
  readonly requestedSchema: Record<string, unknown>;
}

function enumFieldFor(
  o: InboxOptions | undefined,
  req: InboxRequest | undefined,
  title: string,
): Record<string, unknown> | null {
  const verdicts = (['accept', 'reject'] as const).filter((k) => o?.[k] === true);
  if (req?.choices && req.choices.length > 0) {
    return {
      type: 'string',
      enum: [...req.choices, ...verdicts],
      description:
        title + (req.recommended !== undefined ? ` (recommended: ${req.recommended})` : ''),
    };
  }
  if (verdicts.length > 0) {
    return { type: 'string', enum: verdicts, description: title };
  }
  return null;
}

export function composeElicitation(msg: InboxMessage): ElicitationForm {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const grouped = Array.isArray(msg.items) && msg.items.length > 0;
  if (grouped) {
    for (const it of msg.items as readonly InboxItem[]) {
      const label = it.body ? `${it.title} — ${it.body}` : it.title;
      const enumField = enumFieldFor(it.options, it.request, label);
      const wantsText = it.options?.respond === true || it.options?.edit === true;
      if (enumField) {
        properties[it.id] = enumField;
        if (!wantsText) required.push(it.id);
        if (wantsText) {
          properties[`${it.id}_text`] = {
            type: 'string',
            description: `${it.title} — free-text answer (instead of picking above)`,
          };
        }
      } else {
        properties[it.id] = {
          type: 'string',
          description:
            it.options?.edit === true && it.options?.respond !== true
              ? `${label} — edited args as JSON`
              : label,
        };
        required.push(it.id);
      }
    }
  } else {
    const enumField = enumFieldFor(msg.options, msg.request, msg.request?.action ?? 'Your answer');
    const wantsRespond = msg.options?.respond === true;
    const wantsEdit = msg.options?.edit === true;
    if (enumField) properties.answer = enumField;
    if (wantsRespond) {
      properties.response = {
        type: 'string',
        description: enumField ? 'Free-text answer (instead of picking above)' : 'Your answer',
      };
    }
    if (wantsEdit) {
      properties.edit = { type: 'string', description: 'Edited args as JSON' };
    }
    if (Object.keys(properties).length === 1) required.push(Object.keys(properties)[0] as string);
  }
  return {
    message:
      msg.title +
      (msg.body ? `\n\n${msg.body}` : '') +
      (grouped ? '\n\nAnswer every question.' : '') +
      '\n\n(You can answer in the run inbox instead — the first answer wins. ' +
      'This form is then withdrawn; if your harness still shows it, it is ' +
      'inert and safe to dismiss.)',
    requestedSchema: { type: 'object', properties, required },
  };
}

type MappedResponse = {
  type: string;
  text?: string;
  args?: Record<string, unknown>;
  items?: Record<string, { type: string; text?: string; args?: Record<string, unknown> }>;
};

function mapSingle(
  o: InboxOptions | undefined,
  req: InboxRequest | undefined,
  picked: unknown,
  text: unknown,
  edited: unknown,
): { type: string; text?: string; args?: Record<string, unknown> } | null {
  if (typeof picked === 'string' && picked.length > 0) {
    if (picked === 'accept' || picked === 'reject') {
      if (o?.[picked] === true) return { type: picked };
    }
    if (req?.choices?.includes(picked)) return { type: 'choice', text: picked };
  }
  if (typeof text === 'string' && text.trim().length > 0 && o?.respond === true) {
    return { type: 'respond', text: text.trim() };
  }
  if (typeof edited === 'string' && edited.trim().length > 0 && o?.edit === true) {
    try {
      const parsed: unknown = JSON.parse(edited);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { type: 'edit', args: parsed as Record<string, unknown> };
      }
    } catch {
    }
    return { type: 'edit', text: edited.trim() };
  }
  return null;
}

export function mapElicitationContent(
  msg: InboxMessage,
  content: Record<string, unknown>,
): { response: MappedResponse } | { error: string } {
  const grouped = Array.isArray(msg.items) && msg.items.length > 0;
  if (!grouped) {
    const mapped = mapSingle(
      msg.options,
      msg.request,
      content.answer,
      content.response,
      content.edit,
    );
    return mapped
      ? { response: mapped }
      : { error: 'no usable answer in the submission — pick an entry or write a response' };
  }
  const items: Record<string, { type: string; text?: string; args?: Record<string, unknown> }> =
    {};
  for (const it of msg.items as readonly InboxItem[]) {
    const raw = content[it.id];
    const textAlt = content[`${it.id}_text`];
    const hasEnum = enumFieldFor(it.options, it.request, it.title) !== null;
    const mapped = hasEnum
      ? mapSingle(it.options, it.request, raw, textAlt, textAlt)
      : mapSingle(it.options, it.request, undefined, raw, raw);
    if (!mapped) return { error: `missing or unusable answer for item '${it.id}'` };
    items[it.id] = mapped;
  }
  return { response: { type: 'items', items } };
}


export type WebhookEvent = 'question' | 'answered' | 'superseded';

function eventForState(state: MessageState): WebhookEvent {
  if (state === 'answered') return 'answered';
  if (state === 'superseded') return 'superseded';
  return 'question';
}

export interface WebhookEnvelope {
  readonly event: WebhookEvent;
  readonly message: PublicInboxMessage;
  readonly respond?: {
    readonly url: string;
    readonly token: string;
    readonly body: { run: string; message_id: string; type: string; text?: string };
  };
  readonly run: { readonly run_id: string; readonly workflow: string; readonly step: string };
}

export type WebhookSendResult = void | { ok: boolean; permanent?: boolean; error?: string };

type WebhookSenderFn = (
  url: string,
  envelope: WebhookEnvelope,
) => WebhookSendResult | Promise<WebhookSendResult>;

let webhookSender: WebhookSenderFn | null = null;

export function _setWebhookSenderForTests(fn: WebhookSenderFn | null): void {
  webhookSender = fn;
}

const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 3000;

interface AttemptOutcome {
  readonly ok: boolean;
  readonly permanent: boolean;
  readonly error?: string;
}

async function sendEnvelope(url: string, envelope: WebhookEnvelope): Promise<AttemptOutcome> {
  if (webhookSender) {
    try {
      const r = await webhookSender(url, envelope);
      if (r === undefined || r === null) return { ok: true, permanent: false };
      return { ok: r.ok, permanent: r.permanent === true, ...(r.error !== undefined ? { error: r.error } : {}) };
    } catch (e) {
      return { ok: false, permanent: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, permanent: false };
    return { ok: false, permanent: res.status >= 400 && res.status < 500, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, permanent: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function composeEnvelope(
  message: InboxMessage,
  event: WebhookEvent,
  respondUrl: string | null,
): WebhookEnvelope {
  return {
    event,
    message: publicMessage(message),
    ...(respondUrl && event === 'question'
      ? {
          respond: {
            url: respondUrl,
            token: message.respond_token,
            body: {
              run: message.run_id,
              message_id: message.message_id,
              type: '<accept|reject|choice|respond|edit|items>',
            },
          },
        }
      : {}),
    run: { run_id: message.run_id, workflow: message.workflow, step: message.step },
  };
}

async function recordDelivery(
  runtimeDir: string,
  messageId: string,
  delivery: InboxDelivery,
): Promise<void> {
  const current = readMessage(runtimeDir, messageId);
  if (!current) return;
  await lockedJsonReadModifyWrite<InboxMessage>(
    messagePath(runtimeDir, messageId),
    (c) => ({ ...c, delivery }),
    current,
  );
}

async function deliver(
  runtimeDir: string,
  message: InboxMessage,
  event: WebhookEvent,
  respondUrl: string | null,
  url: string,
): Promise<InboxDelivery> {
  const prior = message.delivery;
  const sameTarget = prior !== undefined && prior.url === url && prior.event === event;
  const attempts = (sameTarget ? prior.attempts : 0) + 1;
  const outcome = await sendEnvelope(url, composeEnvelope(message, event, respondUrl));
  const now = toIsoLocal();
  const delivery: InboxDelivery = {
    url,
    event,
    attempts,
    last_attempt_at: now,
    ...(outcome.ok ? { delivered_at: now } : {}),
    ...(outcome.error !== undefined ? { last_error: outcome.error } : {}),
    settled: outcome.ok || outcome.permanent || attempts >= MAX_DELIVERY_ATTEMPTS,
  };
  if (!outcome.ok) {
    process.stderr.write(
      `[riglane] inbox webhook ${event} push failed (attempt ${attempts}` +
        `${delivery.settled ? ', giving up' : ''}): ${outcome.error ?? 'unknown'}\n`,
    );
  }
  await recordDelivery(runtimeDir, message.message_id, delivery);
  return delivery;
}

export async function flushPendingDeliveries(
  runtimeDir: string,
  respondUrl: string | null,
): Promise<number> {
  let retried = 0;
  for (const m of listMessages(runtimeDir)) {
    const d = m.delivery;
    if (!d || d.settled || !d.url) continue;
    await deliver(runtimeDir, m, eventForState(messageState(m)), respondUrl, d.url);
    retried += 1;
  }
  return retried;
}

export async function pushInboxEvent(
  runtimeDir: string,
  message: InboxMessage,
  event: WebhookEvent,
  opts: { respondUrl?: string | null; webhookUrl?: string | null } = {},
): Promise<InboxDelivery | undefined> {
  const url =
    opts.webhookUrl === undefined ? ambientWebhookUrl() : (opts.webhookUrl ?? '');
  if (!url) return undefined;
  return deliver(runtimeDir, message, event, opts.respondUrl ?? null, url);
}

function ambientWebhookUrl(): string {
  try {
    return inboxWebhookUrl();
  } catch {
    return '';
  }
}

export function hasMessages(runtimeDir: string): boolean {
  try {
    return statSync(inboxDir(runtimeDir)).isDirectory() && listMessages(runtimeDir).length > 0;
  } catch {
    return false;
  }
}
