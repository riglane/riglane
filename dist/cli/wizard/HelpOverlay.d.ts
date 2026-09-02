import type { Keybind } from './keybinds.js';
export interface HelpOverlayProps {
    title?: string;
    sections: Array<{
        heading: string;
        keybinds: Keybind[];
    }>;
}
export declare function HelpOverlay({ title, sections }: HelpOverlayProps): React.ReactElement;
