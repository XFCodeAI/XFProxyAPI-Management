import {
  Activity,
  Boxes,
  CloudCog,
  FileKey2,
  Gauge,
  Import,
  KeyRound,
  ListChecks,
  Plug,
  Route,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  TerminalSquare,
  Users
} from "lucide-react";

export type ManagementPageId =
  | "overview"
  | "config"
  | "auth-files"
  | "api-keys"
  | "gemini-keys"
  | "claude-keys"
  | "codex-keys"
  | "vertex-keys"
  | "plugins"
  | "plugin-store"
  | "logs"
  | "usage"
  | "quota"
  | "api-tools"
  | "vertex-import"
  | "settings";

export type ManagementPageMeta = {
  id: ManagementPageId;
  label: string;
  title: string;
  description: string;
  icon: typeof Activity;
};

export const managementPages = [
  {
    id: "overview",
    label: "Overview",
    title: "Management overview",
    description: "Runtime status, routing, and recent control-plane activity.",
    icon: Activity
  },
  {
    id: "config",
    label: "Config",
    title: "Configuration",
    description: "Read and persist the server configuration document.",
    icon: SlidersHorizontal
  },
  {
    id: "auth-files",
    label: "Auth Files",
    title: "Auth files",
    description: "OAuth credentials, uploaded auth records, model metadata, and auth status.",
    icon: FileKey2
  },
  {
    id: "api-keys",
    label: "API Keys",
    title: "Gateway API keys",
    description: "Management for client-facing API keys and usage attribution.",
    icon: KeyRound
  },
  {
    id: "gemini-keys",
    label: "Gemini Keys",
    title: "Gemini keys",
    description: "Configured Gemini upstream API key entries.",
    icon: Server
  },
  {
    id: "claude-keys",
    label: "Claude Keys",
    title: "Claude keys",
    description: "Configured Claude upstream API key entries.",
    icon: Users
  },
  {
    id: "codex-keys",
    label: "Codex Keys",
    title: "Codex keys",
    description: "Configured Codex upstream API key entries.",
    icon: Route
  },
  {
    id: "vertex-keys",
    label: "Vertex Keys",
    title: "Vertex keys",
    description: "Configured Vertex-compatible upstream API key entries.",
    icon: Boxes
  },
  {
    id: "plugins",
    label: "Plugins",
    title: "Plugins",
    description: "Runtime plugin status, enablement, and plugin configuration.",
    icon: Plug
  },
  {
    id: "plugin-store",
    label: "Plugin Store",
    title: "Plugin store",
    description: "Browse and install plugins from the configured plugin store.",
    icon: ListChecks
  },
  {
    id: "logs",
    label: "Logs",
    title: "Logs",
    description: "Main logs, request error logs, and log retention settings.",
    icon: ScrollText
  },
  {
    id: "usage",
    label: "Usage",
    title: "Usage",
    description: "Queued usage events, API key usage, and usage-statistics controls.",
    icon: Gauge
  },
  {
    id: "quota",
    label: "Quota",
    title: "Quota handling",
    description: "Quota reset actions and quota-exceeded switching policy.",
    icon: ShieldAlert
  },
  {
    id: "api-tools",
    label: "API Tools",
    title: "API tools",
    description: "Authenticated upstream API call helper for selected credentials.",
    icon: TerminalSquare
  },
  {
    id: "vertex-import",
    label: "Vertex Import",
    title: "Vertex import",
    description: "Import Vertex credentials into the management auth store.",
    icon: Import
  },
  {
    id: "settings",
    label: "Settings",
    title: "Panel settings",
    description: "Panel packaging, static asset routing, and release integration.",
    icon: Settings
  }
] satisfies ManagementPageMeta[];

export function getPageMeta(pageId: ManagementPageId) {
  return managementPages.find((page) => page.id === pageId) ?? managementPages[0];
}

export const statusItems = [
  { label: "Gateway", value: "Online", detail: "8 upstream profiles", icon: Server },
  { label: "Credentials", value: "12", detail: "active auth records", icon: FileKey2 },
  { label: "Plugins", value: "Ready", detail: "store and runtime available", icon: Plug },
  { label: "Panel", value: "Bundled", detail: "remote assets enabled", icon: CloudCog }
] as const;

export const routeRows = [
  { model: "gpt-4.1", provider: "OpenAI", weight: 35, state: "ready" },
  { model: "gemini-2.5-pro", provider: "Gemini", weight: 25, state: "ready" },
  { model: "claude-sonnet-4", provider: "Claude", weight: 25, state: "ready" },
  { model: "codex", provider: "Codex", weight: 15, state: "watch" }
] as const;

export const pageEndpointGroups: Record<Exclude<ManagementPageId, "overview">, Array<{
  title: string;
  detail: string;
  endpoints: string[];
}>> = {
  config: [
    {
      title: "Configuration document",
      detail: "Load JSON/YAML config and persist edited settings through the management API.",
      endpoints: ["GET /v0/management/config", "GET /v0/management/config.yaml"]
    }
  ],
  "auth-files": [
    {
      title: "Auth records",
      detail: "List, upload, download, delete, enable, disable, and annotate auth files.",
      endpoints: [
        "GET /v0/management/auth-files",
        "GET /v0/management/auth-files/models",
        "GET /v0/management/auth-files/download",
        "POST /v0/management/auth-files",
        "PATCH /v0/management/auth-files/status",
        "PATCH /v0/management/auth-files/fields",
        "DELETE /v0/management/auth-files"
      ]
    },
    {
      title: "OAuth sessions",
      detail: "Provider login flows and callback status polling.",
      endpoints: [
        "GET /v0/management/auth-status",
        "GET /v0/management/oauth-callback",
        "POST /v0/management/oauth-callback"
      ]
    }
  ],
  "api-keys": [
    {
      title: "Gateway keys",
      detail: "Client-facing API keys and per-key usage summaries.",
      endpoints: [
        "GET /v0/management/api-keys",
        "PATCH /v0/management/api-keys",
        "DELETE /v0/management/api-keys",
        "GET /v0/management/api-key-usage"
      ]
    }
  ],
  "gemini-keys": [
    {
      title: "Gemini credentials",
      detail: "Gemini API key entries configured in management config.",
      endpoints: [
        "GET /v0/management/gemini-api-key",
        "PATCH /v0/management/gemini-api-key",
        "DELETE /v0/management/gemini-api-key"
      ]
    }
  ],
  "claude-keys": [
    {
      title: "Claude credentials",
      detail: "Claude API key entries configured in management config.",
      endpoints: [
        "GET /v0/management/claude-api-key",
        "PATCH /v0/management/claude-api-key",
        "DELETE /v0/management/claude-api-key"
      ]
    }
  ],
  "codex-keys": [
    {
      title: "Codex credentials",
      detail: "Codex API key entries configured in management config.",
      endpoints: [
        "GET /v0/management/codex-api-key",
        "PATCH /v0/management/codex-api-key",
        "DELETE /v0/management/codex-api-key"
      ]
    }
  ],
  "vertex-keys": [
    {
      title: "Vertex-compatible credentials",
      detail: "Vertex-compatible API key entries configured in management config.",
      endpoints: [
        "GET /v0/management/vertex-api-key",
        "PATCH /v0/management/vertex-api-key",
        "DELETE /v0/management/vertex-api-key"
      ]
    }
  ],
  plugins: [
    {
      title: "Installed plugins",
      detail: "Runtime plugin list, enablement, config, and removal.",
      endpoints: [
        "GET /v0/management/plugins",
        "PATCH /v0/management/plugins/:id/enabled",
        "GET /v0/management/plugins/:id/config",
        "PATCH /v0/management/plugins/:id/config",
        "DELETE /v0/management/plugins/:id"
      ]
    }
  ],
  "plugin-store": [
    {
      title: "Plugin store",
      detail: "Browse and install plugins from the configured plugin store.",
      endpoints: ["GET /v0/management/plugin-store", "POST /v0/management/plugin-store/:id/install"]
    }
  ],
  logs: [
    {
      title: "Runtime logs",
      detail: "Main log browsing, clearing, request error logs, and retention controls.",
      endpoints: [
        "GET /v0/management/logs",
        "DELETE /v0/management/logs",
        "GET /v0/management/request-error-logs",
        "GET /v0/management/request-error-logs/:name",
        "GET /v0/management/logs-max-total-size-mb",
        "PATCH /v0/management/logs-max-total-size-mb",
        "GET /v0/management/error-logs-max-files",
        "PATCH /v0/management/error-logs-max-files"
      ]
    }
  ],
  usage: [
    {
      title: "Usage tracking",
      detail: "Inspect usage queue state and toggle usage statistics.",
      endpoints: [
        "GET /v0/management/usage-queue",
        "GET /v0/management/api-key-usage",
        "GET /v0/management/usage-statistics-enabled",
        "PATCH /v0/management/usage-statistics-enabled"
      ]
    }
  ],
  quota: [
    {
      title: "Quota policy",
      detail: "Manage fallback behavior when upstream quota is exhausted.",
      endpoints: [
        "GET /v0/management/quota-exceeded/switch-project",
        "PATCH /v0/management/quota-exceeded/switch-project",
        "GET /v0/management/quota-exceeded/switch-preview-model",
        "PATCH /v0/management/quota-exceeded/switch-preview-model",
        "POST /v0/management/reset-quota"
      ]
    }
  ],
  "api-tools": [
    {
      title: "Credential-scoped API call",
      detail: "Proxy a custom upstream request through a selected managed credential.",
      endpoints: ["POST /v0/management/api-call"]
    }
  ],
  "vertex-import": [
    {
      title: "Vertex credential import",
      detail: "Import Vertex service-account credentials into the local auth directory.",
      endpoints: ["POST /v0/management/vertex/import"]
    }
  ],
  settings: [
    {
      title: "Panel delivery",
      detail: "Frontend build artifact consumed by XFProxyAPI management asset updater.",
      endpoints: ["GET /management.html", "GET /management-assets/*", "management-panel.zip"]
    }
  ]
};

export const events = [
  { title: "Model registry refreshed", time: "09:26" },
  { title: "Control panel bundle verified", time: "09:18" },
  { title: "Credential rotation due soon", time: "08:44" }
] as const;
