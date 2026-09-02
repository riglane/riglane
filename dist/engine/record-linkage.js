export function normalizeText(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
export function levenshtein(a, b) {
    if (a === b)
        return 0;
    if (!a.length)
        return b.length;
    if (!b.length)
        return a.length;
    const prev = [];
    for (let j = 0; j <= b.length; j++)
        prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        const ai = a[i - 1];
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (ai === b[j - 1] ? 0 : 1));
            diag = tmp;
        }
    }
    return prev[b.length];
}
export function simRatio(a, b) {
    const max = Math.max(a.length, b.length);
    if (max === 0)
        return 1;
    return 1 - levenshtein(a, b) / max;
}
export function jaccard(a, b) {
    if (a.size === 0 && b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}
export function tokenSet(s) {
    const norm = normalizeText(s);
    return new Set(norm.length > 0 ? norm.split(' ') : []);
}
export function tokenJaccard(a, b) {
    return jaccard(tokenSet(a), tokenSet(b));
}
export function textSimilarity(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (na === nb)
        return 1;
    return Math.max(simRatio(na, nb), tokenJaccard(a, b));
}
export function listJaccard(a, b) {
    return jaccard(new Set(a.map(normalizeText)), new Set(b.map(normalizeText)));
}
