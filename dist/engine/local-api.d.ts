import type { IncomingMessage, ServerResponse } from 'node:http';
export declare function getServeToken(): string;
export declare function withServeToken(url: string): string;
export declare function requireServeToken(req: IncomingMessage, url: URL, res: ServerResponse): boolean;
type Spawner = (argv: string[], cwd: string) => void;
export declare function _setSpawnerForTests(fn: Spawner): Spawner;
export declare function handleLocalApi(root: string, req: IncomingMessage, res: ServerResponse, pathname: string, url: URL): boolean;
export {};
