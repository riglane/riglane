export declare function geminiAgentAckPath(homeDir?: string): string;
export declare function geminiAgentHash(content: string): string;
export interface GeminiAckOptions {
    readonly dryRun?: boolean;
    readonly homeDir?: string;
}
export declare function ackGeminiAgents(projectRoot: string, opts?: GeminiAckOptions): string[];
export declare function checkGeminiAgentAcks(projectRoot: string, homeDir?: string): string[];
