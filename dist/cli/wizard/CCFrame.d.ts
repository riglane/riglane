import { type ReactNode } from 'react';
import type { Keybind } from './keybinds.js';
export declare function useTerminalWidth(): number;
export interface Tab {
    id: string;
    label: string;
}
export interface CCFrameProps {
    tabs?: Tab[];
    activeTab?: string;
    children: ReactNode;
    width?: number;
    hideLogo?: boolean;
    hideTabs?: boolean;
}
export declare function CCFrame({ tabs, activeTab, children, width, hideLogo, hideTabs, }: CCFrameProps): React.ReactElement;
export declare function KeybindHint({ keybinds }: {
    keybinds: Keybind[];
}): React.ReactElement;
