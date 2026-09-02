import { instruction } from '../engine/instruction-files.js';

export const SPEC_GUIDANCE_NUDGE_BODY: string = instruction('spec/guidance-nudge');

export const CC_RULE_FRONTMATTER = [
  '---',
  '# No `paths:` field → this rule loads unconditionally (always-on, every session).',
  '---',
].join('\n');

export const CURSOR_RULE_FRONTMATTER = [
  '---',
  'alwaysApply: true',
  'description: "Riglane behavioral specs — respect relevant specs when changing the project (a conflict is above your level: STOP and surface); propose a spec for durable requirements."',
  '---',
].join('\n');

export const OPENCODE_RULE_FRONTMATTER = [
  '<!-- Riglane spec-guidance nudge — written by `riglane init --opencode` / `riglane update`.',
  '     Injected into every session via the `instructions` entry in .opencode/opencode.json. -->',
].join('\n');

export const COPILOT_RULE_FRONTMATTER = [
  '---',
  'applyTo: "**"',
  'description: "Riglane behavioral specs — respect relevant specs when changing the project (a conflict is above your level: STOP and surface); propose a spec for durable requirements."',
  '---',
].join('\n');

export function ruleFileContent(frontmatter: string): string {
  return `${frontmatter}\n\n${SPEC_GUIDANCE_NUDGE_BODY}\n`;
}
