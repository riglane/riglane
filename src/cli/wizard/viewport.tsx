
import { Box, Text, useStdout } from 'ink';
import { createContext, useContext, useEffect, useState } from 'react';

import { useTheme } from './themeContext.js';

export function windowAround(
  total: number,
  focus: number,
  capacity: number,
): { start: number; end: number } {
  if (capacity <= 0 || total <= 0) return { start: 0, end: 0 };
  if (total <= capacity) return { start: 0, end: total };
  const f = Math.max(0, Math.min(focus, total - 1));
  let start = f - Math.floor(capacity / 2);
  if (start < 0) start = 0;
  if (start + capacity > total) start = total - capacity;
  return { start, end: start + capacity };
}

export function useTerminalRows(): number {
  const { stdout } = useStdout();
  const [rows, setRows] = useState<number>(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    const onResize = (): void => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setRows(stdout.rows ?? 24), 100);
    };
    stdout.on('resize', onResize);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return rows;
}

export const ViewportContext = createContext<number>(Number.MAX_SAFE_INTEGER);

export function useViewportRows(): number {
  return useContext(ViewportContext);
}

export function MoreRow({ count, dir }: { count: number; dir: 'up' | 'down' }): React.JSX.Element | null {
  const theme = useTheme();
  if (count <= 0) return null;
  return (
    <Box>
      <Text color={theme.muted}>
        {'  '}
        {dir === 'up' ? '↑' : '↓'} {count} more
      </Text>
    </Box>
  );
}
