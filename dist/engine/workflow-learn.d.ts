export declare const AVAILABLE_TOPICS: readonly string[];
export interface WorkflowLearnInput {
    readonly topic?: string;
}
export interface WorkflowLearnOutput {
    readonly content?: string;
    readonly error?: string;
    readonly available_topics?: readonly string[];
}
export declare function toolWorkflowLearn(args: WorkflowLearnInput): WorkflowLearnOutput;
