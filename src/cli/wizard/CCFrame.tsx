
import { Box, Text, useStdout } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';
import { useTheme } from './themeContext.js';
import { useTerminalRows, ViewportContext } from './viewport.js';
import type { Keybind } from './keybinds.js';

export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [columns, setColumns] = useState<number>(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    const onResize = (): void => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setColumns(stdout.columns ?? 80);
      }, 100);
    };
    stdout.on('resize', onResize);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return columns;
}

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

const FALLBACK_WIDTH = 64;

const LOGO_LINES_FULL = [
  '╦═╗╦╔═╗╦  ╔═╗╔╗╔╔═╗',
  '╠╦╝║║ ╦║  ╠═╣║║║║╣ ',
  '╩╚═╩╚═╝╩═╝╩ ╩╝╚╝╚═╝',
] as const;

const LOGO_FULL_WIDTH = LOGO_LINES_FULL.reduce((m, l) => Math.max(m, l.length), 0);

const LOGO_COMPACT = 'RIGLANE';

const BORDER_COST = 2;

const PADDING_COST = 2;

const CHROME_COST = BORDER_COST + PADDING_COST;

type LogoTier = 'full' | 'compact' | 'none';

const LOGO_RANK: Record<LogoTier, number> = { none: 0, compact: 1, full: 2 };

function pickLogoTier(innerWidth: number, rows: number): LogoTier {
  const widthTier: LogoTier =
    innerWidth >= LOGO_FULL_WIDTH ? 'full' : innerWidth >= LOGO_COMPACT.length ? 'compact' : 'none';
  const heightTier: LogoTier = rows >= 24 ? 'full' : rows >= 18 ? 'compact' : 'none';
  return LOGO_RANK[widthTier] <= LOGO_RANK[heightTier] ? widthTier : heightTier;
}

function fullTabsWidth(tabs: ReadonlyArray<Tab>): number {
  if (tabs.length === 0) return 0;
  const labelCost = tabs.reduce((sum, t) => sum + t.label.length, 0);
  const gapCost = (tabs.length - 1) * 2;
  return labelCost + gapCost;
}

const TAB_HINT = 'tab / shift+tab to switch';

export function CCFrame({
  tabs = [],
  activeTab,
  children,
  width,
  hideLogo = false,
  hideTabs = false,
}: CCFrameProps): React.ReactElement {
  const theme = useTheme();
  const liveCols = useTerminalWidth();
  const liveRows = useTerminalRows();
  const ABSOLUTE_FLOOR = 12;
  const rawAvail = Math.max(ABSOLUTE_FLOOR, width ?? liveCols ?? FALLBACK_WIDTH);
  const targetOuter = Math.max(ABSOLUTE_FLOOR, rawAvail - 1);
  const innerWidth = Math.max(1, targetOuter - CHROME_COST);
  const divider = '─'.repeat(innerWidth);

  const tight = liveRows < 20;
  const logoTier: LogoTier = hideLogo ? 'none' : pickLogoTier(innerWidth, liveRows);
  const tabsShown = tabs.length > 0 && !hideTabs;
  const showFullTabs = tabsShown && innerWidth >= fullTabsWidth(tabs);
  const showHint = tabsShown && tabs.length > 1 && innerWidth >= TAB_HINT.length && !tight;

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);
  const activeTabObj = activeIndex >= 0 ? tabs[activeIndex] : tabs[0];

  const logoRows = logoTier === 'full' ? LOGO_LINES_FULL.length : logoTier === 'compact' ? 1 : 0;
  const frameChrome =
    2 +
    logoRows +
    1 +
    (tabsShown ? 1 : 0) +
    (showHint ? 1 : 0) +
    (tight ? 0 : 1);
  const contentRows = Math.max(4, liveRows - frameChrome);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1}>
      {}
      {logoTier === 'full' ? (
        <Box flexDirection="column">
          {LOGO_LINES_FULL.map((line, i) => (
            <Text key={i} color={theme.brand}>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      {logoTier === 'compact' ? (
        <Box>
          <Text color={theme.brand} bold>
            {LOGO_COMPACT}
          </Text>
        </Box>
      ) : null}

      {}
      <Box>
        <Text color={theme.muted}>{divider}</Text>
      </Box>

      {}
      {tabsShown && showFullTabs ? (
        <Box>
          {tabs.map((t, i) => (
            <Box key={t.id} marginRight={i === tabs.length - 1 ? 0 : 2}>
              <TabLabel label={t.label} active={t.id === activeTab} />
            </Box>
          ))}
        </Box>
      ) : null}
      {tabsShown && !showFullTabs && activeTabObj ? (
        <Box>
          <Text color={theme.muted}>‹ </Text>
          <Text color={theme.brand} bold>
            {activeTabObj.label}
          </Text>
          <Text color={theme.muted}>
            {' '}
            ({Math.max(activeIndex, 0) + 1}/{tabs.length}) ›
          </Text>
        </Box>
      ) : null}

      {}
      {showHint ? (
        <Box>
          <Text color={theme.hint}>
            {TAB_HINT}
          </Text>
        </Box>
      ) : null}

      {}
      <Box flexDirection="column" marginTop={tight ? 0 : 1}>
        <ViewportContext.Provider value={contentRows}>{children}</ViewportContext.Provider>
      </Box>
    </Box>
  );
}

function TabLabel({ label, active }: { label: string; active: boolean }): React.ReactElement {
  const theme = useTheme();
  if (active) {
    return (
      <Text color={theme.brand} bold>
        {label}
      </Text>
    );
  }
  return <Text color={theme.tabInactive}>{label}</Text>;
}

export function KeybindHint({ keybinds }: { keybinds: Keybind[] }): React.ReactElement {
  const theme = useTheme();
  return (
    <Box>
      {keybinds.map((kb, i) => (
        <Box key={kb.key} marginRight={i === keybinds.length - 1 ? 0 : 2}>
          <Text color={theme.highlight}>{kb.key}</Text>
          <Text color={theme.muted}> {kb.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
