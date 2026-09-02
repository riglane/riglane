import { listJaccard, normalizeText, textSimilarity } from './record-linkage.js';
export const SPEC_DEDUP_WEIGHTS = { title: 0.4, applies_to: 0.25, summary: 0.15 };
export const SPEC_DEDUP_THRESHOLD = 0.72;
export const SPEC_DEDUP_NEAR_CERTAIN = 0.95;
export const DOMAIN_DEDUP_WEIGHTS = { name: 0.6, description: 0.4 };
export const DOMAIN_DEDUP_THRESHOLD = 0.6;
export function scoreSpecPair(a, b) {
    const titleSim = textSimilarity(a.title, b.title);
    const appliesSim = listJaccard(a.applies_to, b.applies_to);
    const summarySim = textSimilarity(a.summary, b.summary);
    const hasSource = !!a.source_sections?.length && !!b.source_sections?.length;
    const sourceSim = hasSource ? listJaccard(a.source_sections, b.source_sections) : 0;
    let score = SPEC_DEDUP_WEIGHTS.title * titleSim +
        SPEC_DEDUP_WEIGHTS.applies_to * appliesSim +
        SPEC_DEDUP_WEIGHTS.summary * summarySim;
    const signals = [];
    const titleExact = normalizeText(a.title) === normalizeText(b.title);
    const sameDomain = a.domain === b.domain;
    const sourceExact = hasSource && sourceSim === 1;
    if (titleExact)
        signals.push('same title');
    else if (titleSim >= 0.7)
        signals.push(`similar title (${titleSim.toFixed(2)})`);
    if (appliesSim >= 0.5)
        signals.push(`shared applies_to (${appliesSim.toFixed(2)})`);
    if (summarySim >= 0.7)
        signals.push(`similar summary (${summarySim.toFixed(2)})`);
    if (hasSource && sourceSim >= 0.5)
        signals.push(`shared source_sections (${sourceSim.toFixed(2)})`);
    let tier;
    if ((titleExact && sameDomain) || sourceExact) {
        score = Math.max(score, SPEC_DEDUP_NEAR_CERTAIN);
        tier = 'near_certain';
    }
    else if (score >= SPEC_DEDUP_THRESHOLD) {
        tier = 'possible';
    }
    else {
        tier = 'none';
    }
    return { score, tier, signals };
}
export function findSpecDuplicates(candidate, existing, opts) {
    const pool = opts?.crossDomain ? existing : existing.filter((e) => e.domain === candidate.domain);
    return pool
        .map((e) => {
        const { score, tier, signals } = scoreSpecPair(candidate, {
            title: e.title,
            summary: e.summary,
            applies_to: e.applies_to,
            domain: e.domain,
        });
        return { spec_id: e.spec_id, title: e.title, summary: e.summary, score, tier, signals };
    })
        .filter((m) => m.tier !== 'none')
        .sort((x, y) => y.score - x.score);
}
export function dedupMessage(candidateTitle, match) {
    const why = match.signals.join(', ');
    return (`'${candidateTitle}' looks like existing spec ${match.spec_id} '${match.title}' — ${why}. ` +
        `If it is the same requirement, update ${match.spec_id}; otherwise acknowledge they are distinct.`);
}
export function findDomainDuplicates(candidate, existing) {
    return existing
        .filter((d) => d.name !== candidate.name)
        .map((d) => {
        const nameSim = textSimilarity(candidate.name, d.name);
        const descSim = textSimilarity(candidate.description, d.description);
        const score = DOMAIN_DEDUP_WEIGHTS.name * nameSim + DOMAIN_DEDUP_WEIGHTS.description * descSim;
        const signals = [];
        if (nameSim >= 0.6)
            signals.push(`similar name (${nameSim.toFixed(2)})`);
        if (descSim >= 0.6)
            signals.push(`similar description (${descSim.toFixed(2)})`);
        return { name: d.name, score, signals };
    })
        .filter((m) => m.score >= DOMAIN_DEDUP_THRESHOLD)
        .sort((x, y) => y.score - x.score);
}
