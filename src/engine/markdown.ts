
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export interface MarkdownParseResult {
  readonly frontmatter: Record<string, unknown> | null;
  readonly body: string;
}

export function parseMarkdownFrontmatter(filePath: string): MarkdownParseResult {
  return parseMarkdownFrontmatterString(readFileSync(filePath, 'utf-8'));
}

export function parseMarkdownFrontmatterString(content: string): MarkdownParseResult {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }

  const end = content.indexOf('---', 3);
  if (end === -1) {
    return { frontmatter: null, body: content };
  }

  const frontmatterStr = content.substring(3, end).trim();
  const body = content.substring(end + 3).trim();

  const parsed = parseYaml(frontmatterStr) as unknown;
  const frontmatter =
    parsed === null || parsed === undefined ? null : (parsed as Record<string, unknown>);

  return { frontmatter, body };
}

export function parseMarkdownSections(body: string): string[] {
  const sections: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      sections.push(line.substring(3).trim());
    }
  }
  return sections;
}

export function extractSectionContent(body: string, sectionName: string): string | null {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startRegex = new RegExp(`^## ${escaped}\\s*$`, 'm');
  const startMatch = startRegex.exec(body);
  if (!startMatch) return null;

  const start = startMatch.index + startMatch[0].length;
  const remainder = body.substring(start);
  const nextRegex = /^## /m;
  const nextMatch = nextRegex.exec(remainder);
  if (nextMatch) {
    return remainder.substring(0, nextMatch.index);
  }
  return remainder;
}
