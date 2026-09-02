export interface CommunityCliTask {
    readonly kind: 'add' | 'trust' | 'init' | 'update';
    readonly id: string;
    readonly wfId: string;
    readonly entryDir?: string;
    readonly cwd: string;
}
export interface CommunityPostStep {
    readonly stage: 'trust' | 'init' | 'restart';
    readonly wfId: string;
    readonly cwd: string;
}
export declare function CommunityTab({ active, onCaptureChange, onCliTask, post, }: {
    active: boolean;
    onCaptureChange: (capturing: boolean) => void;
    onCliTask: (task: CommunityCliTask) => void;
    post?: CommunityPostStep;
}): React.JSX.Element;
