
export const PRODUCT_NAME = 'riglane';

export const CLI_NAME = 'riglane';

export const PRODUCT_DIR = '.riglane';

export const ENV_PREFIX = 'RIGLANE_';

export const LEGACY_DIRS = ['.acp', '.agent'] as const;

export const LEGACY_ENV_RUN_DIR = 'ACP_RUN_DIR';

export const AGENT_PREFIX = `${PRODUCT_NAME}-`;
export const WORKFLOW_STEP_AGENT = `${PRODUCT_NAME}-workflow-step`;
export const VERSION_MARKER = `${PRODUCT_DIR}-version`;
export const PROJECT_ID_MARKER = `${PRODUCT_DIR}-project-id`;

export const ENV_RUN_ID = `${ENV_PREFIX}RUN_ID`;
export const ENV_RUN_DIR = `${ENV_PREFIX}RUN_DIR`;
export const ENV_ACTIVE_WORKFLOW = `${ENV_PREFIX}ACTIVE_WORKFLOW`;
export const ENV_MODEL_OVERRIDE = `${ENV_PREFIX}MODEL_OVERRIDE`;
export const ENV_INBOX_WEBHOOK_OVERRIDE = `${ENV_PREFIX}INBOX_WEBHOOK_OVERRIDE`;
export const ENV_TRACE_VIEWER_OVERRIDE = `${ENV_PREFIX}TRACE_VIEWER_OVERRIDE`;
export const ENV_GATE_FILE_WAIT_MS = `${ENV_PREFIX}GATE_FILE_WAIT_MS`;
export const ENV_INBOX_WEBHOOK = `${ENV_PREFIX}INBOX_WEBHOOK`;
export const ENV_INBOX_ASK_MAX_HOLD_MS = `${ENV_PREFIX}INBOX_ASK_MAX_HOLD_MS`;
export const ENV_CATALOG_BASE_URL = `${ENV_PREFIX}CATALOG_BASE_URL`;
export const ENV_TRACE_LOCK_TIMEOUT_MS = `${ENV_PREFIX}TRACE_LOCK_TIMEOUT_MS`;
export const ENV_REGISTRY_PATH = `${ENV_PREFIX}REGISTRY_PATH`;
export const ENV_NO_UI = `${ENV_PREFIX}NO_UI`;
export const ENV_AUTO_OPEN_TRACE_VIEWER = `${ENV_PREFIX}AUTO_OPEN_TRACE_VIEWER`;
