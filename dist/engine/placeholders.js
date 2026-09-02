export function resolvePlaceholders(text, params) {
    if (!text || !params)
        return text ?? '';
    let result = text;
    for (const [pname, pval] of Object.entries(params)) {
        if (pval === null || pval === undefined)
            continue;
        const placeholder = `{${pname}}`;
        result = result.split(placeholder).join(String(pval));
    }
    return result;
}
