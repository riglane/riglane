
import type {
  BundledFileEntry,
  CapabilityFlag,
  DeciderEntry,
  ScriptToolEntry,
  WorkflowInventory,
} from './inventory.js';

export interface CommandChange {
  readonly key: string;
  readonly before: string;
  readonly after: string;
}

export interface FileChange {
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

export interface InventoryDiff {
  readonly tools: {
    readonly added: readonly ScriptToolEntry[];
    readonly removed: readonly ScriptToolEntry[];
    readonly changed: readonly CommandChange[];
  };
  readonly deciders: {
    readonly added: readonly DeciderEntry[];
    readonly removed: readonly DeciderEntry[];
    readonly changed: readonly CommandChange[];
  };
  readonly executables: {
    readonly added: readonly BundledFileEntry[];
    readonly removed: readonly BundledFileEntry[];
    readonly changed: readonly FileChange[];
  };
  readonly newFlags: readonly CapabilityFlag[];
  readonly shellSurfaceChanged: boolean;
}

const deciderKey = (d: DeciderEntry): string => `${d.field} @ ${d.at}`;
const flagKey = (f: CapabilityFlag): string => `${f.flag}${f.where}${f.match}`;
const isExecutable = (b: BundledFileEntry): boolean => b.role === 'script' || b.role === 'mcp-server';

export function diffInventories(oldInv: WorkflowInventory, newInv: WorkflowInventory): InventoryDiff {
  const oldTools = new Map(oldInv.script_tools.map((t) => [t.name, t]));
  const newTools = new Map(newInv.script_tools.map((t) => [t.name, t]));
  const tools = {
    added: [...newTools.values()].filter((t) => !oldTools.has(t.name)),
    removed: [...oldTools.values()].filter((t) => !newTools.has(t.name)),
    changed: [...newTools.values()]
      .filter((t) => oldTools.has(t.name) && oldTools.get(t.name)?.command !== t.command)
      .map((t) => ({ key: t.name, before: oldTools.get(t.name)?.command ?? '', after: t.command })),
  };

  const oldDec = new Map(oldInv.deciders.map((d) => [deciderKey(d), d]));
  const newDec = new Map(newInv.deciders.map((d) => [deciderKey(d), d]));
  const deciders = {
    added: [...newDec.values()].filter((d) => !oldDec.has(deciderKey(d))),
    removed: [...oldDec.values()].filter((d) => !newDec.has(deciderKey(d))),
    changed: [...newDec.values()]
      .filter((d) => oldDec.has(deciderKey(d)) && oldDec.get(deciderKey(d))?.command !== d.command)
      .map((d) => ({
        key: deciderKey(d),
        before: oldDec.get(deciderKey(d))?.command ?? '',
        after: d.command,
      })),
  };

  const oldExe = new Map(oldInv.bundled_files.filter(isExecutable).map((b) => [b.path, b]));
  const newExe = new Map(newInv.bundled_files.filter(isExecutable).map((b) => [b.path, b]));
  const executables = {
    added: [...newExe.values()].filter((b) => !oldExe.has(b.path)),
    removed: [...oldExe.values()].filter((b) => !newExe.has(b.path)),
    changed: [...newExe.values()]
      .filter((b) => oldExe.has(b.path) && oldExe.get(b.path)?.sha256 !== b.sha256)
      .map((b) => ({ path: b.path, before: oldExe.get(b.path)?.sha256 ?? '', after: b.sha256 })),
  };

  const oldFlags = new Set(oldInv.capabilities.flags.map(flagKey));
  const newFlags = newInv.capabilities.flags.filter((f) => !oldFlags.has(flagKey(f)));

  const shellSurfaceChanged =
    tools.added.length + tools.removed.length + tools.changed.length > 0 ||
    deciders.added.length + deciders.removed.length + deciders.changed.length > 0 ||
    executables.added.length + executables.removed.length + executables.changed.length > 0 ||
    newFlags.length > 0;

  return { tools, deciders, executables, newFlags, shellSurfaceChanged };
}
