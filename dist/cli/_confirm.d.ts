export type ConfirmOutcome = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: 'no-terminal' | 'mismatch';
};
export type PromptFn = (question: string) => Promise<string>;
export declare function confirmationPrompt(expectedId: string, action: string): string;
export declare function confirmByTypingId(expectedId: string, question: string, injected?: PromptFn): Promise<ConfirmOutcome>;
export declare function noTerminalReason(): string;
