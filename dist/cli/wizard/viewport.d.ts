export declare function windowAround(total: number, focus: number, capacity: number): {
    start: number;
    end: number;
};
export declare function useTerminalRows(): number;
export declare const ViewportContext: import("react").Context<number>;
export declare function useViewportRows(): number;
export declare function MoreRow({ count, dir }: {
    count: number;
    dir: 'up' | 'down';
}): React.JSX.Element | null;
