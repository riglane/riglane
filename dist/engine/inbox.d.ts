export type InboxKind = 'human_gate' | 'loop_decision' | 'route_decision' | 'info';
export type ResponseType = 'accept' | 'reject' | 'choice' | 'respond' | 'edit';
export type ResponseVia = 'terminal' | 'web' | 'api' | 'webhook';
export interface InboxOptions {
    readonly accept?: boolean;
    readonly reject?: boolean;
    readonly respond?: boolean;
    readonly edit?: boolean;
}
export interface InboxRequest {
    readonly action: string;
    readonly args?: Record<string, unknown>;
    readonly choices?: readonly string[];
    readonly recommended?: string;
}
export interface InboxItem {
    readonly id: string;
    readonly title: string;
    readonly body?: string;
    readonly options?: InboxOptions;
    readonly request?: InboxRequest;
}
export interface InboxMessageContent {
    readonly kind?: InboxKind;
    readonly title: string;
    readonly body?: string;
    readonly request?: InboxRequest;
    readonly options?: InboxOptions;
    readonly items?: readonly InboxItem[];
}
export interface InboxItemResponse {
    readonly type: ResponseType;
    readonly text?: string;
    readonly args?: Record<string, unknown>;
}
export interface InboxResponse {
    readonly type: ResponseType | 'items';
    readonly text?: string;
    readonly args?: Record<string, unknown>;
    readonly items?: Record<string, InboxItemResponse>;
    readonly responded_at: string;
    readonly via: ResponseVia;
}
export interface VerifiedOutput {
    readonly path: string;
    readonly exists: boolean;
    readonly size?: number;
    readonly mtime?: string;
    readonly value_preview?: string | null;
    readonly truncated?: boolean;
    readonly binary?: boolean;
}
export interface InboxMessage extends InboxMessageContent {
    readonly message_id: string;
    readonly run_id: string;
    readonly workflow: string;
    readonly step: string;
    readonly kind: InboxKind;
    readonly created_at: string;
    readonly response: InboxResponse | null;
    readonly respond_token: string;
    readonly delivery?: InboxDelivery;
    readonly superseded_by?: string;
    readonly superseded_at?: string;
    readonly verified_context?: readonly VerifiedOutput[];
}
export type MessageState = 'open' | 'answered' | 'superseded';
export declare function messageState(msg: Pick<InboxMessage, 'response'> & {
    readonly superseded_by?: string;
}): MessageState;
export declare function expectsAnswer(kind: InboxKind): boolean;
export interface InboxDelivery {
    readonly url: string;
    readonly event: WebhookEvent;
    readonly attempts: number;
    readonly delivered_at?: string;
    readonly last_attempt_at?: string;
    readonly last_error?: string;
    readonly settled: boolean;
}
export declare function validateMessageContent(content: unknown): string[] | null;
export declare function allowedResponseTypes(msg: InboxMessageContent): ResponseType[];
export declare function allowedItemResponseTypes(item: InboxItem): ResponseType[];
export declare function isValidMessageId(id: string): boolean;
export declare function inboxDir(runtimeDir: string): string;
export declare function messagePath(runtimeDir: string, messageId: string): string;
export declare function postMessage(runtimeDir: string, identity: {
    run_id: string;
    workflow: string;
    step: string;
}, content: InboxMessageContent, opts?: {
    respondUrl?: string | null;
    webhookUrl?: string | null;
    stepStartedAt?: string | null;
    verifiedContext?: readonly VerifiedOutput[] | null;
}): Promise<{
    message: InboxMessage;
} | {
    errors: string[];
}>;
export type PublicInboxMessage = Omit<InboxMessage, 'respond_token' | 'delivery'>;
export declare function publicMessage(msg: InboxMessage): PublicInboxMessage;
export declare function readMessage(runtimeDir: string, messageId: string): InboxMessage | null;
export declare function listMessages(runtimeDir: string): InboxMessage[];
export declare function respondMessage(runtimeDir: string, messageId: string, response: {
    type: string;
    text?: string;
    args?: Record<string, unknown>;
    items?: Record<string, {
        type: string;
        text?: string;
        args?: Record<string, unknown>;
    }>;
}, via: ResponseVia, opts?: {
    webhookUrl?: string | null;
    respondUrl?: string | null;
}): Promise<{
    message: InboxMessage;
} | {
    error: string;
}>;
export declare function findStepMessage(runtimeDir: string, step: string, kind?: InboxKind): InboxMessage | null;
export declare function findStepMessages(runtimeDir: string, step: string, kind?: InboxKind): InboxMessage[];
export declare function composeTerminalPresentation(msg: InboxMessage): string;
export interface ElicitationForm {
    readonly message: string;
    readonly requestedSchema: Record<string, unknown>;
}
export declare function composeElicitation(msg: InboxMessage): ElicitationForm;
type MappedResponse = {
    type: string;
    text?: string;
    args?: Record<string, unknown>;
    items?: Record<string, {
        type: string;
        text?: string;
        args?: Record<string, unknown>;
    }>;
};
export declare function mapElicitationContent(msg: InboxMessage, content: Record<string, unknown>): {
    response: MappedResponse;
} | {
    error: string;
};
export type WebhookEvent = 'question' | 'answered' | 'superseded';
export interface WebhookEnvelope {
    readonly event: WebhookEvent;
    readonly message: PublicInboxMessage;
    readonly respond?: {
        readonly url: string;
        readonly token: string;
        readonly body: {
            run: string;
            message_id: string;
            type: string;
            text?: string;
        };
    };
    readonly run: {
        readonly run_id: string;
        readonly workflow: string;
        readonly step: string;
    };
}
export type WebhookSendResult = void | {
    ok: boolean;
    permanent?: boolean;
    error?: string;
};
type WebhookSenderFn = (url: string, envelope: WebhookEnvelope) => WebhookSendResult | Promise<WebhookSendResult>;
export declare function _setWebhookSenderForTests(fn: WebhookSenderFn | null): void;
export declare function flushPendingDeliveries(runtimeDir: string, respondUrl: string | null): Promise<number>;
export declare function pushInboxEvent(runtimeDir: string, message: InboxMessage, event: WebhookEvent, opts?: {
    respondUrl?: string | null;
    webhookUrl?: string | null;
}): Promise<InboxDelivery | undefined>;
export declare function hasMessages(runtimeDir: string): boolean;
export {};
