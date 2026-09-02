import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useStdout } from 'ink';
import { useEffect, useState } from 'react';
import { useTheme } from './themeContext.js';
import { useTerminalRows, ViewportContext } from './viewport.js';
export function useTerminalWidth() {
    const { stdout } = useStdout();
    const [columns, setColumns] = useState(stdout?.columns ?? 80);
    useEffect(() => {
        if (!stdout)
            return undefined;
        let timeoutId;
        const onResize = () => {
            if (timeoutId)
                clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                setColumns(stdout.columns ?? 80);
            }, 100);
        };
        stdout.on('resize', onResize);
        return () => {
            if (timeoutId)
                clearTimeout(timeoutId);
            stdout.off('resize', onResize);
        };
    }, [stdout]);
    return columns;
}
const FALLBACK_WIDTH = 64;
const LOGO_LINES_FULL = [
    '╦═╗╦╔═╗╦  ╔═╗╔╗╔╔═╗',
    '╠╦╝║║ ╦║  ╠═╣║║║║╣ ',
    '╩╚═╩╚═╝╩═╝╩ ╩╝╚╝╚═╝',
];
const LOGO_FULL_WIDTH = LOGO_LINES_FULL.reduce((m, l) => Math.max(m, l.length), 0);
const LOGO_COMPACT = 'RIGLANE';
const BORDER_COST = 2;
const PADDING_COST = 2;
const CHROME_COST = BORDER_COST + PADDING_COST;
const LOGO_RANK = { none: 0, compact: 1, full: 2 };
function pickLogoTier(innerWidth, rows) {
    const widthTier = innerWidth >= LOGO_FULL_WIDTH ? 'full' : innerWidth >= LOGO_COMPACT.length ? 'compact' : 'none';
    const heightTier = rows >= 24 ? 'full' : rows >= 18 ? 'compact' : 'none';
    return LOGO_RANK[widthTier] <= LOGO_RANK[heightTier] ? widthTier : heightTier;
}
function fullTabsWidth(tabs) {
    if (tabs.length === 0)
        return 0;
    const labelCost = tabs.reduce((sum, t) => sum + t.label.length, 0);
    const gapCost = (tabs.length - 1) * 2;
    return labelCost + gapCost;
}
const TAB_HINT = 'tab / shift+tab to switch';
export function CCFrame({ tabs = [], activeTab, children, width, hideLogo = false, hideTabs = false, }) {
    const theme = useTheme();
    const liveCols = useTerminalWidth();
    const liveRows = useTerminalRows();
    const ABSOLUTE_FLOOR = 12;
    const rawAvail = Math.max(ABSOLUTE_FLOOR, width ?? liveCols ?? FALLBACK_WIDTH);
    const targetOuter = Math.max(ABSOLUTE_FLOOR, rawAvail - 1);
    const innerWidth = Math.max(1, targetOuter - CHROME_COST);
    const divider = '─'.repeat(innerWidth);
    const tight = liveRows < 20;
    const logoTier = hideLogo ? 'none' : pickLogoTier(innerWidth, liveRows);
    const tabsShown = tabs.length > 0 && !hideTabs;
    const showFullTabs = tabsShown && innerWidth >= fullTabsWidth(tabs);
    const showHint = tabsShown && tabs.length > 1 && innerWidth >= TAB_HINT.length && !tight;
    const activeIndex = tabs.findIndex((t) => t.id === activeTab);
    const activeTabObj = activeIndex >= 0 ? tabs[activeIndex] : tabs[0];
    const logoRows = logoTier === 'full' ? LOGO_LINES_FULL.length : logoTier === 'compact' ? 1 : 0;
    const frameChrome = 2 +
        logoRows +
        1 +
        (tabsShown ? 1 : 0) +
        (showHint ? 1 : 0) +
        (tight ? 0 : 1);
    const contentRows = Math.max(4, liveRows - frameChrome);
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: theme.brand, paddingX: 1, children: [logoTier === 'full' ? (_jsx(Box, { flexDirection: "column", children: LOGO_LINES_FULL.map((line, i) => (_jsx(Text, { color: theme.brand, children: line }, i))) })) : null, logoTier === 'compact' ? (_jsx(Box, { children: _jsx(Text, { color: theme.brand, bold: true, children: LOGO_COMPACT }) })) : null, _jsx(Box, { children: _jsx(Text, { color: theme.muted, children: divider }) }), tabsShown && showFullTabs ? (_jsx(Box, { children: tabs.map((t, i) => (_jsx(Box, { marginRight: i === tabs.length - 1 ? 0 : 2, children: _jsx(TabLabel, { label: t.label, active: t.id === activeTab }) }, t.id))) })) : null, tabsShown && !showFullTabs && activeTabObj ? (_jsxs(Box, { children: [_jsx(Text, { color: theme.muted, children: "\u2039 " }), _jsx(Text, { color: theme.brand, bold: true, children: activeTabObj.label }), _jsxs(Text, { color: theme.muted, children: [' ', "(", Math.max(activeIndex, 0) + 1, "/", tabs.length, ") \u203A"] })] })) : null, showHint ? (_jsx(Box, { children: _jsx(Text, { color: theme.hint, children: TAB_HINT }) })) : null, _jsx(Box, { flexDirection: "column", marginTop: tight ? 0 : 1, children: _jsx(ViewportContext.Provider, { value: contentRows, children: children }) })] }));
}
function TabLabel({ label, active }) {
    const theme = useTheme();
    if (active) {
        return (_jsx(Text, { color: theme.brand, bold: true, children: label }));
    }
    return _jsx(Text, { color: theme.tabInactive, children: label });
}
export function KeybindHint({ keybinds }) {
    const theme = useTheme();
    return (_jsx(Box, { children: keybinds.map((kb, i) => (_jsxs(Box, { marginRight: i === keybinds.length - 1 ? 0 : 2, children: [_jsx(Text, { color: theme.highlight, children: kb.key }), _jsxs(Text, { color: theme.muted, children: [" ", kb.label] })] }, kb.key))) }));
}
