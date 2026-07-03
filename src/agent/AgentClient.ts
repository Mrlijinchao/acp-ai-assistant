import * as cp from 'child_process';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import type { AgentConfig, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './types';

export class AgentClient extends EventEmitter {
    private process: cp.ChildProcess | null = null;
    private messageQueue = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>();
    private nextId = 1;
    private buffer = '';
    private logger: Logger;

    constructor(private config: AgentConfig) {
        super();
        this.logger = new Logger('AgentClient');
    }

    async start(mcpServerUrl: string): Promise<void> {
        if (this.process) {
            throw new Error('Agent already running');
        }

        return new Promise((resolve, reject) => {
            try {
                this.logger.info('Starting agent process:', this.config.command, this.config.args);
                this.config.env = { ...this.config.env, DEFAULT_MCP_SERVER_URL: mcpServerUrl };

                this.process = cp.spawn(this.config.command, this.config.args, {
                    env: { ...process.env, ...this.config.env },
                    cwd: this.config.cwd,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                this.setupProcessHandlers();
                this.emit('started');
                resolve();
            } catch (error) {
                this.logger.error('Failed to start agent:', error);
                reject(error);
            }
        });
    }

    private setupProcessHandlers(): void {
        if (!this.process) return;

        this.process.stdout?.on('data', (data: Buffer) => {
            this.handleStdout(data);
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            const message = data.toString();
            this.logger.debug('[stderr]:', message);
            this.emit('log', { type: 'stderr', message });
        });

        this.process.on('error', (error) => {
            this.logger.error('Process error:', error);
            this.emit('error', error);
            this.cleanup();
        });

        this.process.on('exit', (code) => {
            this.logger.info('Process exited with code:', code);
            this.emit('stopped', { code });
            this.cleanup();
        });
    }

    private handleStdout(data: Buffer): void {
        const output = data.toString();
        this.buffer += output;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                this.logger.debug('Received:', line);
                this.handleMessage(line);
            }
        }
    }

    private handleMessage(line: string): void {
        try {
            const message = JSON.parse(line);
            
            if ('id' in message && message.id !== undefined) {
                this.handleResponse(message as JsonRpcResponse);
            } else if ('method' in message) {
                this.handleNotification(message as JsonRpcNotification);
            }
        } catch (error) {
            this.logger.error('Failed to parse message:', error);
            this.emit('error', new Error(`Failed to parse: ${line}`));
        }
    }

    private handleResponse(response: JsonRpcResponse): void {
        const pending = this.messageQueue.get(response.id);
        if (pending) {
            clearTimeout(pending.timeout);
            this.messageQueue.delete(response.id);
            
            if (response.error) {
                pending.reject(new Error(response.error.message));
            } else {
                pending.resolve(response.result);
            }
        }
    }

    private handleNotification(notification: JsonRpcNotification): void {
        this.emit('notification', notification);
    }

    async request(method: string, params?: any, timeout = 300000): Promise<any> {
        if (!this.process || !this.process.stdin) {
            throw new Error('Agent not running');
        }

        const id = this.nextId++;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };

        this.logger.debug('Sending request:', JSON.stringify(request));

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (this.messageQueue.has(id)) {
                    this.messageQueue.delete(id);
                    reject(new Error(`Request timeout: ${method}`));
                }
            }, timeout);

            this.messageQueue.set(id, { resolve, reject, timeout: timeoutId });
            this.process!.stdin!.write(JSON.stringify(request) + '\n');
        });
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.cleanup();
        }
    }

    private cleanup(): void {
        this.process = null;
        for (const [, pending] of this.messageQueue) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Agent stopped'));
        }
        this.messageQueue.clear();
    }

    isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }
}