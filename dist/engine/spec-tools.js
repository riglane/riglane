import { instruction } from './instruction-files.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { GENERIC_SCOPE, getAvailableScopes, iterSpecFiles, resolveActiveScope, resolveReadScopes, scopeFromPath, validateScopeExists, } from '../scope/scope-context.js';
import { SPEC_SCHEMA } from '../types/spec.js';
import { PRODUCT_DIR } from '../config/paths.js';
import { extractSectionContent, parseMarkdownFrontmatterString } from './markdown.js';
import { getCurrentRunId } from './run-context.js';
import { runManifestPath } from './runs.js';
import { validateFile } from './schema-validate.js';
import { dedupMessage, findDomainDuplicates, findSpecDuplicates, scoreSpecPair, } from './spec-dedup.js';
import { computeContentFingerprint, deriveIndexEntry, ensureDomainInIndex, isSummaryStale, mintSpecId, reconcileIndex, reconcileRegistry, removeSpecFromIndex, setDomainDescription, setDomainNextSerial, upsertSpecInIndex, } from './spec-index.js';
import { deleteSpecMarkdown, readSpecIndex, readSpecIndexRaw, readSpecMarkdown, readSpecRegistry, specFilePath, specRelPath, writeSpecIndex, writeSpecMarkdown, writeSpecRegistry, } from './spec-store.js';
export const ENGINE_SET_FRONTMATTER_FIELDS = new Set([
    'spec_id',
    'scope',
    'created_at',
    'updated_at',
]);
export function premintSpecSchema() {
    const fm = SPEC_SCHEMA.frontmatter;
    const required = (fm?.required ?? []).filter((f) => !ENGINE_SET_FRONTMATTER_FIELDS.has(f.field));
    const { name_pattern, ...fileChecksRest } = SPEC_SCHEMA.file_checks ?? {};
    void name_pattern;
    return {
        ...SPEC_SCHEMA,
        frontmatter: { required, ...(fm?.optional ? { optional: fm.optional } : {}) },
        file_checks: fileChecksRest,
    };
}
export function composeSpecMarkdown(frontmatter, body) {
    const fm = stringifyYaml(frontmatter).trimEnd();
    return `---\n${fm}\n---\n\n${body.trim()}\n`;
}
export function validateSpecContentPremint(content) {
    const dir = mkdtempSync(join(tmpdir(), 'riglane-spec-premint-'));
    try {
        const tmp = join(dir, 'draft.md');
        writeFileSync(tmp, content, 'utf-8');
        return validateFile(tmp, premintSpecSchema());
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
export const DOMAIN_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const DOMAIN_NAME_MAX_LEN = 64;
export function validateDomainForWrite(domain, domainDescription, isNewDomain) {
    const errors = [];
    if (typeof domain !== 'string' || !DOMAIN_NAME_PATTERN.test(domain)) {
        errors.push(`domain '${String(domain)}' is invalid. Fix: use a lowercase short word, words joined by hyphens, matching ${DOMAIN_NAME_PATTERN.source} (e.g. auth, rate-limit).`);
    }
    else if (domain.length > DOMAIN_NAME_MAX_LEN) {
        errors.push(`domain '${domain}' is too long (${domain.length} > ${DOMAIN_NAME_MAX_LEN}). Fix: pick a short domain word.`);
    }
    if (isNewDomain && (typeof domainDescription !== 'string' || domainDescription.trim() === '')) {
        errors.push(`domain '${String(domain)}' is new but 'domain_description' is missing. Fix: add a one-line 'domain_description' to the frontmatter when introducing a new domain.`);
    }
    return errors;
}
export function composeSpecGuidance(flags, scope, domains, scopeHint) {
    const { specCheck, specAuthoring } = flags;
    if (!specCheck && !specAuthoring)
        return '';
    const domainList = domains.length > 0
        ? domains.map((d) => `  - ${d.name} — ${d.description}`).join('\n')
        : specAuthoring
            ? '  (none yet — you are introducing the first domain in this scope)'
            : '  (none recorded yet)';
    const conceptLead = specAuthoring
        ? 'You author specs in this step — write each one so a future agent can consult and honor it.'
        : 'Consult and honor them before changing the project.';
    const parts = [
        `## Behavioral Specs — target scope: ${scope}`,
        '',
        'Specs are binding behavioral memory: durable requirements that future work MUST',
        `honor (the guarantee against agent drift). ${conceptLead}`,
    ];
    const hint = typeof scopeHint === 'string' && scopeHint.trim() ? scopeHint.trim() : null;
    if (hint) {
        parts.push('', `**Scope coverage — '${scope}':** ${hint}`, `Stay within this coverage. Work that falls outside it belongs to a different`, `scope (or generic) — ${specAuthoring
            ? 'author it there, not here'
            : 'a spec outside this coverage is not yours to enforce here'}. When a spec plainly sits in the wrong scope, flag it in your summary; do`, `NOT silently move or override it (that is above your level).`);
    }
    else if (scope !== 'generic') {
        parts.push('', `(No coverage hint recorded for scope '${scope}' — judge scope membership from`, `the spec content and the recorded domains below. A coverage hint can be added`, `with \`riglane scope hint ${scope} "<what it covers; NOT ... (→ other-scope)>"\`.)`);
    }
    parts.push('', '**Recorded domains** (the shared landscape — REUSE an existing domain, do NOT', 'invent a near-synonym, e.g. "authn" for "auth"):', domainList);
    if (specAuthoring)
        parts.push('', composeAuthoringBody(scope, specAuthoring));
    if (specCheck)
        parts.push('', composeConsumptionBody());
    return parts.join('\n');
}
function composeAuthoringBody(scope, mode) {
    const agentFields = (SPEC_SCHEMA.frontmatter?.required ?? [])
        .filter((f) => !ENGINE_SET_FRONTMATTER_FIELDS.has(f.field))
        .map((f) => f.field);
    const optionalFields = (SPEC_SCHEMA.frontmatter?.optional ?? []).map((f) => f.field);
    const sections = SPEC_SCHEMA.required_sections ?? [];
    const fieldsList = agentFields.join(', ') +
        (optionalFields.length ? ` (optional: ${optionalFields.join(', ')})` : '');
    const sectionsList = sections.map((s) => `## ${s}`).join(' \u00b7 ');
    const lines = [
        instruction('spec/authoring-body', { scope, fieldsList, sectionsList }),
    ];
    if (mode === 'validate') {
        lines.push('', instruction('spec/authoring-validate-clause'));
    }
    return lines.join('\n');
}
function composeConsumptionBody() {
    return instruction('spec/consumption-body');
}
function isoDate(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
const FM_ORDER = [
    'spec_id',
    'domain',
    'domain_description',
    'title',
    'summary',
    'applies_to',
    'scope',
    'source_sections',
    'related_specs',
    'created_at',
    'updated_at',
];
function assembleFrontmatter(fields) {
    const out = {};
    for (const key of FM_ORDER) {
        if (fields[key] !== undefined)
            out[key] = fields[key];
    }
    return out;
}
function nonEmptyDomainSummaries(index) {
    if (index === null)
        return [];
    const populated = new Set(index.specs.map((s) => s.domain));
    return index.domains
        .filter((d) => populated.has(d.name))
        .map((d) => ({ name: d.name, description: d.description }));
}
export function composeDomainsEcho(scope, root) {
    const target = nonEmptyDomainSummaries(readSpecIndexRaw(scope, root));
    const merged = [...target];
    if (scope !== GENERIC_SCOPE) {
        const seen = new Set(target.map((d) => d.name));
        merged.push(...nonEmptyDomainSummaries(readSpecIndexRaw(GENERIC_SCOPE, root)).filter((d) => !seen.has(d.name)));
    }
    return merged;
}
function activeValidateStepGuard(root, dryRun) {
    if (dryRun === true)
        return null;
    try {
        const runId = getCurrentRunId();
        if (!runId)
            return null;
        const manifestPath = runManifestPath(join(root, PRODUCT_DIR), runId);
        if (!existsSync(manifestPath))
            return null;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const cur = manifest.current_step;
        if (!cur || manifest.steps?.[cur]?.spec_authoring !== 'validate')
            return null;
        return (`spec_write persisting call rejected: the active step '${cur}' is declared ` +
            `spec_authoring: validate — a DRY-RUN preview step. Call spec_write with ` +
            `dry_run:true (full validation + dedup preview; persists nothing) and write ` +
            `your findings to the step's declared report output. Persisting belongs to a ` +
            `later spec_authoring: persist step.`);
    }
    catch {
        return null;
    }
}
export function toolSpecWrite(args, root = '.') {
    try {
        const held = activeValidateStepGuard(root, args.dry_run);
        if (held)
            return { ok: false, errors: [held], warnings: [] };
        if (args.op === 'delete') {
            const scope = args.scope ?? resolveActiveScope(null, root)[0];
            return deleteSpec(args, scope, root);
        }
        return writeSpec(args, root);
    }
    catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)], warnings: [] };
    }
}
function writeSpec(args, root) {
    const content = args.content ?? (args.draft_path ? readFileSync(args.draft_path, 'utf-8') : undefined);
    if (content === undefined) {
        return { ok: false, errors: ["provide 'content' or 'draft_path'"], warnings: [] };
    }
    const { frontmatter, body } = parseMarkdownFrontmatterString(content);
    if (frontmatter === null) {
        return { ok: false, errors: ['spec has no YAML frontmatter'], warnings: [] };
    }
    const pre = validateSpecContentPremint(content);
    if (!pre.passed)
        return { ok: false, errors: pre.details, warnings: [] };
    const scope = args.scope ?? resolveActiveScope(null, root)[0];
    const domain = frontmatter.domain;
    const index = readSpecIndex(scope, root);
    const isNewDomain = !index.domains.some((d) => d.name === domain);
    const domainErrors = validateDomainForWrite(domain, frontmatter.domain_description, isNewDomain);
    if (domainErrors.length > 0)
        return {
            ok: false,
            errors: domainErrors,
            warnings: [],
            ...(isNewDomain ? { domains: composeDomainsEcho(scope, root) } : {}),
        };
    if (args.op === 'update')
        return updateSpec(args, scope, domain, frontmatter, body, root);
    const dangling = danglingRelatedSpecs(frontmatter.related_specs, scope, root, new Map([[scope, index]]), new Set(getAvailableScopes(root).map((s) => s.id)));
    if (dangling.length > 0)
        return {
            ok: false,
            errors: [
                `related_specs reference unknown spec(s): ${dangling.join(', ')}. Fix: related_specs must ` +
                    `point to EXISTING specs (bare id = this scope, '<scope>:<id>' = another scope). ` +
                    `Intra-batch refs belong in related_by_temp_key. Remove or correct the reference(s).`,
            ],
            warnings: [],
        };
    const candidate = {
        title: frontmatter.title,
        summary: frontmatter.summary,
        applies_to: frontmatter.applies_to ?? [],
        domain,
        ...(Array.isArray(frontmatter.source_sections)
            ? { source_sections: frontmatter.source_sections }
            : {}),
    };
    const matches = findSpecDuplicates(candidate, index.specs);
    const nearCertain = matches.filter((m) => m.tier === 'near_certain');
    if (nearCertain.length > 0 && !args.acknowledge_distinct) {
        return {
            ok: false,
            status: 'near_certain',
            matches: nearCertain,
            guidance: `This looks like an existing spec. Choose one: (a) spec_write(...acknowledge_distinct:true) to create anyway if genuinely different; (b) abandon (do nothing); (c) spec_write(op:update, spec_id:'${nearCertain[0].spec_id}') with merged content.`,
            errors: [],
            warnings: [],
        };
    }
    const oneRule = oneRuleSignals(extractSectionContent(body, 'Rule Statement') ?? '');
    if (oneRule.hold.length > 0 && !args.acknowledge_single_rule) {
        return {
            ok: false,
            status: 'multi_rule',
            errors: [],
            warnings: [],
            guidance: `This Rule Statement encodes more than one rule (${oneRule.hold.join('; ')}). ONE spec = ONE ` +
                `rule. Split it into separate specs (link them via related_specs), OR — if it is genuinely a ` +
                `single rule — pass acknowledge_single_rule:true.`,
        };
    }
    const dedupWarnings = matches
        .filter((m) => m.tier === 'possible')
        .map((m) => dedupMessage(candidate.title, m));
    dedupWarnings.push(...oneRule.warn);
    if (args.acknowledge_single_rule && oneRule.hold.length > 0)
        dedupWarnings.push(`Created despite a multi-rule signal (${oneRule.hold.join('; ')}) — acknowledged single rule.`);
    if (isNewDomain) {
        const domDup = findDomainDuplicates({ name: domain, description: frontmatter.domain_description ?? '' }, index.domains);
        for (const d of domDup) {
            dedupWarnings.push(`New domain '${domain}' resembles existing '${d.name}' (${d.signals.join(', ')}) — reuse it if it's the same area?`);
        }
    }
    if (args.acknowledge_distinct && nearCertain.length > 0) {
        dedupWarnings.push(`Created despite near-certain match(es): ${nearCertain.map((m) => m.spec_id).join(', ')} — acknowledged distinct.`);
    }
    if (args.dry_run) {
        return {
            ok: true,
            errors: [],
            warnings: dedupWarnings,
            ...(isNewDomain ? { domains: composeDomainsEcho(scope, root) } : {}),
        };
    }
    const domainEntry = index.domains.find((d) => d.name === domain);
    const existingIds = index.specs.filter((s) => s.domain === domain).map((s) => s.spec_id);
    let specId;
    let nextSerial;
    try {
        ({ specId, nextSerial } = mintSpecId(domain, domainEntry?.next_serial ?? 1, existingIds));
    }
    catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)], warnings: [] };
    }
    const today = isoDate();
    const finalFm = assembleFrontmatter({
        ...frontmatter,
        spec_id: specId,
        scope,
        created_at: today,
        updated_at: today,
    });
    const finalMd = composeSpecMarkdown(finalFm, body);
    const filePath = writeSpecMarkdown(scope, domain, specId, finalMd, root);
    const post = validateFile(filePath, SPEC_SCHEMA);
    if (!post.passed) {
        deleteSpecMarkdown(filePath);
        return { ok: false, errors: post.details, warnings: [] };
    }
    const fingerprint = computeContentFingerprint(extractSectionContent(body, 'Rule Statement') ?? '');
    const entry = deriveIndexEntry(finalFm, specRelPath(scope, domain, specId), fingerprint);
    let idx = ensureDomainInIndex(index, domain, frontmatter.domain_description ?? '');
    idx = setDomainNextSerial(idx, domain, nextSerial);
    idx = upsertSpecInIndex(idx, entry);
    writeSpecIndex(scope, idx, root);
    return {
        ok: true,
        assigned_spec_id: specId,
        errors: [],
        warnings: dedupWarnings,
        ...(isNewDomain ? { domains: composeDomainsEcho(scope, root) } : {}),
    };
}
function updateSpec(args, scope, domain, frontmatter, body, root) {
    const specId = args.spec_id;
    if (!specId)
        return { ok: false, errors: ["update requires 'spec_id'"], warnings: [] };
    const index = readSpecIndex(scope, root);
    const existing = index.specs.find((s) => s.spec_id === specId);
    if (!existing) {
        return { ok: false, errors: [`spec '${specId}' not found in scope '${scope}'`], warnings: [] };
    }
    if (existing.domain !== domain) {
        return {
            ok: false,
            errors: [
                `update cannot change domain (${existing.domain} → ${domain}). Use spec_write(op:move, ` +
                    `spec_id:'${specId}', to_domain:'${domain}') — it re-homes the spec and cascades ids/index/registry.`,
            ],
            warnings: [],
        };
    }
    if (args.set_domain_description) {
        const dd = frontmatter.domain_description;
        if (typeof dd !== 'string' || dd.trim() === '') {
            return {
                ok: false,
                errors: [
                    "set_domain_description:true requires a non-empty 'domain_description' in the frontmatter.",
                ],
                warnings: [],
            };
        }
    }
    const updateWarnings = [];
    {
        let oldRefs = new Set();
        try {
            const oldParsed = parseMarkdownFrontmatterString(readSpecMarkdown(specFilePath(scope, domain, specId, root)));
            const raw = oldParsed.frontmatter?.related_specs;
            if (Array.isArray(raw))
                oldRefs = new Set(raw.map((x) => String(x)));
        }
        catch {
        }
        const newRefs = Array.isArray(frontmatter.related_specs)
            ? frontmatter.related_specs.map((x) => String(x))
            : [];
        const addedRefs = newRefs.filter((ref) => !oldRefs.has(ref));
        const scopeSet = new Set(getAvailableScopes(root).map((s) => s.id));
        const indexCache = new Map([[scope, index]]);
        const addedDangling = danglingRelatedSpecs(addedRefs, scope, root, indexCache, scopeSet);
        if (addedDangling.length > 0) {
            return {
                ok: false,
                errors: [
                    `related_specs added by this update reference unknown spec(s): ` +
                        `${addedDangling.join(', ')}. Fix: related_specs must point to EXISTING specs ` +
                        `(bare id = this scope, '<scope>:<id>' = another scope). Refs the spec already ` +
                        `carried are not affected — only the newly added ones are refused.`,
                ],
                warnings: [],
            };
        }
        const keptRefs = newRefs.filter((ref) => oldRefs.has(ref));
        const keptDangling = danglingRelatedSpecs(keptRefs, scope, root, indexCache, scopeSet);
        if (keptDangling.length > 0) {
            updateWarnings.push(`pre-existing related_specs still reference unknown spec(s): ${keptDangling.join(', ')} ` +
                `— carried over unchanged (this update did not add them). Worth repairing.`);
        }
    }
    {
        const newRule = extractSectionContent(body, 'Rule Statement') ?? '';
        const ruleChanged = computeContentFingerprint(newRule) !== existing.content_fingerprint;
        if (ruleChanged) {
            const oneRule = oneRuleSignals(newRule);
            if (oneRule.hold.length > 0 && !args.acknowledge_single_rule) {
                return {
                    ok: false,
                    status: 'multi_rule',
                    errors: [],
                    warnings: [],
                    guidance: `This update rewrites the Rule Statement into more than one rule ` +
                        `(${oneRule.hold.join('; ')}). ONE spec = ONE rule. Split it into separate specs ` +
                        `(link them via related_specs), OR — if it is genuinely a single rule — pass ` +
                        `acknowledge_single_rule:true.`,
                };
            }
            updateWarnings.push(...oneRule.warn);
            if (args.acknowledge_single_rule && oneRule.hold.length > 0) {
                updateWarnings.push(`Updated despite a multi-rule signal (${oneRule.hold.join('; ')}) — acknowledged single rule.`);
            }
        }
    }
    const today = isoDate();
    const finalFm = assembleFrontmatter({
        ...frontmatter,
        spec_id: specId,
        scope,
        created_at: existing.created_at,
        updated_at: today,
    });
    if (args.dry_run)
        return { ok: true, assigned_spec_id: specId, errors: [], warnings: updateWarnings };
    const finalMd = composeSpecMarkdown(finalFm, body);
    const filePath = writeSpecMarkdown(scope, domain, specId, finalMd, root);
    const post = validateFile(filePath, SPEC_SCHEMA);
    if (!post.passed)
        return { ok: false, errors: post.details, warnings: [] };
    const fingerprint = computeContentFingerprint(extractSectionContent(body, 'Rule Statement') ?? '');
    const warnings = [...updateWarnings];
    if (isSummaryStale({ content_fingerprint: existing.content_fingerprint, summary: existing.summary }, { content_fingerprint: fingerprint, summary: frontmatter.summary })) {
        warnings.push(`Rule Statement changed but summary did not — is the summary hint still accurate for '${specId}'?`);
    }
    const entry = deriveIndexEntry(finalFm, existing.path, fingerprint);
    let idx = upsertSpecInIndex(index, entry);
    if (args.set_domain_description) {
        const newDesc = frontmatter.domain_description.trim();
        const oldDesc = index.domains.find((d) => d.name === domain)?.description ?? '';
        idx = setDomainDescription(idx, domain, newDesc);
        if (oldDesc !== newDesc) {
            warnings.push(`domain '${domain}' description changed: '${oldDesc}' → '${newDesc}'.`);
        }
    }
    writeSpecIndex(scope, idx, root);
    return { ok: true, assigned_spec_id: specId, errors: [], warnings };
}
function deleteSpec(args, scope, root) {
    const specId = args.spec_id;
    if (!specId)
        return { ok: false, errors: ["delete requires 'spec_id'"], warnings: [] };
    const index = readSpecIndex(scope, root);
    const existing = index.specs.find((s) => s.spec_id === specId);
    if (!existing) {
        return { ok: false, errors: [`spec '${specId}' not found in scope '${scope}'`], warnings: [] };
    }
    const deletedIds = new Set([specId]);
    const crossScan = scanReferencesAcrossScopes(scope, new Map([[specId, specId]]), root);
    if (args.dry_run) {
        const preview = scrubDeletedReferrers(scope, deletedIds, root, true);
        const warnings = [];
        if (preview.rewritten.length > 0)
            warnings.push(`Would strip '${specId}' from related_specs of ${preview.rewritten.length} same-scope spec(s): ` +
                `${preview.rewritten.map((r) => r.spec_id).join(', ')}.`);
        warnings.push(...crossRefWarnings(specId, crossScan));
        return { ok: true, assigned_spec_id: specId, errors: [], warnings };
    }
    deleteSpecMarkdown(specFilePath(scope, existing.domain, specId, root));
    const scrub = scrubDeletedReferrers(scope, deletedIds, root);
    let idx = removeSpecFromIndex(index, specId);
    for (const e of scrub.entries)
        idx = upsertSpecInIndex(idx, e);
    writeSpecIndex(scope, idx, root);
    const warnings = [...scrub.warnings];
    if (scrub.rewritten.length > 0)
        warnings.push(`Stripped '${specId}' from related_specs of ${scrub.rewritten.length} same-scope spec(s): ` +
            `${scrub.rewritten.map((r) => r.spec_id).join(', ')}.`);
    warnings.push(...crossRefWarnings(specId, crossScan));
    const registry = readSpecRegistry(scope, root);
    if (registry.mappings[specId]) {
        warnings.push(`_registry.json still has mappings for deleted spec '${specId}' — remove them via spec_link(op:remove).`);
    }
    return { ok: true, assigned_spec_id: specId, errors: [], warnings };
}
function moveError(...errors) {
    return {
        ok: false,
        remap: [],
        rewritten_related_specs: [],
        cross_scope_refs: [],
        body_refs: [],
        warnings: [],
        errors,
    };
}
export function toolSpecMove(args, root = '.') {
    try {
        const held = activeValidateStepGuard(root, args.dry_run);
        if (held)
            return moveError(held);
        const sourceScope = args.scope ?? resolveActiveScope(null, root)[0];
        if (args.op === 'rename_domain')
            return renameDomain(args.domain, args.new_domain, sourceScope, args.dry_run === true, root);
        const toScope = args.to_scope ?? sourceScope;
        const specIds = args.spec_ids && args.spec_ids.length > 0
            ? [...args.spec_ids]
            : args.spec_id
                ? [args.spec_id]
                : [];
        if (specIds.length === 0)
            return moveError("move requires 'spec_id' (single) or 'spec_ids' (batch)");
        const toDomain = args.to_domain;
        if (!toDomain)
            return moveError("move requires 'to_domain'");
        return moveSpecs(specIds, sourceScope, toScope, toDomain, args.to_domain_description, args.dry_run === true, root);
    }
    catch (e) {
        return moveError(e instanceof Error ? e.message : String(e));
    }
}
function renameDomain(domain, newDomain, scope, dryRun, root) {
    if (!domain)
        return moveError("rename_domain requires 'domain'");
    if (!newDomain)
        return moveError("rename_domain requires 'new_domain'");
    if (domain === newDomain)
        return moveError(`rename_domain: 'domain' and 'new_domain' are both '${domain}'`);
    const index = readSpecIndex(scope, root);
    if (index.domains.some((d) => d.name === newDomain))
        return moveError(`rename_domain: target domain '${newDomain}' already exists — that would MERGE two domains, ` +
            `not rename. Move the specs explicitly with op:move if a merge is intended.`);
    const members = index.specs.filter((s) => s.domain === domain).map((s) => s.spec_id);
    if (members.length === 0)
        return moveError(`rename_domain: domain '${domain}' has no specs (nothing to rename)`);
    const oldDescription = index.domains.find((d) => d.name === domain)?.description ?? '';
    return moveSpecs(members, scope, scope, newDomain, oldDescription, dryRun, root);
}
function buildMovePlan(specIds, sourceScope, sourceIndex, destIndex, toDomain, root) {
    const seenInput = new Set();
    for (const id of specIds) {
        if (seenInput.has(id))
            return { ok: false, error: `duplicate spec_id '${id}' in the move set` };
        seenInput.add(id);
    }
    const destDomainEntry = destIndex.domains.find((d) => d.name === toDomain);
    let counter = destDomainEntry?.next_serial ?? 1;
    const mintedAgainst = destIndex.specs.filter((s) => s.domain === toDomain).map((s) => s.spec_id);
    const plan = [];
    for (const specId of specIds) {
        const existing = sourceIndex.specs.find((s) => s.spec_id === specId);
        if (!existing)
            return { ok: false, error: `spec '${specId}' not found in scope '${sourceScope}'` };
        const sameTarget = existing.domain === toDomain && destIndex === sourceIndex;
        if (sameTarget)
            return { ok: false, error: `spec '${specId}' is already in domain '${toDomain}' — nothing to move` };
        const oldAbs = specFilePath(sourceScope, existing.domain, specId, root);
        let parsed;
        try {
            parsed = parseMarkdownFrontmatterString(readSpecMarkdown(oldAbs));
        }
        catch (e) {
            return { ok: false, error: `cannot read spec '${specId}': ${e instanceof Error ? e.message : String(e)}` };
        }
        if (parsed.frontmatter === null)
            return { ok: false, error: `spec '${specId}' has no YAML frontmatter at ${existing.path}` };
        let newId;
        let nextSerial;
        try {
            ({ specId: newId, nextSerial } = mintSpecId(toDomain, counter, mintedAgainst));
        }
        catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        counter = nextSerial;
        mintedAgainst.push(newId);
        plan.push({
            oldId: specId,
            newId,
            oldAbs,
            oldPath: existing.path,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            createdAt: existing.created_at,
        });
    }
    return { ok: true, plan, counter };
}
function composeMoveRefInstructions(count, scan) {
    const notes = [];
    if (scan.cross_scope_refs.length > 0)
        notes.push(`${scan.cross_scope_refs.length} cross-scope related_specs reference(s) still point to a moved spec (the engine does not edit other scopes' specs).`);
    if (scan.body_refs.length > 0)
        notes.push(`${scan.body_refs.length} body-prose mention(s) of a moved id remain.`);
    if (notes.length === 0)
        return undefined;
    return (`Moved ${count} spec(s). ${notes.join(' ')} Review cross_scope_refs and body_refs; where a ` +
        `reference genuinely means a moved spec, update that spec's text to the new id via ` +
        `spec_write(op:update). The engine auto-rewrites only source-scope related_specs.`);
}
function moveSpecs(specIds, sourceScope, toScope, toDomain, toDomainDescription, dryRun, root) {
    const sameScope = toScope === sourceScope;
    if (!sameScope) {
        try {
            validateScopeExists(toScope, root);
        }
        catch (e) {
            return moveError(e instanceof Error ? e.message : String(e));
        }
    }
    const sourceIndex = readSpecIndex(sourceScope, root);
    const destIndex = sameScope ? sourceIndex : readSpecIndex(toScope, root);
    const isNewDest = !destIndex.domains.some((d) => d.name === toDomain);
    const domainErrors = validateDomainForWrite(toDomain, toDomainDescription, isNewDest);
    if (domainErrors.length > 0)
        return moveError(...domainErrors);
    const built = buildMovePlan(specIds, sourceScope, sourceIndex, destIndex, toDomain, root);
    if (!built.ok)
        return moveError(built.error);
    const { plan, counter } = built;
    const remap = plan.map((p) => ({
        old_id: p.oldId,
        new_id: p.newId,
        old_path: p.oldPath,
        new_path: specRelPath(toScope, toDomain, p.newId),
    }));
    const remapMap = new Map(plan.map((p) => [p.oldId, p.newId]));
    const rewriteToScope = sameScope ? undefined : toScope;
    if (dryRun) {
        const scan = scanReferencesAcrossScopes(sourceScope, remapMap, root);
        const wouldRewrite = rewriteSameScopeReferrers(sourceScope, remapMap, root, true, rewriteToScope);
        return {
            ...moveError(),
            ok: true,
            remap,
            rewritten_related_specs: wouldRewrite.rewritten,
            cross_scope_refs: scan.cross_scope_refs,
            body_refs: scan.body_refs,
            errors: [],
        };
    }
    const today = isoDate();
    const writtenNew = [];
    let refs = {
        rewritten: [],
        entries: [],
        warnings: [],
    };
    let destIdx = ensureDomainInIndex(destIndex, toDomain, toDomainDescription ?? '');
    destIdx = setDomainNextSerial(destIdx, toDomain, counter);
    let srcIdx = sourceIndex;
    try {
        for (const p of plan) {
            const finalFm = assembleFrontmatter({
                ...p.frontmatter,
                spec_id: p.newId,
                domain: toDomain,
                domain_description: undefined,
                scope: toScope,
                created_at: p.createdAt,
                updated_at: today,
            });
            const abs = writeSpecMarkdown(toScope, toDomain, p.newId, composeSpecMarkdown(finalFm, p.body), root);
            writtenNew.push(abs);
            const post = validateFile(abs, SPEC_SCHEMA);
            if (!post.passed)
                throw new Error(`moved '${p.oldId}' → '${p.newId}' failed validation: ${post.details.join('; ')}`);
            const fp = computeContentFingerprint(extractSectionContent(p.body, 'Rule Statement') ?? '');
            destIdx = upsertSpecInIndex(destIdx, deriveIndexEntry(finalFm, specRelPath(toScope, toDomain, p.newId), fp));
        }
        if (sameScope) {
            for (const p of plan)
                destIdx = removeSpecFromIndex(destIdx, p.oldId);
            refs = rewriteSameScopeReferrers(sourceScope, remapMap, root, false, rewriteToScope);
            for (const e of refs.entries)
                destIdx = upsertSpecInIndex(destIdx, e);
            writeSpecIndex(sourceScope, destIdx, root);
        }
        else {
            writeSpecIndex(toScope, destIdx, root);
            const verify = readSpecIndex(toScope, root);
            const missing = plan.filter((p) => !verify.specs.some((s) => s.spec_id === p.newId));
            if (missing.length > 0)
                throw new Error(`destination verify failed: ${missing.map((p) => p.newId).join(', ')} missing after write`);
        }
    }
    catch (e) {
        for (const abs of writtenNew) {
            try {
                deleteSpecMarkdown(abs);
            }
            catch {
            }
        }
        if (!sameScope) {
            try {
                let rollback = readSpecIndex(toScope, root);
                for (const p of plan)
                    rollback = removeSpecFromIndex(rollback, p.newId);
                writeSpecIndex(toScope, rollback, root);
            }
            catch {
            }
        }
        return moveError(`move aborted (no changes persisted): ${e instanceof Error ? e.message : String(e)}`);
    }
    const warnings = [];
    if (!sameScope) {
        try {
            refs = rewriteSameScopeReferrers(sourceScope, remapMap, root, false, rewriteToScope);
            for (const p of plan)
                srcIdx = removeSpecFromIndex(srcIdx, p.oldId);
            for (const e of refs.entries)
                srcIdx = upsertSpecInIndex(srcIdx, e);
            writeSpecIndex(sourceScope, srcIdx, root);
        }
        catch (e) {
            warnings.push(`source teardown (index) failed — the spec may appear in BOTH scopes until fixed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    warnings.push(...refs.warnings);
    for (const p of plan) {
        try {
            deleteSpecMarkdown(p.oldAbs);
        }
        catch (e) {
            warnings.push(`could not delete old file for '${p.oldId}': ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    try {
        const sourceReg = readSpecRegistry(sourceScope, root);
        const moved = [];
        const srcMappings = { ...sourceReg.mappings };
        let movedCount = 0;
        for (const p of plan) {
            const old = srcMappings[p.oldId];
            if (old) {
                moved.push({ newId: p.newId, mapping: { ...old, spec: specRelPath(toScope, toDomain, p.newId) } });
                delete srcMappings[p.oldId];
                movedCount += old.implemented_by.length;
            }
        }
        if (moved.length > 0) {
            if (sameScope) {
                const mappings = { ...srcMappings };
                for (const m of moved)
                    mappings[m.newId] = m.mapping;
                writeSpecRegistry(sourceScope, { ...sourceReg, mappings }, root);
            }
            else {
                const destReg = readSpecRegistry(toScope, root);
                const destMappings = { ...destReg.mappings };
                for (const m of moved)
                    destMappings[m.newId] = m.mapping;
                writeSpecRegistry(toScope, { ...destReg, mappings: destMappings }, root);
                writeSpecRegistry(sourceScope, { ...sourceReg, mappings: srcMappings }, root);
            }
            warnings.push(`registry: transplanted ${movedCount} code mapping(s) across ${moved.length} moved spec(s).`);
        }
    }
    catch (e) {
        warnings.push(`registry transplant failed (move persisted): ${e instanceof Error ? e.message : String(e)}`);
    }
    let scan = {
        cross_scope_refs: [],
        body_refs: [],
    };
    try {
        scan = scanReferencesAcrossScopes(sourceScope, remapMap, root);
    }
    catch {
    }
    const engine_instructions = composeMoveRefInstructions(plan.length, scan);
    return {
        ok: true,
        remap,
        rewritten_related_specs: refs.rewritten,
        cross_scope_refs: scan.cross_scope_refs,
        body_refs: scan.body_refs,
        warnings,
        ...(engine_instructions ? { engine_instructions } : {}),
        errors: [],
    };
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function locateInBody(body, index) {
    const headings = [...body.slice(0, index).matchAll(/^##\s+(.+)$/gm)];
    const section = headings[headings.length - 1]?.[1]?.trim();
    const lineStart = body.lastIndexOf('\n', index) + 1;
    let lineEnd = body.indexOf('\n', index);
    if (lineEnd < 0)
        lineEnd = body.length;
    const line = body.slice(lineStart, lineEnd).trim();
    const snippet = line.length > 160 ? `${line.slice(0, 157)}…` : line;
    return { ...(section ? { section } : {}), snippet };
}
function scanReferencesAcrossScopes(srcScope, remap, root) {
    const cross_scope_refs = [];
    const body_refs = [];
    const movedIds = new Set([...remap.keys(), ...remap.values()]);
    const oldRefs = [...remap.keys()].map((oldId) => ({
        oldId,
        qualified: `${srcScope}:${oldId}`,
        token: new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(oldId)}(?![A-Za-z0-9_-])`),
    }));
    const allScopes = getAvailableScopes(root).map((s) => s.id);
    for (const filePath of iterSpecFiles(allScopes, root)) {
        let fm;
        let body;
        try {
            ({ frontmatter: fm, body } = parseMarkdownFrontmatterString(readSpecMarkdown(filePath)));
        }
        catch {
            continue;
        }
        if (fm === null)
            continue;
        const refSpecId = fm.spec_id;
        if (typeof refSpecId !== 'string' || movedIds.has(refSpecId))
            continue;
        const refScope = scopeFromPath(filePath, root) ?? '';
        const refDomain = typeof fm.domain === 'string' ? fm.domain : '';
        const refPath = refScope && refDomain ? specRelPath(refScope, refDomain, refSpecId) : filePath;
        const related = fm.related_specs;
        for (const { qualified, token } of oldRefs) {
            if (refScope !== srcScope && Array.isArray(related) && related.includes(qualified)) {
                cross_scope_refs.push({
                    referrer_spec_id: refSpecId,
                    referrer_scope: refScope,
                    referrer_path: refPath,
                    old_ref: qualified,
                });
            }
            const m = token.exec(body);
            if (m) {
                const { section, snippet } = locateInBody(body, m.index);
                body_refs.push({
                    referrer_spec_id: refSpecId,
                    referrer_scope: refScope,
                    referrer_path: refPath,
                    ...(section ? { section } : {}),
                    snippet,
                });
            }
        }
    }
    return { cross_scope_refs, body_refs };
}
function rewriteSameScopeReferrers(scope, remap, root, dryRun = false, toScope) {
    const rewritten = [];
    const entries = [];
    const warnings = [];
    const movedIds = new Set([...remap.keys(), ...remap.values()]);
    const qualifiedPrefix = `${scope}:`;
    const crossScope = toScope !== undefined && toScope !== scope;
    const renderRef = (newId) => (crossScope ? `${toScope}:${newId}` : newId);
    const today = isoDate();
    for (const filePath of iterSpecFiles([scope], root)) {
        let fm;
        let body;
        try {
            ({ frontmatter: fm, body } = parseMarkdownFrontmatterString(readSpecMarkdown(filePath)));
        }
        catch {
            continue;
        }
        if (fm === null)
            continue;
        const refSpecId = fm.spec_id;
        if (typeof refSpecId !== 'string' || movedIds.has(refSpecId))
            continue;
        const related = fm.related_specs;
        if (!Array.isArray(related))
            continue;
        let changed = false;
        const nextRelated = related.map((r) => {
            const bareNew = typeof r === 'string' ? remap.get(r) : undefined;
            if (bareNew) {
                changed = true;
                return renderRef(bareNew);
            }
            if (typeof r === 'string' && r.startsWith(qualifiedPrefix)) {
                const qualNew = remap.get(r.slice(qualifiedPrefix.length));
                if (qualNew) {
                    changed = true;
                    return crossScope ? renderRef(qualNew) : `${qualifiedPrefix}${qualNew}`;
                }
            }
            return r;
        });
        if (!changed)
            continue;
        const refDomain = fm.domain;
        if (typeof refDomain !== 'string')
            continue;
        const path = specRelPath(scope, refDomain, refSpecId);
        if (dryRun) {
            rewritten.push({ spec_id: refSpecId, path });
            continue;
        }
        const finalFm = assembleFrontmatter({ ...fm, related_specs: nextRelated, updated_at: today });
        try {
            writeSpecMarkdown(scope, refDomain, refSpecId, composeSpecMarkdown(finalFm, body), root);
        }
        catch (e) {
            warnings.push(`failed to rewrite related_specs in '${refSpecId}': ${e instanceof Error ? e.message : String(e)}`);
            continue;
        }
        const fingerprint = computeContentFingerprint(extractSectionContent(body, 'Rule Statement') ?? '');
        entries.push(deriveIndexEntry(finalFm, path, fingerprint));
        rewritten.push({ spec_id: refSpecId, path });
    }
    return { rewritten, entries, warnings };
}
function scrubDeletedReferrers(scope, deletedIds, root, dryRun = false) {
    const rewritten = [];
    const entries = [];
    const warnings = [];
    const qualifiedPrefix = `${scope}:`;
    const today = isoDate();
    for (const filePath of iterSpecFiles([scope], root)) {
        let fm;
        let body;
        try {
            ({ frontmatter: fm, body } = parseMarkdownFrontmatterString(readSpecMarkdown(filePath)));
        }
        catch {
            continue;
        }
        if (fm === null)
            continue;
        const refSpecId = fm.spec_id;
        if (typeof refSpecId !== 'string' || deletedIds.has(refSpecId))
            continue;
        const related = fm.related_specs;
        if (!Array.isArray(related))
            continue;
        let changed = false;
        const nextRelated = related.filter((r) => {
            if (typeof r !== 'string')
                return true;
            const isDeleted = deletedIds.has(r) ||
                (r.startsWith(qualifiedPrefix) && deletedIds.has(r.slice(qualifiedPrefix.length)));
            if (isDeleted)
                changed = true;
            return !isDeleted;
        });
        if (!changed)
            continue;
        const refDomain = fm.domain;
        if (typeof refDomain !== 'string')
            continue;
        const path = specRelPath(scope, refDomain, refSpecId);
        if (dryRun) {
            rewritten.push({ spec_id: refSpecId, path });
            continue;
        }
        const nextFm = { ...fm, updated_at: today };
        if (nextRelated.length > 0)
            nextFm.related_specs = nextRelated;
        else
            delete nextFm.related_specs;
        const finalFm = assembleFrontmatter(nextFm);
        try {
            writeSpecMarkdown(scope, refDomain, refSpecId, composeSpecMarkdown(finalFm, body), root);
        }
        catch (e) {
            warnings.push(`failed to scrub related_specs in '${refSpecId}': ${e instanceof Error ? e.message : String(e)}`);
            continue;
        }
        const fingerprint = computeContentFingerprint(extractSectionContent(body, 'Rule Statement') ?? '');
        entries.push(deriveIndexEntry(finalFm, path, fingerprint));
        rewritten.push({ spec_id: refSpecId, path });
    }
    return { rewritten, entries, warnings };
}
function crossRefWarnings(deletedId, scan) {
    const w = [];
    if (scan.cross_scope_refs.length > 0)
        w.push(`${scan.cross_scope_refs.length} cross-scope related_specs reference(s) still point to deleted ` +
            `'${deletedId}' (other scopes are not auto-edited): ` +
            `${scan.cross_scope_refs.map((r) => `${r.referrer_scope}:${r.referrer_spec_id}`).join(', ')}. ` +
            `Update them via spec_write(op:update).`);
    if (scan.body_refs.length > 0)
        w.push(`${scan.body_refs.length} body-prose mention(s) of deleted '${deletedId}' remain: ` +
            `${scan.body_refs.map((r) => r.referrer_spec_id).join(', ')}. Review manually.`);
    return w;
}
function relatedRefResolves(ref, scope, root, indexCache, availableScopes) {
    let refScope = scope;
    let id = ref;
    const c = ref.indexOf(':');
    if (c > 0) {
        refScope = ref.slice(0, c);
        id = ref.slice(c + 1);
    }
    if (refScope !== scope && !availableScopes.has(refScope))
        return false;
    let idx = indexCache.get(refScope);
    if (!idx) {
        idx = readSpecIndex(refScope, root);
        indexCache.set(refScope, idx);
    }
    return idx.specs.some((s) => s.spec_id === id);
}
function danglingRelatedSpecs(related, scope, root, indexCache, availableScopes) {
    if (!Array.isArray(related))
        return [];
    return related.filter((r) => typeof r === 'string' &&
        r.length > 0 &&
        !relatedRefResolves(r, scope, root, indexCache, availableScopes));
}
function oneRuleSignals(ruleStatement) {
    const hold = [];
    const warn = [];
    const listItems = (ruleStatement.match(/^[ \t>]*(?:\d+[.)]|[-*•])[ \t]+\S/gm) ?? []).length;
    if (listItems >= 2)
        hold.push(`the Rule Statement is an enumerated list of ${listItems} obligations`);
    const musts = (ruleStatement.match(/\b(?:MUST(?:\s+NOT)?|SHALL(?:\s+NOT)?)\b/g) ?? []).length;
    if (musts >= 2)
        warn.push(`Rule Statement has ${musts} MUST/SHALL clauses — if these are separate obligations, split into separate specs (link via related_specs)`);
    return { hold, warn };
}
export function reconcileSpecIndexOnDisk(scope, root, opts = {}) {
    const oldIndex = readSpecIndex(scope, root);
    const oldById = new Map(oldIndex.specs.map((s) => [s.spec_id, s]));
    const derived = [];
    const warnings = [];
    for (const filePath of iterSpecFiles([scope], root)) {
        const base = filePath.split(/[\\/]/).pop() ?? '';
        let fm;
        let body;
        try {
            ({ frontmatter: fm, body } = parseMarkdownFrontmatterString(readSpecMarkdown(filePath)));
        }
        catch {
            const carried = oldIndex.specs.find((s) => s.path.split(/[\\/]/).pop() === base);
            if (carried) {
                derived.push(carried);
                warnings.push(`unparseable '${base}' — kept its existing index entry`);
            }
            else {
                warnings.push(`unparseable '${base}' — no existing index entry to keep`);
            }
            continue;
        }
        if (fm === null)
            continue;
        const specId = fm.spec_id;
        const domain = fm.domain;
        if (typeof specId !== 'string' || typeof domain !== 'string') {
            warnings.push(`'${base}': missing spec_id/domain in frontmatter — skipped`);
            continue;
        }
        const old = oldById.get(specId);
        const fmFixed = { ...fm };
        if (!fmFixed.created_at && old)
            fmFixed.created_at = old.created_at;
        if (!fmFixed.updated_at && old)
            fmFixed.updated_at = old.updated_at;
        const fingerprint = computeContentFingerprint(extractSectionContent(body, 'Rule Statement') ?? '');
        derived.push(deriveIndexEntry(fmFixed, specRelPath(scope, domain, specId), fingerprint));
    }
    const { index, changes } = reconcileIndex(oldIndex, derived);
    const drift = changes.added.length + changes.removed.length + changes.modified.length > 0;
    if (opts.write !== false && drift)
        writeSpecIndex(scope, index, root);
    return { changes, warnings };
}
export function auditRelatedSpecRefsOnDisk(scope, root) {
    const indexCache = new Map();
    const scopeSet = new Set(getAvailableScopes(root).map((s) => s.id));
    const findings = [];
    let audited = 0;
    for (const filePath of iterSpecFiles([scope], root)) {
        let fm;
        try {
            ({ frontmatter: fm } = parseMarkdownFrontmatterString(readSpecMarkdown(filePath)));
        }
        catch {
            continue;
        }
        if (fm === null)
            continue;
        audited += 1;
        const base = filePath.split(/[\\/]/).pop() ?? '';
        const specId = typeof fm.spec_id === 'string' ? fm.spec_id : base.replace(/\.md$/, '');
        const dangling = danglingRelatedSpecs(fm.related_specs, scope, root, indexCache, scopeSet);
        if (dangling.length > 0)
            findings.push({ spec_id: specId, dangling });
    }
    return { audited, findings };
}
export function reconcileSpecRegistryOnDisk(scope, root, opts = {}) {
    const registry = readSpecRegistry(scope, root);
    const index = readSpecIndex(scope, root);
    const validIds = new Set(index.specs.map((s) => s.spec_id));
    const fileExists = (rel) => existsSync(join(root, rel));
    const { registry: next, changes } = reconcileRegistry(registry, validIds, fileExists);
    if (opts.write !== false && changes.removedMappings.length > 0) {
        writeSpecRegistry(scope, next, root);
    }
    return { changes };
}
function validatePostMintMd(finalMd, specId) {
    const dir = mkdtempSync(join(tmpdir(), 'riglane-spec-batch-'));
    try {
        const tmp = join(dir, `${specId}.md`);
        writeFileSync(tmp, finalMd, 'utf-8');
        return validateFile(tmp, SPEC_SCHEMA);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
function batchDraftResult(w, forced) {
    const verdict = forced ?? (w.status === 'near_certain' ? 'held' : w.errors.length > 0 ? 'error' : 'clean');
    return {
        temp_key: w.draft.temp_key,
        path: w.draft.path,
        verdict,
        ...(verdict === 'written' && w.assignedSpecId ? { assigned_spec_id: w.assignedSpecId } : {}),
        ...(w.status ? { status: w.status } : {}),
        ...(w.matches ? { matches: w.matches } : {}),
        errors: w.errors,
        warnings: w.warnings,
    };
}
export function toolSpecCreateBatch(args, root = '.') {
    try {
        const held = activeValidateStepGuard(root, args.dry_run);
        if (held)
            return { ok: false, results: [], errors: [held], warnings: [] };
        return createBatch(args, root);
    }
    catch (e) {
        return {
            ok: false,
            results: [],
            errors: [e instanceof Error ? e.message : String(e)],
            warnings: [],
        };
    }
}
function createBatch(args, root) {
    const drafts = args.drafts ?? [];
    if (drafts.length === 0) {
        return {
            ok: false,
            results: [],
            errors: ['create_batch requires at least one draft.'],
            warnings: [],
        };
    }
    const batchErrors = [];
    const seen = new Set();
    const dupes = new Set();
    for (const d of drafts) {
        const k = (d.temp_key ?? '').trim();
        if (k === '')
            batchErrors.push('every draft needs a non-empty temp_key.');
        else if (seen.has(k))
            dupes.add(k);
        else
            seen.add(k);
    }
    for (const k of dupes)
        batchErrors.push(`duplicate temp_key '${k}' — each draft needs a unique temp_key.`);
    if (batchErrors.length > 0)
        return { ok: false, results: [], errors: batchErrors, warnings: [] };
    const scope = args.scope ?? resolveActiveScope(null, root)[0];
    const index = readSpecIndex(scope, root);
    const ack = new Set(args.acknowledge_distinct_temp_keys ?? []);
    const works = drafts.map((d) => {
        const w = {
            draft: d,
            fm: null,
            body: '',
            domain: '',
            candidate: null,
            errors: [],
            warnings: [],
        };
        let content;
        try {
            content = readFileSync(d.path, 'utf-8');
        }
        catch {
            w.errors.push(`draft '${d.temp_key}' (${d.path}): file not found or unreadable. Fix: check the draft path.`);
            return w;
        }
        const { frontmatter, body } = parseMarkdownFrontmatterString(content);
        if (frontmatter === null) {
            w.errors.push(`draft '${d.temp_key}': no YAML frontmatter. Fix: add a '---' frontmatter block.`);
            return w;
        }
        const pre = validateSpecContentPremint(content);
        if (!pre.passed)
            w.errors.push(...pre.details.map((x) => `draft '${d.temp_key}': ${x}`));
        w.fm = frontmatter;
        w.body = body;
        w.domain = typeof frontmatter.domain === 'string' ? frontmatter.domain : '';
        w.candidate = {
            title: typeof frontmatter.title === 'string' ? frontmatter.title : '',
            summary: typeof frontmatter.summary === 'string' ? frontmatter.summary : '',
            applies_to: Array.isArray(frontmatter.applies_to) ? frontmatter.applies_to : [],
            domain: w.domain,
            ...(Array.isArray(frontmatter.source_sections)
                ? { source_sections: frontmatter.source_sections }
                : {}),
        };
        return w;
    });
    const newDomains = new Set();
    const newDomainDesc = new Map();
    for (const w of works) {
        if (!w.fm || w.domain === '' || index.domains.some((dm) => dm.name === w.domain))
            continue;
        newDomains.add(w.domain);
        const dd = w.fm.domain_description;
        if (typeof dd === 'string' && dd.trim() !== '') {
            const trimmed = dd.trim();
            const chosen = newDomainDesc.get(w.domain);
            if (chosen === undefined) {
                newDomainDesc.set(w.domain, trimmed);
            }
            else if (chosen !== trimmed) {
                w.warnings.push(`draft '${w.draft.temp_key}': domain '${w.domain}' description differs from an earlier draft ('${chosen}') — using the first. Change it later via spec_write(op:update, set_domain_description:true).`);
            }
        }
    }
    for (const w of works) {
        if (!w.fm || w.domain === '')
            continue;
        const fmt = validateDomainForWrite(w.domain, undefined, false);
        if (fmt.length > 0)
            w.errors.push(...fmt.map((e) => `draft '${w.draft.temp_key}': ${e}`));
    }
    for (const dom of newDomains) {
        if (newDomainDesc.has(dom))
            continue;
        works
            .find((w) => w.domain === dom)
            ?.errors.push(`new domain '${dom}': no draft carries 'domain_description'. Fix: add a one-line domain_description to at least one spec in this new domain.`);
    }
    const batchKeys = new Set(works.map((w) => w.draft.temp_key));
    for (const w of works) {
        for (const ref of w.draft.related_by_temp_key ?? []) {
            if (ref === w.draft.temp_key) {
                w.errors.push(`draft '${w.draft.temp_key}': related_by_temp_key references itself. Fix: a spec cannot be its own related_spec — remove it.`);
            }
            else if (!batchKeys.has(ref)) {
                w.errors.push(`draft '${w.draft.temp_key}': related_by_temp_key '${ref}' is not a temp_key in this batch. Fix: intra-batch refs use temp_keys; refs to already-existing specs belong in the draft's related_specs frontmatter.`);
            }
        }
    }
    {
        const relIndexCache = new Map([[scope, index]]);
        const availableScopes = new Set(getAvailableScopes(root).map((s) => s.id));
        for (const w of works) {
            const dangling = danglingRelatedSpecs(w.fm?.related_specs, scope, root, relIndexCache, availableScopes);
            if (dangling.length > 0)
                w.errors.push(`draft '${w.draft.temp_key}': related_specs reference unknown spec(s): ` +
                    `${dangling.join(', ')}. Fix: related_specs must point to EXISTING specs; ` +
                    `intra-batch refs use related_by_temp_key.`);
        }
    }
    {
        const ackSingle = new Set(args.acknowledge_single_rule_temp_keys ?? []);
        for (const w of works) {
            const sig = oneRuleSignals(extractSectionContent(w.body, 'Rule Statement') ?? '');
            if (sig.hold.length > 0 && !ackSingle.has(w.draft.temp_key))
                w.errors.push(`draft '${w.draft.temp_key}': Rule Statement encodes more than one rule (${sig.hold.join('; ')}). ` +
                    `Split into separate drafts (link via related_by_temp_key), OR add '${w.draft.temp_key}' to ` +
                    `acknowledge_single_rule_temp_keys if it is genuinely one rule.`);
            else
                w.warnings.push(...sig.warn);
        }
    }
    for (const w of works) {
        if (!w.candidate || w.candidate.title === '')
            continue;
        const matches = findSpecDuplicates(w.candidate, index.specs);
        for (const m of matches.filter((x) => x.tier === 'possible')) {
            w.warnings.push(dedupMessage(w.candidate.title, m));
        }
        const near = matches.filter((x) => x.tier === 'near_certain');
        if (near.length === 0)
            continue;
        if (ack.has(w.draft.temp_key)) {
            w.warnings.push(`draft '${w.draft.temp_key}': created despite near-certain match(es) ${near.map((m) => m.spec_id).join(', ')} — acknowledged distinct.`);
        }
        else {
            w.status = 'near_certain';
            w.matches = near;
            w.errors.push(`draft '${w.draft.temp_key}': near-certain duplicate of existing ${near.map((m) => m.spec_id).join(', ')}. Resolve: acknowledge_distinct_temp_keys, drop it, or spec_write(op:update) the existing spec.`);
        }
    }
    for (let i = 0; i < works.length; i++) {
        const a = works[i];
        if (!a.candidate || a.candidate.title === '')
            continue;
        for (let j = 0; j < i; j++) {
            const b = works[j];
            if (!b.candidate || b.candidate.title === '' || a.domain !== b.domain)
                continue;
            if (ack.has(a.draft.temp_key) || ack.has(b.draft.temp_key))
                continue;
            if (scoreSpecPair(a.candidate, b.candidate).tier === 'near_certain') {
                a.errors.push(`draft '${a.draft.temp_key}': near-certain duplicate of draft '${b.draft.temp_key}' in this batch. Resolve: merge or drop one, or add '${a.draft.temp_key}' or '${b.draft.temp_key}' to acknowledge_distinct_temp_keys.`);
                break;
            }
        }
    }
    const domainsEcho = () => newDomains.size > 0 ? { domains: composeDomainsEcho(scope, root) } : {};
    const flagged = () => works.some((w) => w.errors.length > 0);
    if (flagged())
        return {
            ok: false,
            results: works.map((w) => batchDraftResult(w)),
            errors: [],
            warnings: [],
            ...domainsEcho(),
        };
    if (args.dry_run) {
        return {
            ok: true,
            results: works.map((w) => batchDraftResult(w, 'clean')),
            errors: [],
            warnings: [],
            ...domainsEcho(),
        };
    }
    const nextSerial = new Map();
    const tempToId = new Map();
    try {
        for (const w of works) {
            const cur = nextSerial.get(w.domain) ?? index.domains.find((d) => d.name === w.domain)?.next_serial ?? 1;
            const existingIds = index.specs.filter((s) => s.domain === w.domain).map((s) => s.spec_id);
            const { specId, nextSerial: ns } = mintSpecId(w.domain, cur, existingIds);
            w.assignedSpecId = specId;
            tempToId.set(w.draft.temp_key, specId);
            nextSerial.set(w.domain, ns);
        }
    }
    catch (e) {
        return {
            ok: false,
            results: works.map((w) => batchDraftResult(w)),
            errors: [e instanceof Error ? e.message : String(e)],
            warnings: [],
            ...domainsEcho(),
        };
    }
    const today = isoDate();
    const prepared = works.map((w) => {
        const resolved = (w.draft.related_by_temp_key ?? []).map((k) => tempToId.get(k));
        const front = Array.isArray(w.fm.related_specs) ? w.fm.related_specs : [];
        const related = [...new Set([...front, ...resolved])];
        const finalFm = assembleFrontmatter({
            ...w.fm,
            spec_id: w.assignedSpecId,
            scope,
            ...(related.length > 0 ? { related_specs: related } : {}),
            created_at: today,
            updated_at: today,
        });
        const finalMd = composeSpecMarkdown(finalFm, w.body);
        const post = validatePostMintMd(finalMd, w.assignedSpecId);
        if (!post.passed)
            w.errors.push(...post.details.map((d) => `draft '${w.draft.temp_key}': ${d}`));
        const fingerprint = computeContentFingerprint(extractSectionContent(w.body, 'Rule Statement') ?? '');
        return { w, finalMd, finalFm, fingerprint };
    });
    if (flagged())
        return {
            ok: false,
            results: works.map((w) => batchDraftResult(w)),
            errors: [],
            warnings: [],
            ...domainsEcho(),
        };
    const written = [];
    try {
        let idx = index;
        for (const p of prepared) {
            writeSpecMarkdown(scope, p.w.domain, p.w.assignedSpecId, p.finalMd, root);
            written.push(specFilePath(scope, p.w.domain, p.w.assignedSpecId, root));
            idx = ensureDomainInIndex(idx, p.w.domain, newDomainDesc.get(p.w.domain) ?? '');
            idx = setDomainNextSerial(idx, p.w.domain, nextSerial.get(p.w.domain));
            idx = upsertSpecInIndex(idx, deriveIndexEntry(p.finalFm, specRelPath(scope, p.w.domain, p.w.assignedSpecId), p.fingerprint));
        }
        writeSpecIndex(scope, idx, root);
    }
    catch (e) {
        for (const p of written)
            deleteSpecMarkdown(p);
        throw e;
    }
    return {
        ok: true,
        results: works.map((w) => batchDraftResult(w, 'written')),
        errors: [],
        warnings: [],
        ...domainsEcho(),
    };
}
export function toolSpecSearch(args, root = '.') {
    const scopes = args.scope ? [args.scope] : resolveReadScopes(resolveActiveScope(null, root)[0]);
    let results = scopes.flatMap((s) => {
        try {
            return [...readSpecIndex(s, root).specs];
        }
        catch {
            return [];
        }
    });
    if (args.domain) {
        const d = args.domain;
        results = results.filter((e) => e.domain === d || e.domain.startsWith(d));
    }
    if (args.query) {
        const q = args.query.toLowerCase();
        results = results.filter((e) => `${e.title} ${e.summary}`.toLowerCase().includes(q));
    }
    if (args.applies_to && args.applies_to.length > 0) {
        const want = new Set(args.applies_to);
        results = results.filter((e) => e.applies_to.some((a) => want.has(a)));
    }
    const echoScope = args.scope ?? resolveActiveScope(null, root)[0];
    return { results, domains: composeDomainsEcho(echoScope, root) };
}
export const SPEC_ROLES = [
    'implements',
    'configures',
    'verifies',
    'uses',
    'affects',
];
export function toolSpecLink(args, root = '.') {
    const scope = args.scope ?? resolveActiveScope(null, root)[0];
    try {
        const index = readSpecIndex(scope, root);
        const specEntry = index.specs.find((s) => s.spec_id === args.spec_id);
        if (!specEntry) {
            return {
                ok: false,
                errors: [`spec '${args.spec_id}' not found in scope '${scope}'`],
                warnings: [],
            };
        }
        const registry = readSpecRegistry(scope, root);
        if (args.op === 'add') {
            if (!args.role || !SPEC_ROLES.includes(args.role)) {
                return {
                    ok: false,
                    errors: [`add requires a valid role (one of: ${SPEC_ROLES.join(', ')})`],
                    warnings: [],
                };
            }
            if (!existsSync(join(root, args.file))) {
                return { ok: false, errors: [`file '${args.file}' does not exist`], warnings: [] };
            }
            const mapping = registry.mappings[args.spec_id] ?? {
                spec: specEntry.path,
                implemented_by: [],
            };
            const already = mapping.implemented_by.find((e) => e.file === args.file);
            if (already && already.role === args.role) {
                return {
                    ok: true,
                    errors: [],
                    warnings: [`mapping ${args.file} → ${args.spec_id} already present`],
                };
            }
            const entry = {
                file: args.file,
                role: args.role,
                ...(args.note ? { note: args.note } : {}),
                added_by: args.added_by ?? getCurrentRunId() ?? 'unknown',
                added_at: isoDate(),
            };
            const implemented_by = already
                ? mapping.implemented_by.map((e) => (e.file === args.file ? entry : e))
                : [...mapping.implemented_by, entry];
            const next = {
                ...registry,
                mappings: { ...registry.mappings, [args.spec_id]: { ...mapping, implemented_by } },
            };
            writeSpecRegistry(scope, next, root);
            return { ok: true, errors: [], warnings: [] };
        }
        if (!args.reason || args.reason.trim() === '') {
            return { ok: false, errors: ['remove requires a non-empty reason'], warnings: [] };
        }
        const mapping = registry.mappings[args.spec_id];
        const existing = mapping?.implemented_by.find((e) => e.file === args.file);
        if (!mapping || !existing) {
            return {
                ok: false,
                errors: [`no mapping ${args.file} → ${args.spec_id} to remove`],
                warnings: [],
            };
        }
        const implemented_by = mapping.implemented_by.filter((e) => e.file !== args.file);
        const mappings = { ...registry.mappings };
        if (implemented_by.length === 0) {
            delete mappings[args.spec_id];
        }
        else {
            mappings[args.spec_id] = { ...mapping, implemented_by };
        }
        writeSpecRegistry(scope, { ...registry, mappings }, root);
        return {
            ok: true,
            errors: [],
            warnings: [
                `removed mapping ${args.file} → ${args.spec_id} (added by ${existing.added_by} on ${existing.added_at}); reason: ${args.reason}`,
            ],
        };
    }
    catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)], warnings: [] };
    }
}
