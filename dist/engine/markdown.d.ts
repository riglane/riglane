export interface MarkdownParseResult {
    readonly frontmatter: Record<string, unknown> | null;
    readonly body: string;
}
export declare function parseMarkdownFrontmatter(filePath: string): MarkdownParseResult;
export declare function parseMarkdownFrontmatterString(content: string): MarkdownParseResult;
export declare function parseMarkdownSections(body: string): string[];
export declare function extractSectionContent(body: string, sectionName: string): string | null;
