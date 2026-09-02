
export interface RunWizardOptions {
  legacy?: boolean;
}

export async function runWizard(_opts: RunWizardOptions = {}): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      '[riglane] ui: needs an interactive terminal (TTY) — stdin is not a TTY here.\n',
    );
    return 2;
  }
  const { runWizardInk } = await import('../wizard/wizardInk.js');
  return runWizardInk();
}
