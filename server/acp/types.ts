/**
 * The Agent Client Protocol messages that the app uses.
 * Agents send many more fields than these: every type allows unknown fields.
 */

export interface Loose {
  [key: string]: unknown;
}

export interface Meta {
  _meta?: Loose;
}

// --- initialize ---

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: {
    fs: { readTextFile: boolean; writeTextFile: boolean };
    terminal: boolean;
  };
  clientInfo: { name: string; version: string };
}

export interface AuthMethod extends Loose {
  id: string;
  name?: string;
  description?: string;
}

export interface InitializeResult extends Loose {
  protocolVersion: number;
  agentCapabilities?: Loose & {
    loadSession?: boolean;
    promptCapabilities?: Loose & { image?: boolean; embeddedContext?: boolean };
    sessionCapabilities?: Loose;
  };
  authMethods?: AuthMethod[];
  agentInfo?: Loose & { name?: string; version?: string };
}

// --- sessions ---

export interface ConfigOptionValue extends Loose, Meta {
  value: string;
  name: string;
  description?: string;
}

export interface ConfigOption extends Loose, Meta {
  id: string;
  type: string;
  name?: string;
  category?: string;
  currentValue: unknown;
  options?: ConfigOptionValue[];
}

export interface NewSessionParams {
  cwd: string;
  mcpServers: unknown[];
}

export interface LoadSessionParams extends NewSessionParams {
  sessionId: string;
  _meta?: Loose;
}

export interface NewSessionResult extends Loose, Meta {
  sessionId: string;
  modes?: unknown;
  configOptions?: ConfigOption[];
}

/** session/load has no sessionId in the result */
export interface LoadSessionResult extends Loose, Meta {
  modes?: unknown;
  configOptions?: ConfigOption[];
}

export interface ListSessionsParams {
  /** Only the sessions of this folder */
  cwd?: string;
  cursor?: string;
  _meta?: Loose;
}

/** One entry of session/list. Agents add their own fields in `_meta`. */
export interface AgentSessionInfo extends Loose, Meta {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

export interface ListSessionsResult extends Loose, Meta {
  sessions: AgentSessionInfo[];
  nextCursor?: string;
}

export interface CloseSessionParams {
  sessionId: string;
}

export interface SetConfigOptionParams {
  sessionId: string;
  configId: string;
  value: string;
}

export interface SetConfigOptionResult extends Loose {
  configOptions?: ConfigOption[];
}

// --- prompt ---

export interface TextContent extends Loose, Meta {
  type: 'text';
  text: string;
}

export interface ImageContent extends Loose, Meta {
  type: 'image';
  data: string;
  mimeType: string;
  uri?: string;
}

export interface ResourceContent extends Loose, Meta {
  type: 'resource';
  resource: Loose & { uri: string; mimeType?: string; text?: string; blob?: string };
}

export type ContentBlock = TextContent | ImageContent | ResourceContent;

export interface PromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export type StopReason = 'end_turn' | 'cancelled' | 'max_tokens' | 'max_turn_requests' | 'refusal';

export interface PromptResult extends Loose {
  stopReason: StopReason;
}

// --- session/update ---

export interface ChunkUpdate extends Loose, Meta {
  sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk';
  content: ContentBlock | (Loose & { type: string });
}

export interface ToolCallUpdate extends Loose, Meta {
  sessionUpdate: 'tool_call' | 'tool_call_update';
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: unknown[];
}

/** The agent puts its own details in `_meta` */
export interface SessionInfoUpdate extends Loose, Meta {
  sessionUpdate: 'session_info_update';
  title?: string;
}

export interface ConfigOptionUpdate extends Loose, Meta {
  sessionUpdate: 'config_option_update';
  configOptions: ConfigOption[];
}

export interface AvailableCommandsUpdate extends Loose, Meta {
  sessionUpdate: 'available_commands_update';
  availableCommands: unknown[];
}

/** Any other kind that the agent sends */
export interface OtherUpdate extends Loose {
  sessionUpdate: string;
}

export type SessionUpdate =
  | ChunkUpdate
  | ToolCallUpdate
  | SessionInfoUpdate
  | ConfigOptionUpdate
  | AvailableCommandsUpdate
  | OtherUpdate;

export interface SessionNotification extends Loose {
  sessionId: string;
  update: SessionUpdate;
}

// --- session/request_permission ---

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption extends Loose {
  optionId: string;
  name: string;
  kind: PermissionOptionKind | string;
}

export interface PermissionRequest extends Loose, Meta {
  sessionId: string;
  toolCall: Loose & { toolCallId: string; status?: string; title?: string };
  options: PermissionOption[];
}

export type PermissionOutcome = {
  outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };
};
