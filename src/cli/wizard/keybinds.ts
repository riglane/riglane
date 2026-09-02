
export interface Keybind {
  key: string;
  label: string;
}

export const defaultKeybinds: Keybind[] = [
  { key: '↑↓', label: 'navigate' },
  { key: 'enter', label: 'select' },
  { key: 'esc', label: 'back' },
  { key: '?', label: 'help' },
  { key: 'q', label: 'quit' },
];

export const tabKeybinds: Keybind[] = [
  { key: 'tab', label: 'next tab' },
  { key: 'shift+tab', label: 'prev tab' },
];

export const editKeybinds: Keybind[] = [
  { key: 'enter', label: 'commit' },
  { key: 'esc', label: 'cancel' },
];

export const confirmKeybinds: Keybind[] = [
  { key: 'y', label: 'yes' },
  { key: 'n', label: 'no' },
  { key: 'esc', label: 'cancel' },
];

export const tooltipKeybinds: Keybind[] = [
  { key: '←', label: 'open tooltip' },
  { key: '→', label: 'close tooltip' },
];
