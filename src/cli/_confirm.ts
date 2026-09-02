
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

export type ConfirmOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'no-terminal' | 'mismatch' };

export type PromptFn = (question: string) => Promise<string>;

export function confirmationPrompt(expectedId: string, action: string): string {
  return (
    `\nTyping the id below is the confirmation — there is no y/n here, and no flag ` +
    `that skips it.\nA "y" gets pressed without reading; a name only gets typed by ` +
    `someone who looked at\nwhat is above. Anything else cancels, and nothing changes.\n` +
    `\n  Type this id to ${action}:  ${expectedId}\n` +
    `> `
  );
}

export async function confirmByTypingId(
  expectedId: string,
  question: string,
  injected?: PromptFn,
): Promise<ConfirmOutcome> {
  const ask = injected ?? defaultAsk;
  if (injected === undefined && process.stdin.isTTY !== true) {
    return { ok: false, reason: 'no-terminal' };
  }
  const answer = (await ask(question)).trim();
  return answer === expectedId ? { ok: true } : { ok: false, reason: 'mismatch' };
}

export function noTerminalReason(): string {
  return 'this confirmation must be typed at an interactive terminal — stdin is not a TTY here.';
}

const defaultAsk: PromptFn = async (question: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};
