export declare class OutputPathError extends Error {
    constructor(message: string);
}
export declare function assertConcreteParamValue(value: string, token: string): string;
export declare function resolveConcreteOutputPath(rawPath: string, params: Record<string, unknown>): string;
