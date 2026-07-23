export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: any;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: any;
    error?: JsonRpcError;
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: any;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: any;
}

export interface AgentConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd?: string;
}

export interface SessionInfo {
    sessionId: string;
    messageCount: string;
    title: string;
    cwd: string;
    createdAt: Date;
    updatedAt: Date;
}

export type AgentEvent = 
    | { type: 'ready'; sessionId: string }
    | { type: 'stopped'; code?: number }
    | { type: 'error'; error: Error }
    | { type: 'messageChunk'; content: string }
    | { type: 'toolCall'; name: string; args: any }
    | { type: 'log'; message: string };