
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ========== 全局状态 ==========
let agentProcess: cp.ChildProcess | null = null;
let currentSessionId: string | null = null;
let currentWebview: vscode.WebviewView | null = null;

interface QueueItem {
    id: number;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeoutId?: NodeJS.Timeout;
}
let messageQueue: QueueItem[] = [];
let nextId = 1;
let currentAgentConfig: AgentConfig | null = null;

// 工具调用等待队列：用于等待用户确认
interface PendingToolCall {
    toolCallId: string;
    toolName: string;
    toolInput: any;
    resolve: (response: any) => void;
    reject: (error: Error) => void;
}

interface AgentConfig {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
}

// 1. 定义插件端支持的工具列表
interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            default?: any;
        }>;
        required: string[];
    };
}

// 2. 获取插件端支持的所有工具
function getAvailableTools(): ToolDefinition[] {
    return [
        {
            name: 'read_file_win',
            description: '读取指定路径的文件内容',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（相对于工作区根目录）'
                    },
                    encoding: {
                        type: 'string',
                        description: '文件编码，默认 utf-8',
                        default: 'utf-8'
                    }
                },
                required: ['path']
            }
        },
        {
            name: 'write_file',
            description: '写入内容到指定文件',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '文件路径（相对于工作区根目录）'
                    },
                    content: {
                        type: 'string',
                        description: '要写入的文件内容'
                    },
                    encoding: {
                        type: 'string',
                        description: '文件编码，默认 utf-8',
                        default: 'utf-8'
                    }
                },
                required: ['path', 'content']
            }
        },
        {
            name: 'execute_command',
            description: '在终端中执行命令',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: '要执行的命令'
                    },
                    cwd: {
                        type: 'string',
                        description: '工作目录（可选）'
                    },
                    timeout: {
                        type: 'integer',
                        description: '超时时间（毫秒），默认 30000',
                        default: 30000
                    }
                },
                required: ['command']
            }
        },
        {
            name: 'list_directory',
            description: '列出目录内容',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: '目录路径（相对于工作区根目录）',
                        default: '.'
                    },
                    recursive: {
                        type: 'boolean',
                        description: '是否递归列出子目录',
                        default: false
                    }
                },
                required: []
            }
        },
        {
            name: 'search_files',
            description: '在文件中搜索文本',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: '搜索模式（支持正则表达式）'
                    },
                    path: {
                        type: 'string',
                        description: '搜索路径（相对于工作区根目录）',
                        default: '.'
                    },
                    filePattern: {
                        type: 'string',
                        description: '文件匹配模式，如 *.ts',
                        default: '*'
                    }
                },
                required: ['pattern']
            }
        }
    ];
}

// ========== 创建输出通道 ==========
let outputChannel: vscode.OutputChannel;
// ========== 插件激活 ==========
export function activate(context: vscode.ExtensionContext) {

	outputChannel = vscode.window.createOutputChannel('ACP Client');
    outputChannel.show(); // 自动显示
    outputChannel.appendLine('ACP 插件已激活');
    console.log('ACP 插件已激活（支持工具调用）');

    // 注册聊天视图
    const chatProvider = new ChatViewProvider(context.extensionUri);
    const chatView = vscode.window.registerWebviewViewProvider('acp-chat-view', chatProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    });

    // 注册停止 Agent 命令
    const stopAgentCmd = vscode.commands.registerCommand('acp.stopAgent', () => {
        stopAgent();
    });

    // 注册清除聊天命令
    const clearChatCmd = vscode.commands.registerCommand('acp.clearChat', () => {
        if (currentWebview) {
            sendToWebview('clearChat', {});
        }
    });

    context.subscriptions.push(chatView, stopAgentCmd, clearChatCmd);
}

// ========== 辅助函数：同时输出到控制台和输出通道 ==========
function logToOutput(message: string, level: 'info' | 'warn' | 'error' = 'info') {
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${prefix} ${message}`;
    
    // 输出到输出通道
    if (outputChannel) {
        outputChannel.appendLine(formatted);
    }
    
    // 输出到控制台
    console.log(formatted);
}

// ========== 读取 Agent 配置 ==========
function getAgentConfig(agentName: string): AgentConfig | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('请先打开一个工作区文件夹');
        return null;
    }
    
    // 从工作区配置读取
    const config = vscode.workspace.getConfiguration();
    let agents = config.get<Record<string, any>>('deep.acp.agents');
    
    // 如果读不到，直接从 .vscode/settings.json 文件读取
    if (!agents || Object.keys(agents).length === 0) {
        const fs = require('fs');
        const settingsPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'settings.json');
        
        try {
            if (fs.existsSync(settingsPath)) {
                const content = fs.readFileSync(settingsPath, 'utf8');
                const settings = JSON.parse(content);
                agents = settings['deep.acp.agents'];
                console.log(`从文件读取配置: ${settingsPath}`);
            }
        } catch (err) {
            console.error('读取配置文件失败:', err);
        }
    }
    
    if (!agents || Object.keys(agents).length === 0) {
        vscode.window.showErrorMessage('未找到 acp.agents 配置，请在 .vscode/settings.json 中配置 Agent');
        return null;
    }

    let agentConfig = agents[agentName];
    
    if (!agentConfig) {
        vscode.window.showErrorMessage(`未找到名为 "${agentName}" 的 Agent 配置`);
        return null;
    }
    
    console.log(`找到目标 Agent: ${agentName}`);
    
    // 处理参数路径
    let args = [...agentConfig.args];
    if (args.length > 0) {
        const firstArg = args[0];
        if (!firstArg.includes(':') && !firstArg.startsWith('/') && !firstArg.startsWith('.')) {
            args[0] = vscode.Uri.joinPath(workspaceFolders[0].uri, firstArg).fsPath;
        }
        if (firstArg.startsWith('./') || firstArg.startsWith('../')) {
            args[0] = path.join(workspaceFolders[0].uri.fsPath, firstArg);
        }
    }

	// 获取当前工作区路径
    const workspacePath = workspaceFolders?.[0]?.uri.fsPath;

	let resolvedArgs = [...agentConfig.args];
    if (workspacePath) {
        resolvedArgs = resolvedArgs.map(arg => {
            // 将字符串中的 ${workspaceFolder} 替换为真实路径
            return arg.replace(/\${workspaceFolder}/g, workspacePath);
        });
    }
    
    console.log('加载 Agent 配置:', {
        name: agentName,
        command: agentConfig.command,
        args: resolvedArgs,
        env: agentConfig.env
    });
    
    return {
        name: agentName,
        command: agentConfig.command,
        args: args,
        env: agentConfig.env || {}
    };
}

// ========== 启动 Agent 进程 ==========
async function startAgent(agentName?: string): Promise<void> {
    if (agentProcess) {
        vscode.window.showWarningMessage('Agent 已经在运行中');
        return;
    }

    if (!agentName) {
        vscode.window.showErrorMessage('请指定要启动的 Agent 名称');
        if (currentWebview) {
            sendToWebview('addDebugLog', { message: '错误: 请先选择一个 Agent' });
        }
        return;
    }

    const agentConfig = getAgentConfig(agentName);
    if (!agentConfig) return;
    
    currentAgentConfig = agentConfig;
    
    const config = vscode.workspace.getConfiguration();
    let cwd = config.get<string>('acp.defaultWorkingDirectory') || '${workspaceFolder}';
    
    if (cwd === '${workspaceFolder}') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            cwd = workspaceFolders[0].uri.fsPath;
        } else {
            cwd = process.cwd();
        }
    }
    
    const logTraffic = config.get<boolean>('acp.logTraffic', false);
    
    vscode.window.showInformationMessage(`启动 Agent: ${agentConfig.command} ${agentConfig.args.join(' ')}`);

    try {
        const env = {
            ...process.env,
            ...agentConfig.env
        };
        
        agentProcess = cp.spawn(agentConfig.command, agentConfig.args, {
            cwd: cwd,
            env: env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // 处理 stdout（接收 ACP 消息）
        let buffer = '';
        agentProcess.stdout?.on('data', (data: Buffer) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.trim()) {
                    if (logTraffic) {
                        console.log('[ACP <-]', line);
                    }
                    handleAgentMessage(line);
                }
            }
        });

        // 处理 stderr
        agentProcess.stderr?.on('data', (data: Buffer) => {
            const msg = data.toString();
            console.log('[Agent stderr]:', msg);
            if (currentWebview) {
                sendToWebview('addDebugLog', { message: msg });
            }
        });

        agentProcess.on('error', (err) => {
            vscode.window.showErrorMessage(`Agent 启动失败: ${err.message}`);
            agentProcess = null;
            if (currentWebview) {
                sendToWebview('agentStopped', {});
                sendToWebview('addDebugLog', { message: `启动失败: ${err.message}` });
            }
        });

        agentProcess.on('exit', (code) => {
            console.log(`Agent 进程退出，代码: ${code}`);
            agentProcess = null;
            currentSessionId = null;
            currentAgentConfig = null;
            if (currentWebview) {
                sendToWebview('agentStopped', {});
            }
            if (code !== 0 && code !== null) {
                vscode.window.showWarningMessage(`Agent 异常退出，退出码: ${code}`);
            }
        });

        await performHandshake(logTraffic);
        
    } catch (err) {
        vscode.window.showErrorMessage(`启动 Agent 出错: ${err}`);
        agentProcess = null;
        if (currentWebview) {
            sendToWebview('agentStopped', {});
            sendToWebview('addDebugLog', { message: `启动出错: ${err}` });
        }
    }
}

// ========== 选择 Agent ==========
async function selectAgent(): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('请先打开一个工作区文件夹');
        return undefined;
    }
    
    const config = vscode.workspace.getConfiguration();
    let agents = config.get<Record<string, any>>('deep.acp.agents');
    
    if (!agents || Object.keys(agents).length === 0) {
        const settingsPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'settings.json');
        
        try {
            if (fs.existsSync(settingsPath)) {
                const content = fs.readFileSync(settingsPath, 'utf8');
                const settings = JSON.parse(content);
                agents = settings['deep.acp.agents'];
            }
        } catch (err) {
            console.error('读取配置文件失败:', err);
        }
    }
    
    if (!agents || Object.keys(agents).length === 0) {
        vscode.window.showErrorMessage('未找到 acp.agents 配置');
        return undefined;
    }
    
    const agentNames = Object.keys(agents);
    const selected = await vscode.window.showQuickPick(agentNames, {
        placeHolder: '请选择要启动的 Agent',
        title: '选择 Agent'
    });
    
    return selected;
}

// ========== ACP 协议握手 ==========
// ========== ACP 协议握手 ==========
// ========== 修复 performHandshake ==========
// ========== 修改 performHandshake ==========
async function performHandshake(logTraffic: boolean = false): Promise<void> {
    if (!agentProcess) return;

    try {
        const tools = getAvailableTools();
        console.log(`[ACP] 准备注册 ${tools.length} 个工具`);

        // 发送 initialize 请求
        const initResponse = await sendRequest('initialize', {
            protocolVersion: 1,
            clientInfo: {
                name: 'vscode-acp-plugin',
                version: '0.0.1'
            },
            clientCapabilities: {
				field_meta: {
					tools: tools.map(tool => ({
						name: tool.name,
						description: tool.description,
						parameters: tool.parameters
					}))
				},
                fs: { 
                    readTextFile: true, 
                    writeTextFile: true 
                },
                terminal: true,
            }
        });

        console.log('[ACP] 初始化响应:', JSON.stringify(initResponse, null, 2));

        // 创建会话
        const sessionResponse = await sendRequest('session/new', {
            cwd: getWorkspacePath(),
            mcpServers: []
        });

        currentSessionId = sessionResponse.sessionId;
        console.log('Session created:', currentSessionId);

        // 🔥 关键：会话创建后，发送 tools_available 通知
        await sendToolsAvailable(currentSessionId, tools);

        const agentName = currentAgentConfig?.name || 'Agent';
        vscode.window.showInformationMessage(`${agentName} 已连接，会话: ${currentSessionId}`);
        
        if (currentWebview) {
            sendToWebview('agentReady', { 
                sessionId: currentSessionId,
                agentName: agentName,
                tools: tools
            });
        }
    } catch (err) {
        console.error('握手失败:', err);
        vscode.window.showErrorMessage(`Agent 握手失败: ${err}`);
        throw err;
    }
}

// ========== 🔥 新增：发送 tools_available 通知 ==========
async function sendToolsAvailable(sessionId: string, tools: ToolDefinition[]): Promise<void> {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('Agent 进程未运行');
        return;
    }
    


	const notification = {
        jsonrpc: '2.0',
        method: 'ext_notification',  // 不是 session/notification
        params: {
            method: 'tools_available',  // 自定义方法名
            params: {
                sessionId: sessionId,
                tools: tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }))
            }
        }
    };
    
    const message = JSON.stringify(notification) + '\n';
    agentProcess.stdin.write(message);
    console.log(`[ACP] 已发送 tools_available 通知 (${tools.length} 个工具)`);
}

function getWorkspacePath(): string {
    const config = vscode.workspace.getConfiguration();
    let cwd = config.get<string>('acp.defaultWorkingDirectory') || '${workspaceFolder}';
    
    if (cwd === '${workspaceFolder}') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            cwd = workspaceFolders[0].uri.fsPath;
        } else {
            cwd = process.cwd();
        }
    }
    
    return cwd;
}

// ========== 主动通知工具列表 ==========
async function notifyToolsAvailable(sessionId: string, tools: ToolDefinition[]): Promise<void> {
    if (!agentProcess || !agentProcess.stdin) return;
    
    // 🔥 使用 session/update 通知工具列表
    const notification = {
        jsonrpc: '2.0',
        method: 'session/notification',
        params: {
            sessionId: sessionId,
            update: {
                sessionUpdate: 'tools_available',
                tools: tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }))
            }
        }
    };
    
    const message = JSON.stringify(notification) + '\n';
    agentProcess.stdin.write(message);
    console.log('[ACP] 已发送 tools_available 通知');
}
// ========== 发送 ACP 请求 ==========
function sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!agentProcess || !agentProcess.stdin) {
            reject(new Error('Agent 进程未运行'));
            return;
        }

        const id = nextId++;
        const request = {
            jsonrpc: '2.0',
            id: id,
            method: method,
            params: params
        };

        const timeoutId = setTimeout(() => {
            const index = messageQueue.findIndex(q => q.id === id);
            if (index !== -1) {
                const queued = messageQueue[index];
                messageQueue.splice(index, 1);
                queued.reject(new Error(`请求超时: ${method}`));
            }
        }, 30000);

        messageQueue.push({ id, resolve, reject, timeoutId });
        
        const message = JSON.stringify(request) + '\n';
        agentProcess.stdin.write(message);
        console.log('->', message.trim());
    });
}



// ========== 处理 Agent 发来的消息 ==========
// ========== 处理 Agent 发来的消息 ==========
// ========== 修复：处理 Agent 发来的消息 ==========
function handleAgentMessage(line: string) {
    console.log('<-', line);
    
    try {
        const message = JSON.parse(line);
        console.log("message:", JSON.stringify(message));
        
        // 处理响应（对应我们发送的请求）
        if (message.id !== undefined) {
            const index = messageQueue.findIndex(q => q.id === message.id);
            if (index !== -1) {
                const queued = messageQueue[index];
                messageQueue.splice(index, 1);
                if (queued.timeoutId) {
                    clearTimeout(queued.timeoutId);
                }
                
                if (message.error) {
                    queued.reject(new Error(message.error.message));
                } else {
                    queued.resolve(message.result);
                }
            }
            return;
        }
        
        // 🔥 处理工具调用请求
        if (message.method === 'tool/call') {
            console.log("tool/call:", message);
            handleToolCallRequest(message);
            return;
        }
        
        // 🔥 处理 session/update（包含 AI 回答和工具调用）
        if (message.method === 'session/update' && message.params) {
            const update = message.params.update;
            
            // 🔥 处理工具调用 - 修复字段名
            if (update?.sessionUpdate === 'tool_call') {
                // 提取工具名称和参数
                const toolName = update.title || update.toolName;
                const args = update.rawInput || update.args || {};
                const callId = update.toolCallId || update.callId;
                
                console.log(`[ACP] 收到工具调用: ${toolName}`, args);
                
                handleToolCallRequest({
                    id: message.id,
                    params: {
                        callId: callId,
                        toolName: toolName,
                        args: args
                    }
                });
                return;
            }
            
            // 处理工具调用更新（工具执行结果）
            if (update?.sessionUpdate === 'tool_call_update') {
                const callId = update.toolCallId || update.callId;
                const result = update.content || update.result;
                console.log(`[ACP] 工具调用更新: ${callId}`, result);
                // 这里可以更新 UI 显示工具执行状态
                if (currentWebview) {
                    currentWebview.webview.postMessage({
                        type: 'toolResult',
                        id: callId,
                        result: result,
                        isError: false
                    });
                }
                return;
            }
            
            // 处理 AI 回答的文本块
            if (update?.sessionUpdate === 'agent_message_chunk') {
                const content = update.content?.text || '';
                if (currentWebview) {
                    currentWebview.webview.postMessage({
                        type: 'messageChunk',
                        content: content
                    });
                }
                return;
            }
            
            // 处理 AI 回答完成
            if (update?.sessionUpdate === 'agent_message') {
                const content = update.content?.text || '';
                if (currentWebview) {
                    currentWebview.webview.postMessage({
                        type: 'messageChunk',
                        content: content
                    });
                }
                return;
            }
            
            console.log('[ACP] 未处理的 session/update:', update?.sessionUpdate);
            return;
        }
        
        // 处理 session/notification
        if (message.method === 'session/notification' && message.params) {
            const notification = message.params.notification;
            
            if (notification?.type === 'agent_message_chunk') {
                const content = notification.content?.text || '';
                if (currentWebview) {
                    currentWebview.webview.postMessage({
                        type: 'messageChunk',
                        content: content
                    });
                }
                return;
            }
            
            if (notification?.type === 'tool_call') {
                const toolName = notification.title || notification.toolName;
                const args = notification.rawInput || notification.args || {};
                const callId = notification.toolCallId || notification.callId;
                
                handleToolCallRequest({
                    id: message.id,
                    params: {
                        callId: callId,
                        toolName: toolName,
                        args: args
                    }
                });
                return;
            }
            
            console.log('[ACP] 未处理的 notification:', notification?.type);
            return;
        }
        
        // ========== 处理其他 ACP 标准方法 ==========
        
        // 1. 文件读取请求
        if (message.method === 'fs/read_text_file') {
            handleFsReadTextFile(message);
            return;
        }
        
        // 2. 文件写入请求
        if (message.method === 'fs/write_text_file') {
            handleFsWriteTextFile(message);
            return;
        }
        
        // 3. 权限请求
        if (message.method === 'session/request_permission') {
            handleSessionRequestPermission(message);
            return;
        }
        
        // 4. 终端命令执行
        if (message.method === 'terminal/execute_command') {
            handleTerminalExecuteCommand(message);
            return;
        }
        
        // 5. 终端输出获取
        if (message.method === 'terminal/get_output') {
            handleTerminalGetOutput(message);
            return;
        }
        
        console.log('[ACP] 未处理的消息方法:', message.method);
        
    } catch (err) {
        console.error('解析消息出错:', err);
        console.error('原始消息:', line);
    }
}

// ========== 处理工具调用请求 ==========
async function handleToolCallRequest(message: any) {
    const { id, params } = message;
    const { callId, toolName, args } = params;
    
    console.log(`[ACP] 执行工具调用: ${toolName}`, args);
    
    // 🔥 权限控制：请求用户确认
    const confirm = await vscode.window.showWarningMessage(
        `Agent 想要调用工具: ${toolName}\n\n` +
        `参数: ${JSON.stringify(args, null, 2)}\n\n` +
        `是否允许？`,
        { modal: true },
        '允许', '拒绝'
    );
    
    if (confirm === '拒绝') {
        sendToolCallError(id, callId, '用户拒绝了工具调用');
        return;
    }
    
    try {
        let result: any;
        switch (toolName) {
            case 'ls':
            case 'list_directory':
                result = await handleToolListDirectory(args);
                break;
            case 'read_file_win':
                result = await handleToolReadFile(args);
                break;
            case 'write_file':
                result = await handleToolWriteFile(args);
                break;
            case 'execute_command':
                result = await handleToolExecuteCommand(args);
                break;
            case 'search_files':
                result = await handleToolSearchFiles(args);
                break;
            default:
                throw new Error(`未知工具: ${toolName}`);
        }
        
        // 返回结果
        sendToolCallResult(id, callId, result);
        
        if (currentWebview) {
            sendToWebview('toolResult', {
                id: callId || id,
                name: toolName,
                result: result
            });
        }
    } catch (error: any) {
        console.error(`工具 ${toolName} 执行失败:`, error);
        sendToolCallError(id, callId, error.message);
        
        if (currentWebview) {
            sendToWebview('toolResult', {
                id: callId || id,
                name: toolName,
                result: { success: false, error: error.message },
                isError: true
            });
        }
    }
}

// ========== 发送工具调用结果 ==========
// ========== 修复：发送工具调用结果（同时发送两种格式） ==========
function sendToolCallResult(id: number | undefined, callId: string, result: any) {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('Agent 进程未运行');
        return;
    }
    
    const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    
    // 🔥 方式1：如果有 id，发送 JSON-RPC 响应
    if (id !== undefined && id !== null) {
        const response = {
            jsonrpc: '2.0',
            id: id,
            result: {
                callId: callId,
                result: resultText
            }
        };
        const msg = JSON.stringify(response) + '\n';
        agentProcess.stdin.write(msg);
        console.log('-> tool result (JSON-RPC):', msg.trim());
    }
    
    // 🔥 方式2：同时发送 session/update 通知
    const updateMessage = {
        jsonrpc: '2.0',
        method: 'session/notification',
        params: {
            sessionId: currentSessionId,
            update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: callId,
                status: 'completed',
                content: [
                    {
                        type: 'text',
                        text: resultText
                    }
                ]
            }
        }
    };
    
    const msg2 = JSON.stringify(updateMessage) + '\n';
    agentProcess.stdin.write(msg2);
    console.log('-> tool result (update):', msg2.trim());
}

function sendToolCallError(id: number | undefined, callId: string, errorMessage: string) {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('Agent 进程未运行');
        return;
    }
    
    // 🔥 方式1：如果有 id，发送 JSON-RPC 错误响应
    if (id !== undefined && id !== null) {
        const response = {
            jsonrpc: '2.0',
            id: id,
            error: {
                code: -32000,
                message: errorMessage
            }
        };
        const msg = JSON.stringify(response) + '\n';
        agentProcess.stdin.write(msg);
        console.log('-> tool error (JSON-RPC):', msg.trim());
    }
    
    // 🔥 方式2：同时发送 session/update 通知
    const updateMessage = {
        jsonrpc: '2.0',
        method: 'session/notification',
        params: {
            sessionId: currentSessionId,
            update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: callId,
                status: 'failed',
                content: [
                    {
                        type: 'text',
                        text: `错误: ${errorMessage}`
                    }
                ]
            }
        }
    };
    
    const msg2 = JSON.stringify(updateMessage) + '\n';
    agentProcess.stdin.write(msg2);
    console.log('-> tool error (update):', msg2.trim());
}
function sendToAgent(message: any) {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('Agent 进程未运行');
        return;
    }
    const msg = JSON.stringify(message) + '\n';
    agentProcess.stdin.write(msg);
    console.log('->', msg.trim());
}

// ========== 🔥 核心：处理工具调用请求 ==========
async function handleToolCall(message: any) {
    const { id, params } = message;
    const { toolName, args, callId } = params;
    
    console.log(`[ACP] Agent 调用工具: ${toolName}`, args);
    
    if (currentWebview) {
        sendToWebview('toolCall', {
            id: callId || id,
            name: toolName,
            args: args
        });
        sendToWebview('addDebugLog', { 
            message: `🔧 工具调用: ${toolName}` 
        });
    }
    
    try {
        let result: any;
        
        // 根据工具名称分发到不同的处理函数
        switch (toolName) {
            case 'read_file_win':
                result = await handleToolReadFile(args);
                break;
            case 'write_file':
                result = await handleToolWriteFile(args);
                break;
            case 'execute_command':
                result = await handleToolExecuteCommand(args);
                break;
            case 'list_directory':
                result = await handleToolListDirectory(args);
                break;
            case 'search_files':
                result = await handleToolSearchFiles(args);
                break;
            default:
                throw new Error(`未知工具: ${toolName}`);
        }
        
        // 返回工具调用结果
        sendToolResponse(id, callId, result);
        
        if (currentWebview) {
            sendToWebview('toolResult', {
                id: callId || id,
                result: result
            });
        }
        
    } catch (error: any) {
        console.error(`工具 ${toolName} 执行失败:`, error);
        
        // 返回错误
        sendToolError(id, callId, error.message);
        
        if (currentWebview) {
            sendToWebview('toolResult', {
                id: callId || id,
                result: { success: false, error: error.message },
                isError: true
            });
            sendToWebview('addDebugLog', { 
                message: `❌ 工具调用失败: ${error.message}` 
            });
        }
    }
}

// ========== 发送工具调用响应 ==========
function sendToolResponse(id: number, callId: string, result: any) {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('无法发送响应：Agent 进程未运行');
        return;
    }
    
    const response = {
        jsonrpc: '2.0',
        id: id,
        result: {
            callId: callId || id.toString(),
            result: result
        }
    };
    
    const message = JSON.stringify(response) + '\n';
    agentProcess.stdin.write(message);
    console.log('-> tool response:', JSON.stringify(result).substring(0, 200));
}

function sendToolError(id: number, callId: string, errorMessage: string) {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('无法发送错误响应：Agent 进程未运行');
        return;
    }
    
    const response = {
        jsonrpc: '2.0',
        id: id,
        error: {
            code: -32000,
            message: errorMessage
        }
    };
    
    const message = JSON.stringify(response) + '\n';
    agentProcess.stdin.write(message);
    console.log('-> tool error:', errorMessage);
}

// ========== 工具实现函数 ==========

// 1. 读取文件
async function handleToolReadFile(args: any): Promise<any> {
    const { path: filePath, encoding = 'utf-8' } = args;
    
    let fullPath = filePath;
    if (!path.isAbsolute(fullPath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
        }
    }
    
    if (!fs.existsSync(fullPath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }
    
    const content = await fs.promises.readFile(fullPath, encoding);
    return {
        success: true,
        content: content,
        path: fullPath,
        encoding: encoding
    };
}

// 2. 写入文件
async function handleToolWriteFile(args: any): Promise<any> {
    const { path: filePath, content, encoding = 'utf-8' } = args;
    
    // 请求用户确认
    const confirm = await vscode.window.showWarningMessage(
        `Agent 想要写入文件: ${filePath}\n\n是否允许？`,
        { modal: true },
        '允许', '拒绝'
    );
    
    if (confirm !== '允许') {
        throw new Error('用户拒绝了写入操作');
    }
    
    let fullPath = filePath;
    if (!path.isAbsolute(fullPath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
        }
    }
    
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(fullPath, content, encoding);
    
    // 在 VSCode 中打开文件
    const document = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(document);
    
    return {
        success: true,
        path: fullPath,
        encoding: encoding
    };
}

// 3. 执行命令
async function handleToolExecuteCommand(args: any): Promise<any> {
    const { command, cwd, timeout = 30000 } = args;
    
    // 请求用户确认
    const confirm = await vscode.window.showWarningMessage(
        `Agent 想要执行命令:\n\n${command}\n\n是否允许？`,
        { modal: true },
        '允许', '拒绝'
    );
    
    if (confirm !== '允许') {
        throw new Error('用户拒绝了命令执行');
    }
    
    let workingDir = cwd;
    if (!workingDir) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            workingDir = workspaceFolders[0].uri.fsPath;
        } else {
            workingDir = process.cwd();
        }
    }
    
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
        const child = cp.exec(command, {
            cwd: workingDir,
            timeout: timeout,
            maxBuffer: 10 * 1024 * 1024
        }, (error, stdout, stderr) => {
            resolve({
                stdout: stdout,
                stderr: stderr,
                exitCode: error?.code || 0
            });
        });
    });
    
    return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
    };
}

// 4. 列出目录
async function handleToolListDirectory(args: any): Promise<any> {
    const { path: dirPath = '.', recursive = false } = args;
    
    let fullPath = dirPath;
    if (!path.isAbsolute(fullPath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            fullPath = path.join(workspaceFolders[0].uri.fsPath, dirPath);
        }
    }
    
    if (!fs.existsSync(fullPath)) {
        throw new Error(`目录不存在: ${dirPath}`);
    }
    
    const stat = await fs.promises.stat(fullPath);
    if (!stat.isDirectory()) {
        throw new Error(`不是目录: ${dirPath}`);
    }
    
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    
    let files = entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        path: path.join(dirPath, entry.name)
    }));
    
    // 递归列出子目录
    if (recursive) {
        const subFiles: any[] = [];
        for (const entry of files) {
            if (entry.isDirectory) {
                try {
                    const subResult = await handleToolListDirectory({
                        path: entry.path,
                        recursive: true
                    });
                    subFiles.push(...subResult.files.map((f: any) => ({
                        ...f,
                        path: path.join(entry.path, f.name)
                    })));
                } catch (e) {
                    // 忽略无法访问的目录
                }
            }
        }
        files = [...files, ...subFiles];
    }
    
    return {
        success: true,
        path: dirPath,
        files: files,
        count: files.length
    };
}

// 5. 搜索文件
async function handleToolSearchFiles(args: any): Promise<any> {
    const { pattern, path: searchPath = '.', filePattern = '*' } = args;
    
    let fullPath = searchPath;
    if (!path.isAbsolute(fullPath)) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            fullPath = path.join(workspaceFolders[0].uri.fsPath, searchPath);
        }
    }
    
    // 使用 VSCode 的搜索 API
    const searchResults = await vscode.workspace.findFiles(
        new vscode.RelativePattern(fullPath, filePattern),
        '**/node_modules/**',
        1000
    );
    
    // 读取文件内容并搜索
    const results: Array<{ file: string; line: number; content: string }> = [];
    const regex = new RegExp(pattern, 'gi');
    
    for (const file of searchResults) {
        try {
            const content = await fs.promises.readFile(file.fsPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    results.push({
                        file: vscode.workspace.asRelativePath(file),
                        line: i + 1,
                        content: lines[i].trim()
                    });
                }
            }
        } catch (e) {
            // 忽略无法读取的文件
        }
    }
    
    return {
        success: true,
        pattern: pattern,
        path: searchPath,
        results: results.slice(0, 100), // 限制结果数量
        count: results.length
    };
}
// ========== 标准 ACP 客户端方法实现 ==========

// 发送 JSON-RPC 响应
function sendResponse(id: number, result: any) {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('无法发送响应：Agent 进程未运行');
        return;
    }
    
    const response = {
        jsonrpc: '2.0',
        id: id,
        result: result
    };
    
    const message = JSON.stringify(response) + '\n';
    agentProcess.stdin.write(message);
    console.log('-> response:', JSON.stringify(result).substring(0, 200));
}

// 发送错误响应
function sendErrorResponse(id: number, errorMessage: string, errorCode: number = -32000) {
    if (!agentProcess || !agentProcess.stdin) {
        console.error('无法发送错误响应：Agent 进程未运行');
        return;
    }
    
    const response = {
        jsonrpc: '2.0',
        id: id,
        error: {
            code: errorCode,
            message: errorMessage
        }
    };
    
    const message = JSON.stringify(response) + '\n';
    agentProcess.stdin.write(message);
    console.log('-> error:', errorMessage);
}

// 1. 处理文件读取请求
async function handleFsReadTextFile(message: any) {
    const { id, params } = message;
    const { path: filePath } = params;
    
    console.log(`[ACP] Agent 请求读取文件: ${filePath}`);
    
    if (currentWebview) {
        sendToWebview('addDebugLog', { message: `📖 读取文件: ${filePath}` });
    }
    
    try {
        // 解析文件路径
        let fullPath = filePath;
        if (!path.isAbsolute(fullPath)) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
            }
        }
        
        // 检查文件是否存在
        if (!fs.existsSync(fullPath)) {
            sendErrorResponse(id, `File not found: ${filePath}`, -32001);
            return;
        }
        
        // 读取文件
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        
        sendResponse(id, {
            content: content,
            encoding: 'utf-8'
        });
        
        if (currentWebview) {
            sendToWebview('addDebugLog', { message: `✅ 文件读取成功: ${path.basename(fullPath)}` });
        }
        
    } catch (error: any) {
        console.error(`读取文件失败: ${filePath}`, error);
        sendErrorResponse(id, error.message);
        
        if (currentWebview) {
            sendToWebview('addDebugLog', { message: `❌ 读取文件失败: ${error.message}` });
        }
    }
}

// 2. 处理文件写入请求
async function handleFsWriteTextFile(message: any) {
    const { id, params } = message;
    const { path: filePath, content, encoding = 'utf-8' } = params;
    
    console.log(`[ACP] Agent 请求写入文件: ${filePath}`);
    
    // 请求用户确认
    const confirm = await vscode.window.showWarningMessage(
        `Agent 想要写入文件: ${filePath}\n\n是否允许？`,
        { modal: true },
        '允许', '拒绝'
    );
    
    if (confirm !== '允许') {
        sendErrorResponse(id, 'User denied file write operation', -32003);
        if (currentWebview) {
            sendToWebview('addDebugLog', { message: `🚫 用户拒绝了写入操作` });
        }
        return;
    }
    
    try {
        // 解析文件路径
        let fullPath = filePath;
        if (!path.isAbsolute(fullPath)) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                fullPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
            }
        }
        
        // 确保目录存在
        const dir = path.dirname(fullPath);
        await fs.promises.mkdir(dir, { recursive: true });
        
        // 写入文件
        await fs.promises.writeFile(fullPath, content, encoding);
        
        sendResponse(id, {
            success: true,
            path: fullPath
        });
        
        // 在 VSCode 中打开文件
        const document = await vscode.workspace.openTextDocument(fullPath);
        await vscode.window.showTextDocument(document);
        
        if (currentWebview) {
            sendToWebview('addDebugLog', { message: `✍️ 文件写入成功: ${path.basename(fullPath)}` });
        }
        
    } catch (error: any) {
        console.error(`写入文件失败: ${filePath}`, error);
        sendErrorResponse(id, error.message);
        
        if (currentWebview) {
            sendToWebview('addDebugLog', { message: `❌ 写入文件失败: ${error.message}` });
        }
    }
}

// 3. 处理权限请求
async function handleSessionRequestPermission(message: any) {
    const { id, params } = message;
    const { toolCallId, toolName, input, description } = params;
    
    console.log(`[ACP] Agent 请求权限: ${toolName}`, input);
    
    // 显示确认对话框
    const result = await vscode.window.showWarningMessage(
        `Agent 想要执行操作: ${toolName}\n\n` +
        `描述: ${description || '无'}\n\n` +
        `参数: ${JSON.stringify(input, null, 2)}\n\n` +
        `是否允许？`,
        { modal: true },
        '允许', '拒绝'
    );
    
    const approved = result === '允许';
    
    sendResponse(id, {
        decision: approved ? 'approve' : 'reject',
        reason: approved ? undefined : 'User denied'
    });
    
    if (currentWebview) {
        sendToWebview('addDebugLog', { 
            message: `🔐 权限请求: ${toolName} -> ${approved ? '允许' : '拒绝'}` 
        });
    }
}

// 4. 处理终端命令执行
async function handleTerminalExecuteCommand(message: any) {
    const { id, params } = message;
    const { command, cwd, timeout = 30000 } = params;
    
    console.log(`[ACP] Agent 请求执行命令: ${command}`);
    
    // 请求用户确认
    const confirm = await vscode.window.showWarningMessage(
        `Agent 想要执行命令:\n\n${command}\n\n工作目录: ${cwd || '当前工作区'}\n\n是否允许？`,
        { modal: true },
        '允许', '拒绝'
    );
    
    if (confirm !== '允许') {
        sendErrorResponse(id, 'User denied command execution', -32003);
        if (currentWebview) {
            sendToWebview('addDebugLog', { message: `🚫 用户拒绝了命令执行` });
        }
        return;
    }
    
    try {
        // 确定工作目录
        let workingDir = cwd;
        if (!workingDir) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                workingDir = workspaceFolders[0].uri.fsPath;
            } else {
                workingDir = process.cwd();
            }
        }
        
        // 执行命令
        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
            const child = cp.exec(command, {
                cwd: workingDir,
                timeout: timeout,
                maxBuffer: 10 * 1024 * 1024
            }, (error, stdout, stderr) => {
                resolve({
                    stdout: stdout,
                    stderr: stderr,
                    exitCode: error?.code || 0
                });
            });
        });
        
        sendResponse(id, {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
        });
        
        if (currentWebview) {
            sendToWebview('addDebugLog', { 
                message: `💻 命令执行完成，退出码: ${result.exitCode}` 
            });
        }
        
    } catch (error: any) {
        console.error(`命令执行失败: ${command}`, error);
        sendErrorResponse(id, error.message);
    }
}

// 5. 处理终端输出获取（可选实现）
async function handleTerminalGetOutput(message: any) {
    const { id } = message;
    
    // 简单返回空输出
    sendResponse(id, {
        output: '',
        error: 'Terminal output capture not implemented'
    });
}

// ========== 发送消息到 Agent ==========
async function sendPrompt(text: string): Promise<void> {
    if (!agentProcess || !currentSessionId) {
        vscode.window.showWarningMessage('Agent 未连接，请先启动 Agent');
        return;
    }

    try {
        // 清空当前累积的消息
        if (currentWebview) {
            sendToWebview('clearCurrentMessage', {});
        }
        
        await sendRequest('session/prompt', {
            sessionId: currentSessionId,
            prompt: [{ type: 'text', text: text }]
        });
    } catch (err) {
        vscode.window.showErrorMessage(`发送消息失败: ${err}`);
    }
}

// ========== 停止 Agent ==========
function stopAgent() {
    if (agentProcess) {
        agentProcess.kill();
        agentProcess = null;
        currentSessionId = null;
        currentAgentConfig = null;
        vscode.window.showInformationMessage('Agent 已停止');
        
        for (const item of messageQueue) {
            if (item.timeoutId) {
                clearTimeout(item.timeoutId);
            }
            item.reject(new Error('Agent 已停止'));
        }
        messageQueue = [];
    }
}

// ========== Webview 通信辅助 ==========
function sendToWebview(type: string, data: any) {
    if (currentWebview) {
        currentWebview.webview.postMessage({ type, ...data });
    }
}

// ========== 获取所有可用的 Agent 列表 ==========
function getAvailableAgents(): { name: string; config: any }[] {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return [];
    }
    
    const config = vscode.workspace.getConfiguration();
    let agents = config.get<Record<string, any>>('deep.acp.agents');
    
    if (!agents || Object.keys(agents).length === 0) {
        const settingsPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'settings.json');
        
        try {
            if (fs.existsSync(settingsPath)) {
                const content = fs.readFileSync(settingsPath, 'utf8');
                const settings = JSON.parse(content);
                agents = settings['deep.acp.agents'];
                console.log(`从文件读取配置: ${settingsPath}`);
            }
        } catch (err) {
            console.error('读取配置文件失败:', err);
        }
    }
    
    if (!agents || Object.keys(agents).length === 0) {
        return [];
    }
    
    return Object.entries(agents).map(([name, config]) => ({
        name,
        config
    }));
}

// ========== 聊天视图提供器 ==========
class ChatViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly extensionUri: vscode.Uri) {}

    resolveWebviewView(webviewView: vscode.WebviewView) {
        console.log('✅ resolveWebviewView 被调用');
        currentWebview = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true
        };
        
        const agents = getAvailableAgents();
        webviewView.webview.html = this.getHtml(agents);
        
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log('收到 Webview 消息:', message.type);
            switch (message.type) {
                case 'sendMessage':
                    await sendPrompt(message.text);
                    break;
                case 'startAgent':
                    await startAgent(message.agentName);
                    break;
                case 'stopAgent':
                    stopAgent();
                    break;
                case 'clearChat':
                    if (currentWebview) {
                        sendToWebview('clearChat', {});
                    }
                    break;
                case 'getAgents':
                    const updatedAgents = getAvailableAgents();
                    sendToWebview('updateAgents', { agents: updatedAgents });
                    break;
                case 'webviewReady':
                    console.log('Webview 已就绪');
                    if (agentProcess && currentSessionId) {
                        sendToWebview('agentReady', { 
                            sessionId: currentSessionId,
                            agentName: currentAgentConfig?.name || 'Agent'
                        });
                    }
                    break;
            }
        });
    }

    private getHtml(agents: { name: string; config: any }[]): string {
        const agentOptions = agents.map(agent => 
            `<option value="${this.escapeHtml(agent.name)}">${this.escapeHtml(agent.name)}</option>`
        ).join('');
        
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { padding: 10px; font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
                    #messages { height: 350px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); padding: 10px; margin-bottom: 10px; border-radius: 4px; }
                    .message { margin-bottom: 12px; padding: 8px; border-radius: 8px; }
                    .user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); text-align: right; }
                    .assistant { background: var(--vscode-editor-inactiveSelectionBackground); }
                    .tool-call { background: var(--vscode-terminal-ansiYellow); color: black; font-size: 12px; margin: 4px 0; padding: 4px; border-radius: 4px; }
                    .tool-result { background: var(--vscode-terminal-ansiGreen); color: black; font-size: 11px; margin: 2px 0 4px 0; padding: 4px; border-radius: 4px; font-family: monospace; }
                    .tool-error { background: var(--vscode-terminal-ansiRed); color: white; }
                    .role-label { font-weight: bold; margin-bottom: 4px; font-size: 12px; }
                    .content { word-wrap: break-word; white-space: pre-wrap; }
                    .status { margin-bottom: 10px; padding: 8px; background: var(--vscode-statusBar-background); border-radius: 4px; font-size: 12px; }
                    #input-container { display: flex; gap: 8px; }
                    #input { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; resize: vertical; font-family: inherit; }
                    button { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    button:disabled { opacity: 0.5; cursor: not-allowed; }
                    .agent-controls { display: flex; gap: 8px; margin-bottom: 10px; }
                    .agent-selector { margin-bottom: 10px; padding: 8px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
                    .agent-selector select { width: 100%; padding: 6px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 4px; font-family: inherit; }
                    .agent-selector label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }
                    .button-group { display: flex; gap: 8px; margin-top: 8px; }
                    .refresh-btn { background: var(--vscode-secondaryButton-background); color: var(--vscode-secondaryButton-foreground); padding: 4px 8px; font-size: 12px; }
                    .tools-list { margin-top: 10px; padding: 8px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-size: 11px; }
                    .tools-list summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
                    .tools-list ul { margin: 4px 0 0 20px; padding: 0; }
                    .tools-list li { margin: 2px 0; }
					 /* 新增工具列表样式 */
                .tools-container {
                    margin-top: 8px;
                    padding: 8px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    font-size: 11px;
                    max-height: 200px;
                    overflow-y: auto;
                }
                .tools-container summary {
                    cursor: pointer;
                    color: var(--vscode-descriptionForeground);
                    font-weight: bold;
                }
                .tools-container .tool-item {
                    padding: 2px 8px;
                    margin: 2px 0;
                    border-radius: 3px;
                    font-family: monospace;
                    font-size: 11px;
                }
                .tools-container .tool-item:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .tools-container .tool-name {
                    color: var(--vscode-symbolIcon-functionForeground);
                }
                .tools-container .tool-desc {
                    color: var(--vscode-descriptionForeground);
                    margin-left: 8px;
                }
                </style>
            </head>
            <body>
                <div class="agent-selector">
                    <label>选择 Agent 配置:</label>
                    <select id="agentSelect">
                        <option value="">请选择 Agent...</option>
                        ${agentOptions}
                    </select>
                    <div class="button-group">
                        <button id="startWithSelectBtn" class="start-btn">▶ 启动选中的 Agent</button>
                        <button id="refreshAgentsBtn" class="refresh-btn">🔄 刷新列表</button>
                    </div>
                </div>
                
                <div class="agent-controls">
                    <button id="stopBtn">⏹ 停止 Agent</button>
                    <button id="clearBtn">🗑 清除对话</button>
                </div>
                <div id="status" class="status">⚪ Agent 未启动</div>

				 <div class="tools-container">
                <summary>🔧 可用工具 (<span id="toolCount">0</span>)</summary>
                <div id="toolsList"></div>
            </div>

                <div id="messages"></div>
                <div id="input-container">
                    <textarea id="input" rows="2" placeholder="输入消息..." disabled></textarea>
                    <button id="sendBtn" disabled>发送</button>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    let currentMessage = '';
                    let currentToolCalls = new Map();
                    
                    const agentSelect = document.getElementById('agentSelect');
                    const startWithSelectBtn = document.getElementById('startWithSelectBtn');
                    const stopBtn = document.getElementById('stopBtn');
                    const clearBtn = document.getElementById('clearBtn');
                    const refreshAgentsBtn = document.getElementById('refreshAgentsBtn');
                    const sendBtn = document.getElementById('sendBtn');
                    const input = document.getElementById('input');
                    const statusDiv = document.getElementById('status');
                    const messagesDiv = document.getElementById('messages');
                    
                    startWithSelectBtn.onclick = () => {
                        const selectedAgent = agentSelect.value;
                        if (!selectedAgent) {
                            statusDiv.innerHTML = '⚠️ 请先选择一个 Agent';
                            setTimeout(() => {
                                if (statusDiv.innerHTML === '⚠️ 请先选择一个 Agent') {
                                    statusDiv.innerHTML = '⚪ Agent 未启动';
                                }
                            }, 2000);
                            return;
                        }
                        vscode.postMessage({ type: 'startAgent', agentName: selectedAgent });
                    };
                    
                    refreshAgentsBtn.onclick = () => {
                        vscode.postMessage({ type: 'getAgents' });
                    };
                    
                    stopBtn.onclick = () => {
                        vscode.postMessage({ type: 'stopAgent' });
                    };
                    
                    clearBtn.onclick = () => {
                        messagesDiv.innerHTML = '';
                        currentMessage = '';
                        currentToolCalls.clear();
                        vscode.postMessage({ type: 'clearChat' });
                    };
                    
                    sendBtn.onclick = sendMessage;
                    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
                    
                    function sendMessage() {
                        const text = input.value.trim();
                        if (text) {
                            addMessage('user', text);
                            vscode.postMessage({ type: 'sendMessage', text: text });
                            input.value = '';
                            currentMessage = '';
                        }
                    }
                    
                    function addMessage(role, content) {
                        const msgDiv = document.createElement('div');
                        msgDiv.className = 'message ' + role;
                        msgDiv.innerHTML = \`<div class="role-label">\${role === 'user' ? '你' : '助手'}</div><div class="content">\${escapeHtml(content)}</div>\`;
                        messagesDiv.appendChild(msgDiv);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }
                    
                    function addToolCall(id, name, args) {
                        const toolDiv = document.createElement('div');
                        toolDiv.id = 'tool-' + id;
                        toolDiv.className = 'tool-call';
                        toolDiv.innerHTML = \`🔧 调用工具: \${escapeHtml(name)}<br><pre style="margin:4px 0 0 0; font-size:11px;">\${escapeHtml(JSON.stringify(args, null, 2))}</pre>\`;
                        messagesDiv.appendChild(toolDiv);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                        currentToolCalls.set(id, toolDiv);
                    }
                    
                    function updateToolResult(id, result, isError) {
                        const toolDiv = currentToolCalls.get(id);
                        if (toolDiv) {
                            const resultClass = isError ? 'tool-error' : '';
                            const resultHtml = \`<div class="tool-result \${resultClass}">📋 结果: <pre style="margin:4px 0 0 0; font-size:10px; max-height:200px; overflow:auto;">\${escapeHtml(JSON.stringify(result, null, 2))}</pre></div>\`;
                            toolDiv.insertAdjacentHTML('beforeend', resultHtml);
                        }
                    }
                    
                    function updateMessage(content) {
                        const lastMsg = messagesDiv.lastElementChild;
                        if (lastMsg && lastMsg.classList.contains('assistant')) {
                            const contentDiv = lastMsg.querySelector('.content');
                            contentDiv.innerHTML = escapeHtml(content);
                        } else if (content) {
                            addMessage('assistant', content);
                        }
                    }
                    
                    function clearCurrentMessage() {
                        const lastMsg = messagesDiv.lastElementChild;
                        if (lastMsg && lastMsg.classList.contains('assistant')) {
                            const contentDiv = lastMsg.querySelector('.content');
                            contentDiv.innerHTML = '';
                        }
                        currentMessage = '';
                    }
                    
                    function updateAgentsList(agents) {
                        const currentValue = agentSelect.value;
                        agentSelect.innerHTML = '<option value="">请选择 Agent...</option>';
                        agents.forEach(agent => {
                            const option = document.createElement('option');
                            option.value = agent.name;
                            option.textContent = agent.name;
                            agentSelect.appendChild(option);
                        });
                        if (currentValue && Array.from(agentSelect.options).some(opt => opt.value === currentValue)) {
                            agentSelect.value = currentValue;
                        }
                    }
                    
                    function escapeHtml(text) {
                        if (typeof text !== 'string') text = String(text);
                        const div = document.createElement('div');
                        div.textContent = text;
                        return div.innerHTML;
                    }
                    
                    window.addEventListener('message', event => {
                        const msg = event.data;
                        switch (msg.type) {
                            case 'agentReady':
                                statusDiv.innerHTML = '🟢 Agent 已启动 (' + (msg.agentName || 'Agent') + ')';
                                input.disabled = false;
                                sendBtn.disabled = false;
                                addMessage('assistant', 'Agent 已就绪，可以开始对话。');
                                break;
                            case 'agentStopped':
                                statusDiv.innerHTML = '⚪ Agent 已停止';
                                input.disabled = true;
                                sendBtn.disabled = true;
                                currentMessage = '';
                                break;
                            case 'messageChunk':
                                currentMessage += msg.content;
                                updateMessage(currentMessage);
                                break;
                            case 'toolCall':
                                addToolCall(msg.id, msg.name, msg.args);
                                break;
                            case 'toolResult':
                                updateToolResult(msg.id, msg.result, msg.result?.success === false);
                                break;
                            case 'addDebugLog':
                                console.log('[Debug]', msg.message);
                                if (msg.message && msg.message.includes('错误')) {
                                    statusDiv.innerHTML = '❌ ' + msg.message;
                                    setTimeout(() => {
                                        if (statusDiv.innerHTML.startsWith('❌')) {
                                            statusDiv.innerHTML = '⚪ Agent 未启动';
                                        }
                                    }, 3000);
                                }
                                break;
                            case 'clearChat':
                                messagesDiv.innerHTML = '';
                                currentMessage = '';
                                currentToolCalls.clear();
                                break;
                            case 'clearCurrentMessage':
                                clearCurrentMessage();
                                break;
                            case 'updateAgents':
                                updateAgentsList(msg.agents);
                                break;
							case 'agentReady':
								statusDiv.innerHTML = '🟢 Agent 已启动 (' + (msg.agentName || 'Agent') + ')';
								input.disabled = false;
								sendBtn.disabled = false;
								if (msg.tools) {
									updateToolsList(msg.tools);
								}
								addMessage('assistant', 'Agent 已就绪，可以开始对话。');
								break;
                        }
                    });


                
                    
                    vscode.postMessage({ type: 'webviewReady' });
                </script>
            </body>
            </html>
        `;
    }
    
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

