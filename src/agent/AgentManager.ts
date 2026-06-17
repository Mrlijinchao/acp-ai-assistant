import * as vscode from 'vscode';
import { AgentClient } from './AgentClient';
import { Configuration } from '../config/Configuration';
import { Logger } from '../utils/logger';
import type { SessionInfo, AgentEvent } from './types';
import { ToolManager } from '../tools';

export class AgentManager {
    private client: AgentClient | null = null;
    private sessionInfo: SessionInfo | null = null;
    private eventListeners: Map<string, Set<Function>> = new Map();
    private logger: Logger;
    private toolManager: ToolManager | null = null;
    private isStarting = false;

    constructor(private configuration: Configuration) {
        this.logger = new Logger('AgentManager');
        this.toolManager = new ToolManager(9876);
    }

     async start(agentName: string): Promise<void> {
        if (this.isStarting) {
            this.logger.warn('Agent already starting');
            return;
        }
        
        if (this.client?.isRunning()) {
            throw new Error('Agent already running');
        }

        this.isStarting = true;

        try {
            // 确保旧的 MCP Server 已停止
            await this.stopMcpServer();
            
            // 创建新的 MCP Server
            this.toolManager = new ToolManager(9876);
            await this.toolManager.start();
            this.logger.info(`MCP Server started on port ${this.toolManager.getPort()}`);

            // 等待 MCP Server 完全启动
            await this.waitForMcpServer(9876);
            
            this.logger.info('Starting agent...');
            const agentConfig = this.configuration.getAgentConfig(agentName);
            this.logger.info('Agent config:', JSON.stringify(agentConfig, null, 2));
            
            this.client = new AgentClient(agentConfig);
            this.setupClientListeners();

            const mcpServerUrl = `http://localhost:${this.toolManager?.getPort()}`;
            
            await this.client.start(mcpServerUrl);
            await this.performHandshake();
        } catch (error) {
            this.logger.error('Failed to start agent:', error);
            throw error;
        } finally {
            this.isStarting = false;
        }
    }

    private async waitForMcpServer(port: number, maxRetries = 10): Promise<void> {
        const http = require('http');
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                await new Promise((resolve, reject) => {
                    const req = http.request({
                        hostname: 'localhost',
                        port: port,
                        path: '/health',
                        method: 'GET',
                        timeout: 1000
                    }, (res: any) => {
                        if (res.statusCode === 200) {
                            resolve(true);
                        } else {
                            reject(new Error(`Health check failed: ${res.statusCode}`));
                        }
                    });
                    req.on('error', reject);
                    req.end();
                });
                this.logger.info(`MCP Server is ready on port ${port}`);
                return;
            } catch (error) {
                this.logger.debug(`Waiting for MCP Server... (${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        throw new Error(`MCP Server failed to start on port ${port}`);
    }

    private async stopMcpServer(): Promise<void> {
        if (this.toolManager) {
            this.logger.info('Stopping existing MCP Server...');
            this.toolManager.stop();
            this.toolManager = null;
            
            // 等待端口释放
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    private setupClientListeners(): void {
        if (!this.client) return;

        this.client.on('error', (error) => {
            this.logger.error('Client error:', error);
            this.emit('error', { type: 'error', error });
            vscode.window.showErrorMessage(`Agent error: ${error.message}`);
        });

        this.client.on('stopped', (data) => {
            this.logger.info('Client stopped:', data);
            this.emit('stopped', { type: 'stopped', code: data.code });
            this.sessionInfo = null;
        });

        this.client.on('notification', (notification) => {
            this.handleNotification(notification);
        });

        // 监听工具审批请求
        if (this.toolManager) {
            const approvalManager = this.toolManager.getApprovalManager();
            approvalManager.on('approved', (data) => {
                this.emit('toolApproved', { callId: data.callId, toolName: data.toolName });
            });
            approvalManager.on('rejected', (data) => {
                this.emit('toolRejected', { callId: data.callId, toolName: data.toolName });
            });
        }
    }

    private async performHandshake(): Promise<void> {
        if (!this.client) throw new Error('Client not initialized');

        try {
            this.logger.info('Sending initialize request...');
            const initResult = await this.client.request('initialize', {
                protocolVersion: 1,
                clientInfo: {
                    name: 'vscode-acp-plugin',
                    version: '0.0.1'
                },
                capabilities: {
                    fs: { readTextFile: true, writeTextFile: true },
                    terminal: true,
                    tools: true
                }
            });
            this.logger.info('Initialize response:', initResult);

            const workspaceFolders = vscode.workspace.workspaceFolders;
            const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

            // 获取 MCP Server 的 URL
            const mcpServerUrl = `http://localhost:${this.toolManager?.getPort()}`;
            
            this.logger.info('Creating session with MCP server URL:', mcpServerUrl);
            
            // 按照 deepagents-acp 要求的严格格式
            const sessionResult = await this.client.request('session/new', {
                cwd: cwd,
                mcpServers: [{
                    name: 'vscode-local-tools',
                    type: 'sse',  // 必须是 'sse'
                    url: mcpServerUrl,
                    headers: [],   // 必须是数组
                    // 以下字段虽然可能用不到，但必须提供
                    command: '',   // 空字符串或占位符
                    args: [],      // 空数组
                    env: []        // 空数组
                }]
            });

            this.sessionInfo = {
                id: sessionResult.sessionId,
                cwd,
                createdAt: new Date()
            };

            this.logger.info('Session created:', this.sessionInfo);
            this.emit('ready', { type: 'ready', sessionId: this.sessionInfo.id });
            
        } catch (error) {
            this.logger.error('Handshake failed:', error);
            throw new Error(`Handshake failed: ${error}`);
        }
    }


    private async handleNotification(notification: any): Promise<void> {
        if (notification.method === 'session/update') {
            const update = notification.params.update;
            
            if (update.sessionUpdate === 'agent_message_chunk') {
                this.emit('messageChunk', { 
                    type: 'messageChunk', 
                    content: update.content?.text || '' 
                }); 
            }
            else if (update.sessionUpdate === 'agent_thought_chunk') {
                // 处理思考过程
                const content = update.content?.text || '';
                this.emit('thoughtChunk', { type: 'thoughtChunk', content });
                console.log('Thought chunk received:', content);
            }
            else if (update.sessionUpdate === 'thought_message_chunk') {
                // 另一种思考消息格式
                const content = update.content?.text || '';
                this.emit('thoughtChunk', { type: 'thoughtChunk', content });
                console.log('Thought message chunk received:', content);
            }
            else if (update.sessionUpdate === 'tool_call') {
                const toolName = update.title || update.toolName || update.tool || 'unknown';
                const toolCallId = update.toolCallId;
                const args = update.input || update.args || {};
                const status = update.status; 
                
                this.logger.info(`Tool call received: ${toolName}`, { toolCallId, args });
                this.emit('toolCall', {
                    type: 'toolCall',
                    name: toolName,
                    args: args,
                    toolCallId: toolCallId,
                    status: status
                });
            
            }
            else if (update.sessionUpdate === 'tool_call_update') {
            const toolCallId = update.toolCallId;
            const status = update.status;  // 'in_progress', 'completed', 'failed'
            const output = update.output;
            const error = update.error;
            const toolName = update.title || update.toolName || update.tool || 'unknown';
            console.log(`Tool call update received: ${toolName} (ID: ${toolCallId}) - Status: ${status}`);
            // 提取结果内容
            let result = update.output || null;
            
            // 发送 UI 事件：工具执行完成（无论是 VSCode 工具还是 Agent 工具）
            if (status === 'completed') {
                this.emit('toolResult', {
                    type: 'toolResult',
                    toolCallId: toolCallId,
                    name: toolName,  // 名称可以从之前存储的 toolCall 中获取
                    result: result,
                    error: null,
                    status: status
                });
            } else if (status === 'failed') {
                this.emit('toolResult', {
                    type: 'toolResult',
                    toolCallId: toolCallId,
                    name: toolName,
                    result: null,
                    error: error || 'Tool execution failed',
                    status: status
                });
            }
        }


            
        }
    }

    async sendPrompt(text: string): Promise<void> {
        if (!this.client || !this.sessionInfo) {
            throw new Error('Agent not ready');
        }

        this.logger.info('Sending prompt:', text);
        await this.client.request('session/prompt', {
            sessionId: this.sessionInfo.id,
            prompt: [{ type: 'text', text }]
        });
    }

    stop(): void {
        if (this.client) {
            this.client.stop();
            this.client = null;
            this.sessionInfo = null;
        }
        // 停止 MCP Server
        if (this.toolManager) {
            this.toolManager.stop();
            this.toolManager = null;
        }
    }

    isRunning(): boolean {
        return this.client?.isRunning() ?? false;
    }

    getSessionId(): string | null {
        return this.sessionInfo?.id ?? null;
    }

    on<K extends keyof AgentEventMap>(event: K, listener: (event: AgentEventMap[K]) => void): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(listener);
    }

    // 添加 off 方法
    off<K extends keyof AgentEventMap>(event: K, listener: (event: AgentEventMap[K]) => void): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this.eventListeners.delete(event);
            }
        }
    }

    private emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }
    }
}

interface AgentEventMap {
    ready: { type: 'ready'; sessionId: string };
    stopped: { type: 'stopped'; code?: number };
    error: { type: 'error'; error: Error };
    messageChunk: { type: 'messageChunk'; content: string };
    toolCall: { type: 'toolCall'; name: string; args: any; toolCallId?: string; status?: string };
    toolResult: { type: 'toolResult'; name: string; result: any; error?: string | null; toolCallId?: string; status?: string };
    toolProgress: { type: 'toolProgress'; name: string; progress: string };
    messageEnd: { type: 'messageEnd'; fullContent: string };
    thoughtChunk: { type: 'thoughtChunk'; content: string };
    toolApproved: { callId: string; toolName: string };
    toolRejected: { callId: string; toolName: string };
    toolApprovalRequest: { callId: string; toolName: string; args: any };
}