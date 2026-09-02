import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
export function parseMarkdownFrontmatter(filePath) {
    return parseMarkdownFrontmatterString(readFileSync(filePath, 'utf-8'));
}
export function parseMarkdownFrontmatterString(content) {
    if (!content.startsWith('---')) {
        return { frontmatter: null, body: content };
    }
    const end = content.indexOf('---', 3);
    if (end === -1) {
        return { frontmatter: null, body: content };
    }
    const frontmatterStr = content.substring(3, end).trim();
    const body = content.substring(end + 3).trim();
    const parsed = parseYaml(frontmatterStr);
    const frontmatter = parsed === null || parsed === undefined ? null : parsed;
    return { frontmatter, body };
}
export function parseMarkdownSections(body) {
    const sections = [];
    for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('## ')) {
            sections.push(line.substring(3).trim());
        }
    }
    return sections;
}
export function extractSectionContent(body, sectionName) {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startRegex = new RegExp(`^## ${escaped}\\s*$`, 'm');
    const startMatch = startRegex.exec(body);
    if (!startMatch)
        return null;
    const start = startMatch.index + startMatch[0].length;
    const remainder = body.substring(start);
    const nextRegex = /^## /m;
    const nextMatch = nextRegex.exec(remainder);
    if (nextMatch) {
        return remainder.substring(0, nextMatch.index);
    }
    return remainder;
}
