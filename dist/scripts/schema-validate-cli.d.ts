export interface SchemaValidateCliOptions {
    readonly stdout?: (s: string) => void;
    readonly stderr?: (s: string) => void;
}
export declare function runSchemaValidateCli(argv?: string[], opts?: SchemaValidateCliOptions): Promise<number>;
