// tools/mcp/MCPServer.ts
import * as http from 'http';
import { Logger } from '../../utils/logger';

interface MCPRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: any;
}

interface MCPResponse {
    jsonrpc: '2.0';
    id: number;
    result?: any;
    error?: { code: number; message: string };
}

export class MCPServer {
    private server: http.Server | null = null;
    private logger: Logger;
    private initialized = false;
    private toolManager: any; // 添加 ToolManager 引用

    constructor(
        private port: number,
        private tools: Map<string, any>,
        toolManager: any // 传入 ToolManager 实例
    ) {
        this.logger = new Logger('MCPServer');
        this.toolManager = toolManager;
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                // 处理 CORS
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                
                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }
                
                if (req.method === 'POST' && req.url === '/') {
                    let body = '';
                    req.on('data', chunk => { body += chunk; });
                    req.on('end', () => {
                        try {
                            const request = JSON.parse(body) as MCPRequest;
                            this.handleRequest(request, res);
                        } catch (error) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'Invalid JSON' }));
                        }
                    });
                } else if (req.method === 'GET' && req.url === '/health') {
                    res.writeHead(200);
                    res.end('OK');
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });

            this.server.listen(this.port, 'localhost', () => {
                this.logger.info(`MCP Server listening on port ${this.port}`);
                resolve();
            });

            this.server.on('error', reject);
        });
    }

    private async handleRequest(request: MCPRequest, res: http.ServerResponse): Promise<void> {
        this.logger.debug('MCP Request:', request);
        
        let response: MCPResponse = {
            jsonrpc: '2.0',
            id: request.id
        };

        try {
            switch (request.method) {
                case 'initialize':
                    // 实现 MCP 协议的 initialize 方法
                    this.initialized = true;
                    response.result = {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'vscode-mcp-server',
                            version: '1.0.0'
                        }
                    };
                    break;

                case 'initialized':
                    // 客户端确认初始化完成的通知，不需要返回结果
                    response = null as any;
                    res.writeHead(202);
                    res.end();
                    return;

                case 'tools/list':
                    if (!this.initialized) {
                        response.error = { code: -32000, message: 'Not initialized' };
                        break;
                    }
                    console.log('Listing tools:', Array.from(this.tools.keys()));
                    response.result = {
                        tools: Array.from(this.tools.values()).map(tool => ({
                            name: tool.name,
                            description: tool.description,
                            inputSchema: tool.inputSchema
                        }))
                    };
                    break;
                case 'tools/call':
                    if (!this.initialized) {
                        response.error = { code: -32000, message: 'Not initialized' };
                        break;
                    }
                    
                    const { name, arguments: args } = request.params;
                    const tool = this.tools.get(name);
                    if (!tool) {
                        response.error = { code: -32000, message: `Tool not found: ${name}` };
                    } else {
                        try {
                            // 注意：这里需要获取 ToolManager 实例来调用 executeTool
                            // 为了简化，你可以将 ToolManager 引用传递给 MCPServer
                            // 或者在 ToolManager 中直接处理 MCP 请求
                            const result = await this.executeToolWithApproval(name, args);
                            response.result = {
                                content: [{ type: 'text', text: JSON.stringify(result) }]
                            };
                        } catch (error: any) {
                            console.error('Tool execution error:', error);
                            // if (error.message.includes('rejected by user')) {
                            //     response.error = { code: -32001, message: 'Tool execution rejected by user' };
                            // } else {
                            //     response.error = { code: -32000, message: error.message };
                            // }
                               // 始终返回 success: false 的结构化结果
                            const errorResult = {
                                success: false,
                                error: error.message || 'Tool execution failed',
                                errorType: error.code || 'UNKNOWN_ERROR',
                                ...(error.message?.includes('rejected by user') && {
                                    errorType: 'USER_REJECTED',
                                    message: 'Tool execution was rejected by user'
                                })
                            };
                            
                            response.result = {
                                content: [{ 
                                    type: 'text', 
                                    text: JSON.stringify(errorResult) 
                                }]
                            };
                        }
                    }
                    break;


                default:
                    response.error = { code: -32601, message: `Method not found: ${request.method}` };
            }
        } catch (error: any) {
            this.logger.error('Request handling error:', error);
            response.error = { code: -32000, message: error.message };
            response.result = {
                content: [{ 
                    type: 'text', 
                    text: `Request handling error: ${error.message}` }
                ]
             };
        }

        if (response) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        }
    }

    // 添加工具执行方法（需要引用 ToolManager 或通过回调）
    private async executeToolWithApproval(name: string, args: any): Promise<any> {
        // 这里需要调用 ToolManager 的 executeTool 方法
        // 你可以通过构造函数注入 ToolManager 实例
        // 或者通过闭包/回调的方式
        return await this.toolManager.executeTool(name, args);
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.initialized = false;
    }
}