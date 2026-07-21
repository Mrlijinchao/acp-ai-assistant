// import * as vscode from 'vscode';
// import { AgentClient } from './AgentClient';
// import { Configuration } from '../config/Configuration';
// import { Logger } from '../utils/logger';
// import type { SessionInfo, AgentEvent } from './types';
// import { ToolManager } from '../tools';
// import { FileBackupManager } from '../tools/FileBackupManager';
// import { ChatHistory } from '../storage/ChatHistory';

// import * as path from 'path';  // 添加 path 导入

// export class AgentManager {
//     private client: AgentClient | null = null;
//     private sessionInfo: SessionInfo | null = null;
//     private eventListeners: Map<string, Set<Function>> = new Map();
//     private logger: Logger;
//     private toolManager: ToolManager | null = null;
//     private isStarting = false;
//     private currentTaskId: string | null = null; // 当前任务ID
//     private backupManager: FileBackupManager | null = null;
//     private chatHistory: ChatHistory| null = null;

//     constructor(private configuration: Configuration, chatHistory: ChatHistory) {
//         this.logger = new Logger('AgentManager');
//         this.chatHistory = chatHistory;
//     }

//      async start(agentName: string): Promise<void> {
//         if (this.isStarting) {
//             this.logger.warn('Agent already starting');
//             return;
//         }
        
//         if (this.client?.isRunning()) {
//             throw new Error('Agent already running');
//         }

//         this.isStarting = true;

//         try {

//             // 初始化备份管理器
//             const workspaceFolders = vscode.workspace.workspaceFolders;
//             if (workspaceFolders && workspaceFolders.length > 0) {
//                 const workspaceRoot = workspaceFolders[0].uri.fsPath;
//                 this.backupManager = new FileBackupManager(workspaceRoot);
//                 this.setupBackupManagerListeners()
//             }


//             // 确保旧的 MCP Server 已停止
//             await this.stopMcpServer();
            
//             // 创建新的 MCP Server
//             this.toolManager = new ToolManager(9876, this.backupManager);
//             await this.toolManager.start();
//             this.logger.info(`MCP Server started on port ${this.toolManager.getPort()}`);

//             // 等待 MCP Server 完全启动
//             await this.waitForMcpServer(9876);
            
//             this.logger.info('Starting agent...');
//             const agentConfig = this.configuration.getAgentConfig(agentName);
//             this.logger.info('Agent config:', JSON.stringify(agentConfig, null, 2));
            
//             this.client = new AgentClient(agentConfig);
//             this.setupClientListeners();

//             const mcpServerUrl = `http://localhost:${this.toolManager?.getPort()}`;
            
//             await this.client.start(mcpServerUrl);
//             await this.performHandshake();
//             // 开始一个新的审批会话（任务）
//             this.startNewTask();

//         } catch (error) {
//             this.logger.error('Failed to start agent:', error);
//             throw error;
//         } finally {
//             this.isStarting = false;
//         }
//     }


//     /**
//      * ⭐ 获取修改列表（不触发事件）
//      */
//     async getPendingChanges(): Promise<any[]> {
//         if (!this.backupManager) {
//             return [];
//         }

//         // ✅ 使用 getChangesWithoutEvent 而不是 detectChanges
//         const changes = await this.backupManager.getChangesWithoutEvent();
//         return changes
//             .filter(c => c.type !== 'unchanged')
//             .map(c => ({
//                 filePath: c.filePath,
//                 type: c.type,
//                 status: 'pending',
//                 description: c.type === 'created' ? '创建新文件' :
//                             c.type === 'modified' ? '修改文件' :
//                             '删除文件'
//             }));
//     }

//     /**
//      * ⭐ 发送待确认修改到 UI
//      */
//     private async sendPendingChangesToUI(): Promise<void> {
//         const changes = await this.getPendingChanges();
//         this.emit('updateChanges', {
//             type: 'updateChanges',
//             changes: changes
//         });
//         this.logger.info(`Sent ${changes.length} pending changes to UI`);
//     }

//     /**
//      * 设置备份管理器事件监听
//      */
//     private setupBackupManagerListeners(): void {
//         if (!this.backupManager) return;

//         // ✅ 监听 fileChanged 事件
//         this.backupManager.on('fileChanged', (data) => {
//             this.logger.info(`File changed detected: ${data.filePath}`);
            
//             // ✅ 不要在这里调用 sendPendingChangesToUI
//             // 而是直接发送变化数据到 UI
//             const changes = data.allChanges
//                 .filter((c: any) => c.type !== 'unchanged')
//                 .map((c: any) => ({
//                     filePath: c.filePath,
//                     type: c.type,
//                     status: 'pending',
//                     description: c.type === 'created' ? '创建新文件' :
//                                 c.type === 'modified' ? '修改文件' :
//                                 '删除文件'
//                 }));
            
//             // 直接发送到 UI，避免通过 getPendingChanges 再次触发
//             this.emit('updateChanges', {
//                 type: 'updateChanges',
//                 changes: changes
//             });
//         });

//         // ✅ 监听 rollbackCompleted
//         this.backupManager.on('rollbackCompleted', (data) => {
//             this.logger.info(`Rollback completed: ${data.success}`);
//             this.emit('rollbackCompleted', {
//                 type: 'rollbackCompleted',
//                 success: data.success,
//                 errors: data.errors
//             });
//             this.emit('changesRolledBack', {
//                 type: 'changesRolledBack',
//                 transactionId: this.currentTaskId || null
//             });
//             // ✅ 回滚完成后刷新 UI
//             this.sendPendingChangesToUI();
//         });

//         // ✅ 监听 commitCompleted
//         this.backupManager.on('commitCompleted', (data) => {
//             this.logger.info(`Commit completed: ${data.changes.length} changes`);
//             this.emit('commitCompleted', {
//                 type: 'commitCompleted',
//                 changes: data.changes
//             });
//             this.emit('changesCommitted', {
//                 type: 'changesCommitted',
//                 transactionId: this.currentTaskId || null,
//                 changes: data.changes
//             });
//             // ✅ 提交完成后刷新 UI（此时没有变化了）
//             this.sendPendingChangesToUI();
//         });

//         // ✅ 监听 fileBackedUp（备份完成，可能有变化）
//         this.backupManager.on('fileBackedUp', (data) => {
//             this.logger.info(`File backed up: ${data.filePath}`);
//             // 延迟一点再刷新，等文件操作完成
//             setTimeout(() => {
//                 this.sendPendingChangesToUI();
//             }, 100);
//         });
//     }

//     /**
//      * 回滚修改
//      */
//     async rollbackChanges(): Promise<void> {
//         if (!this.backupManager) {
//             vscode.window.showWarningMessage('没有活跃的备份');
//             return;
//         }

//         const result = await this.backupManager.rollbackAll();
//         if (result.success) {
//             vscode.window.showInformationMessage('✅ 已回滚所有修改');
//             this.emit('rollbackCompleted', {
//                 type: 'rollbackCompleted',
//                 success: true
//             });
//             // 同时触发 changesRolledBack
//             this.emit('changesRolledBack', {
//                 type: 'changesRolledBack',
//                 transactionId: this.currentTaskId || null
//             });
//         } else {
//             vscode.window.showErrorMessage(`回滚失败: ${result.errors?.join(', ') || '未知错误'}`);
//             this.emit('rollbackCompleted', {
//                 type: 'rollbackCompleted',
//                 success: false,
//                 errors: result.errors
//             });
//         }
//     }

//     /**
//      * 提交修改
//      */
//     commitChanges(): void {
//         if (!this.backupManager) {
//             vscode.window.showWarningMessage('没有活跃的备份');
//             return;
//         }

//         const stats = this.backupManager.getStats();
//         if (stats.total === 0) {
//             vscode.window.showInformationMessage('没有需要提交的修改');
//             return;
//         }

//         this.backupManager.commitAll();
//         vscode.window.showInformationMessage(`✅ 已提交 ${stats.total} 个文件的修改`);
//     }

//     /**
//      * ⭐ 显示文件差分（使用 VSCode 内置 Diff 工具）
//      */
//     async showFileDiff(filePath: string): Promise<void> {
//         if (!this.backupManager) {
//             vscode.window.showWarningMessage('没有备份管理器');
//             return;
//         }

//         const backup = this.backupManager.getBackup(filePath);
//         if (!backup) {
//             vscode.window.showWarningMessage(`文件 ${filePath} 没有备份，无法查看差分`);
//             return;
//         }

//         // 获取当前文件内容
//         let currentContent = '';
//         let fileExists = true;
//         try {
//             const uri = vscode.Uri.file(filePath);
//             const data = await vscode.workspace.fs.readFile(uri);
//             currentContent = Buffer.from(data).toString('utf8');
//         } catch (error) {
//             fileExists = false;
//             currentContent = ''; // 文件已被删除
//         }

//         // 原始内容（备份的内容）
//         const originalContent = backup.originalContent.toString('utf8');

//         // 如果文件不存在，用空内容
//         if (!fileExists && backup.isNewFile) {
//             // 新文件被删除了，显示空内容
//             vscode.window.showWarningMessage(`文件 ${path.basename(filePath)} 已被删除`);
//         }

//         // 创建虚拟 URI 显示原始内容（左侧）
//         const originalUri = vscode.Uri.parse(
//             `memfs:/original-${Date.now()}/${path.basename(filePath)}`
//         );

//         // 当前文件 URI（右侧）
//         const currentUri = vscode.Uri.file(filePath);

//         // 注册虚拟文件内容提供者
//         const provider = new (class implements vscode.TextDocumentContentProvider {
//             onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
//             onDidChange = this.onDidChangeEmitter.event;

//             provideTextDocumentContent(uri: vscode.Uri): string {
//                 return originalContent;
//             }
//         })();

//         const providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
//             'memfs', 
//             provider
//         );

//         try {
//             // ⭐ 使用 VSCode 内置的 diff 命令
//             await vscode.commands.executeCommand(
//                 'vscode.diff',
//                 originalUri,
//                 currentUri,
//                 `📊 ${path.basename(filePath)} (原始 ↔ 当前)`,
//                 { preview: true }
//             );
//         } catch (error) {
//             vscode.window.showErrorMessage(`打开差分失败: ${error}`);
//         } finally {
//             // 延迟释放，让 diff 视图能正常显示
//             setTimeout(() => {
//                 providerRegistration.dispose();
//             }, 5000);
//         }
//     }


//      /**
//      * 开始新任务
//      */
//     private startNewTask(): void {
//         if (this.toolManager) {
//             this.currentTaskId = this.toolManager.getApprovalManager().startNewSession();
//             this.logger.info(`Started new task session: ${this.currentTaskId}`);
//             this.emit('taskStarted', { 
//                 type: 'taskStarted', 
//                 taskId: this.currentTaskId 
//             });
//         }
//     }

//     /**
//      * 结束当前任务
//      */
//     private endTask(): void {
//         if (this.toolManager) {
//             this.toolManager.getApprovalManager().endSession();
//             this.logger.info(`Ended task session: ${this.currentTaskId}`);
//             this.currentTaskId = null;
//         }
//     }

//     /**
//      * 获取当前任务ID
//      */
//     getCurrentTaskId(): string | null {
//         return this.currentTaskId;
//     }

//     /**
//      * 获取当前任务的审批状态
//      */
//     getApprovalStatus(): { autoApprove: boolean; approvedTools: string[] } | null {
//         if (!this.toolManager) return null;
//         const sessionInfo = this.toolManager.getApprovalManager().getSessionInfo();
//         if (!sessionInfo) return null;
//         return {
//             autoApprove: sessionInfo.autoApprove,
//             approvedTools: sessionInfo.approvedTools
//         };
//     }

//     /**
//      * 禁用自动批准
//      */
//     disableAutoApprove(): void {
//         if (this.toolManager) {
//             this.toolManager.getApprovalManager().disableAutoApprove();
//             this.emit('autoApproveDisabled', { type: 'autoApproveDisabled' });
//             vscode.window.showInformationMessage('Auto-approval disabled for current task');
//         }
//     }

//     private async waitForMcpServer(port: number, maxRetries = 10): Promise<void> {
//         const http = require('http');
        
//         for (let i = 0; i < maxRetries; i++) {
//             try {
//                 await new Promise((resolve, reject) => {
//                     const req = http.request({
//                         hostname: 'localhost',
//                         port: port,
//                         path: '/health',
//                         method: 'GET',
//                         timeout: 1000
//                     }, (res: any) => {
//                         if (res.statusCode === 200) {
//                             resolve(true);
//                         } else {
//                             reject(new Error(`Health check failed: ${res.statusCode}`));
//                         }
//                     });
//                     req.on('error', reject);
//                     req.end();
//                 });
//                 this.logger.info(`MCP Server is ready on port ${port}`);
//                 return;
//             } catch (error) {
//                 this.logger.debug(`Waiting for MCP Server... (${i + 1}/${maxRetries})`);
//                 await new Promise(resolve => setTimeout(resolve, 500));
//             }
//         }
//         throw new Error(`MCP Server failed to start on port ${port}`);
//     }

//     private async stopMcpServer(): Promise<void> {
//         if (this.toolManager) {
//             this.logger.info('Stopping existing MCP Server...');
//             this.toolManager.stop();
//             this.toolManager = null;
            
//             // 等待端口释放
//             await new Promise(resolve => setTimeout(resolve, 1000));
//         }
//     }

//     private setupClientListeners(): void {
//         if (!this.client) return;

//         this.client.on('error', (error) => {
//             this.logger.error('Client error:', error);
//             this.emit('error', { type: 'error', error });
//             vscode.window.showErrorMessage(`Agent error: ${error.message}`);
//         });

//         this.client.on('stopped', (data) => {
//             this.logger.info('Client stopped:', data);
//             this.emit('stopped', { type: 'stopped', code: data.code });
//             this.sessionInfo = null;
//             // 结束任务
//             this.endTask();
//         });

//         this.client.on('notification', (notification) => {
//             this.handleNotification(notification);
//         });

//         // 监听工具审批请求
//         if (this.toolManager) {
//             const approvalManager = this.toolManager.getApprovalManager();
//             approvalManager.on('approved', (data) => {
//                 this.emit('toolApproved', { callId: data.callId, toolName: data.toolName });
//             });
//             approvalManager.on('rejected', (data) => {
//                 this.emit('toolRejected', { callId: data.callId, toolName: data.toolName });
//             });
//             approvalManager.on('autoApproved', (data) => {
//                 this.emit('toolAutoApproved', {
//                     type: 'toolAutoApproved',
//                     toolName: data.toolName,
//                     sessionId: data.sessionId
//                 });
//             });

//             approvalManager.on('autoApproveEnabled', (data) => {
//                 this.emit('autoApproveEnabled', {
//                     type: 'autoApproveEnabled',
//                     sessionId: data.sessionId
//                 });
//                 vscode.window.showInformationMessage(
//                     `✅ Auto-approval enabled for this task`
//                 );
//             });

//             approvalManager.on('autoApproveDisabled', (data) => {
//                 this.emit('autoApproveDisabled', {
//                     type: 'autoApproveDisabled',
//                     sessionId: data.sessionId
//                 });
//             });
//         }
//     }

//     private async performHandshake(): Promise<void> {
//         if (!this.client) throw new Error('Client not initialized');

//         try {
//             this.logger.info('Sending initialize request...');
//             const initResult = await this.client.request('initialize', {
//                 protocolVersion: 1,
//                 clientInfo: {
//                     name: 'vscode-acp-plugin',
//                     version: '0.0.1'
//                 },
//                 capabilities: {
//                     fs: { readTextFile: true, writeTextFile: true },
//                     terminal: true,
//                     tools: true
//                 }
//             });
//             this.logger.info('Initialize response:', initResult);

//             const workspaceFolders = vscode.workspace.workspaceFolders;
//             const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

//             // 获取 MCP Server 的 URL
//             const mcpServerUrl = `http://localhost:${this.toolManager?.getPort()}`;
            
//             this.logger.info('Creating session with MCP server URL:', mcpServerUrl);
            
//             // 按照 deepagents-acp 要求的严格格式
//             const sessionResult = await this.client.request('session/new', {
//                 cwd: cwd,
//                 mcpServers: [{
//                     name: 'vscode-local-tools',
//                     type: 'sse',  // 必须是 'sse'
//                     url: mcpServerUrl,
//                     headers: [],   // 必须是数组
//                     // 以下字段虽然可能用不到，但必须提供
//                     command: '',   // 空字符串或占位符
//                     args: [],      // 空数组
//                     env: []        // 空数组
//                 }]
//             });

//             this.sessionInfo = {
//                 id: sessionResult.sessionId,
//                 cwd,
//                 createdAt: new Date()
//             };

//             this.logger.info('Session created:', this.sessionInfo);
//             this.emit('ready', { type: 'ready', sessionId: this.sessionInfo.id });
            
//         } catch (error) {
//             this.logger.error('Handshake failed:', error);
//             throw new Error(`Handshake failed: ${error}`);
//         }
//     }


//     private async handleNotification(notification: any): Promise<void> {
//         if (notification.method === 'session/update') {
//             const update = notification.params.update;
            
//             if (update.sessionUpdate === 'agent_message_chunk') {
//                 this.emit('messageChunk', { 
//                     type: 'messageChunk', 
//                     content: update.content?.text || '' 
//                 }); 
//             }
//             else if (update.sessionUpdate === 'agent_thought_chunk') {
//                 // 处理思考过程
//                 const content = update.content?.text || '';
//                 this.emit('thoughtChunk', { type: 'thoughtChunk', content });
//                 console.log('Thought chunk received:', content);
//             }
//             else if (update.sessionUpdate === 'thought_message_chunk') {
//                 // 另一种思考消息格式
//                 const content = update.content?.text || '';
//                 this.emit('thoughtChunk', { type: 'thoughtChunk', content });
//                 console.log('Thought message chunk received:', content);
//             }
//             else if (update.sessionUpdate === 'tool_call') {
//                 const toolName = update.title || update.toolName || update.tool || 'unknown';
//                 const toolCallId = update.toolCallId;
//                 const args = update.input || update.args || {};
//                 const status = update.status; 
                
//                 this.logger.info(`Tool call received: ${toolName}`, { toolCallId, args });
//                 this.emit('toolCall', {
//                     type: 'toolCall',
//                     name: toolName,
//                     args: args,
//                     toolCallId: toolCallId,
//                     status: status
//                 });
            
//             }
//             else if (update.sessionUpdate === 'tool_call_update') {
//             const toolCallId = update.toolCallId;
//             const status = update.status;  // 'in_progress', 'completed', 'failed'
//             const output = update.output;
//             const error = update.error;
//             const toolName = update.title || update.toolName || update.tool || 'unknown';
//             console.log(`Tool call update received: ${toolName} (ID: ${toolCallId}) - Status: ${status}`);
//             // 提取结果内容
//             let result = update.output || null;
            
//             // 发送 UI 事件：工具执行完成（无论是 VSCode 工具还是 Agent 工具）
//             if (status === 'completed') {
//                 this.emit('toolResult', {
//                     type: 'toolResult',
//                     toolCallId: toolCallId,
//                     name: toolName,  // 名称可以从之前存储的 toolCall 中获取
//                     result: result,
//                     error: null,
//                     status: status
//                 });
//             } else if (status === 'failed') {
//                 this.emit('toolResult', {
//                     type: 'toolResult',
//                     toolCallId: toolCallId,
//                     name: toolName,
//                     result: null,
//                     error: error || 'Tool execution failed',
//                     status: status
//                 });
//             }
//         }


            
//         }
//     }

//     // async sendPrompt(text: string): Promise<void> {
//     //     if (!this.client || !this.sessionInfo) {
//     //         throw new Error('Agent not ready');
//     //     }

//     //     this.logger.info('Sending prompt:', text);
//     //     // 确保有活动任务
//     //     if (!this.currentTaskId) {
//     //         this.startNewTask();
//     //     }
//     //     await this.client.request('session/prompt', {
//     //         sessionId: this.sessionInfo.id,
//     //         prompt: [{ type: 'text', text }]
//     //     });
//     // }

//     // AgentManager.ts
//     async sendPrompt(text: string): Promise<void> {
//         if (!this.client || !this.sessionInfo) {
//             throw new Error('Agent not ready');
//         }

//         this.logger.info('Sending prompt:', text);
//         if (!this.currentTaskId) {
//             this.startNewTask();
//         }
        
//         // ✅ 获取当前聊天会话ID
//         const currentSessionId = this.chatHistory?.getCurrentSessionId() || 'default-session';
//         if (!currentSessionId) {
//             throw new Error('No active chat session');
//         }
        
//         // ✅ 在请求中传递会话ID
//         await this.client.request('session/prompt', {
//             sessionId: currentSessionId,
//             prompt: [{ type: 'text', text }],
//         });
//     }


//     /**
//      * 停止 Agent（扩展）
//      */
//     stop(): void {

//         this.doStop();
//     }

//     private doStop(): void {
//         // 结束当前任务
//         this.endTask();
//         if (this.client) {
//             this.client.stop();
//             this.client = null;
//             this.sessionInfo = null;
//         }
//         // 停止 MCP Server
//         if (this.toolManager) {
//             this.toolManager.stop();
//             this.toolManager = null;
//         }
//         this.currentTaskId = null;
        
    
//     }


//     isRunning(): boolean {
//         return this.client?.isRunning() ?? false;
//     }

//     getSessionId(): string | null {
//         return this.sessionInfo?.id ?? null;
//     }

//     on<K extends keyof AgentEventMap>(event: K, listener: (event: AgentEventMap[K]) => void): void {
//         if (!this.eventListeners.has(event)) {
//             this.eventListeners.set(event, new Set());
//         }
//         this.eventListeners.get(event)!.add(listener);
//     }

//     // 添加 off 方法
//     off<K extends keyof AgentEventMap>(event: K, listener: (event: AgentEventMap[K]) => void): void {
//         const listeners = this.eventListeners.get(event);
//         if (listeners) {
//             listeners.delete(listener);
//             if (listeners.size === 0) {
//                 this.eventListeners.delete(event);
//             }
//         }
//     }

//     private emit<K extends keyof AgentEventMap>(event: K, data: AgentEventMap[K]): void {
//         const listeners = this.eventListeners.get(event);
//         if (listeners) {
//             listeners.forEach(listener => listener(data));
//         }
//     }
// }

// interface AgentEventMap {
//     ready: { type: 'ready'; sessionId: string };
//     stopped: { type: 'stopped'; code?: number };
//     error: { type: 'error'; error: Error };
//     messageChunk: { type: 'messageChunk'; content: string };
//     toolCall: { type: 'toolCall'; name: string; args: any; toolCallId?: string; status?: string };
//     toolResult: { type: 'toolResult'; name: string; result: any; error?: string | null; toolCallId?: string; status?: string };
//     toolProgress: { type: 'toolProgress'; name: string; progress: string };
//     messageEnd: { type: 'messageEnd'; fullContent: string };
//     thoughtChunk: { type: 'thoughtChunk'; content: string };
//     toolApproved: { callId: string; toolName: string };
//     toolRejected: { callId: string; toolName: string };
//     toolApprovalRequest: { callId: string; toolName: string; args: any };
//     toolAutoApproved: { type: 'toolAutoApproved'; toolName: string; sessionId: string };
//     autoApproveEnabled: { type: 'autoApproveEnabled'; sessionId: string };
//     autoApproveDisabled: { type: 'autoApproveDisabled'; sessionId?: string };
//     taskStarted: { type: 'taskStarted'; taskId: string };
//      // ⭐ 文件变更事件（新增）
//     fileChanged: { type: 'fileChanged'; filePath: string; changeType: string; transactionId: string | null };
//     updateChanges: { type: 'updateChanges'; changes: any[] };
    
//     // ⭐ 备份/回滚事件（新增）
//     rollbackCompleted: { type: 'rollbackCompleted'; success: boolean; errors?: string[] };
//     commitCompleted: { type: 'commitCompleted'; changes: any[] };
//     changesCommitted: { type: 'changesCommitted'; transactionId: string | null; changes: any[] };
//     changesRolledBack: { type: 'changesRolledBack'; transactionId: string | null };
   
    
// }



































import * as vscode from 'vscode';
import { AgentClient } from './AgentClient';
import { Configuration } from '../config/Configuration';
import { Logger } from '../utils/logger';
import type { SessionInfo, AgentEvent } from './types';
import { ToolManager } from '../tools';
import { FileBackupManager } from '../tools/FileBackupManager';
import { ChatHistory } from '../storage/ChatHistory';

import * as path from 'path';

export class AgentManager {
    private client: AgentClient | null = null;
    private sessionInfo: SessionInfo | null = null;
    private eventListeners: Map<string, Set<Function>> = new Map();
    private logger: Logger;
    private toolManager: ToolManager | null = null;
    private isStarting = false;
    private currentTaskId: string | null = null;
    private backupManager: FileBackupManager | null = null;
    private chatHistory: ChatHistory | null = null;
    private currentSessionId: string | null = null; // 当前活跃的会话ID

    constructor(private configuration: Configuration, chatHistory: ChatHistory) {
        this.logger = new Logger('AgentManager');
        this.chatHistory = chatHistory;
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
            // 初始化备份管理器
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                this.backupManager = new FileBackupManager(workspaceRoot);
                this.setupBackupManagerListeners();
            }

            // 确保旧的 MCP Server 已停止
            await this.stopMcpServer();
            
            // 创建新的 MCP Server
            this.toolManager = new ToolManager(9876, this.backupManager);
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
            
            // 开始一个新的审批会话（任务）
            this.startNewTask();

        } catch (error) {
            this.logger.error('Failed to start agent:', error);
            throw error;
        } finally {
            this.isStarting = false;
        }
    }

    /**
     * ⭐ 加载指定会话
     */
    // AgentManager.ts

/**
 * ⭐ 加载指定会话（修复版）
 */
// AgentManager.ts

/**
 * ⭐ 加载指定会话（修复版）
 */
async loadSession(sessionId: string): Promise<any> {
    if (!this.client || !this.sessionInfo) {
        throw new Error('Agent not ready');
    }

    this.logger.info(`Loading session: ${sessionId}`);
    
    try {
        // ⭐ 关键：必须包含 cwd 和 mcpServers 参数
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const mcpServerUrl = `http://localhost:${this.toolManager?.getPort()}`;
        
        // 构建 mcpServers 参数（与 session/new 保持一致）
        const mcpServers = [{
            name: 'vscode-local-tools',
            type: 'sse',
            url: mcpServerUrl,
            headers: [],
            command: '',
            args: [],
            env: []
        }];
        
        // 发送 session/load 请求，包含必需参数
        const result = await this.client.request('session/load', {
            sessionId: sessionId,
            cwd: cwd,                      // ⭐ 必需参数
            mcpServers: mcpServers,        // ⭐ 必需参数
            // additionalDirectories: []   // 可选
        });

        this.logger.info(`Session loaded successfully: ${sessionId}`, result);
        
        this.currentSessionId = sessionId;
        
        this.emit('sessionLoaded', {
            type: 'sessionLoaded',
            sessionId: sessionId,
            messages: result?.messages || [],
            metadata: result?.metadata || {}
        });

        return result || { messages: [], metadata: {} };
        
    } catch (error) {
        this.logger.error(`Failed to load session ${sessionId}:`, error);
        // 如果加载失败，返回空结果
        return { messages: [], metadata: {} };
    }
}


    /**
     * ⭐ 加载所有会话列表
     */
    async loadAllSessions(): Promise<SessionInfo[]> {
        if (!this.client || !this.sessionInfo) {
            this.logger.warn('Agent not ready, returning empty sessions list');
            return []; // 返回空数组而不是抛出错误
        }

        this.logger.info('Loading all sessions...');
        
        try {
            // 发送 session/list 请求到 ACP 服务器
            const result = await this.client.request('session/list', {
                limit: 100,
                offset: 0
            });

            const sessions = result?.sessions || [];
            this.logger.info(`Loaded ${sessions.length} sessions`);
            
            // 触发会话列表更新事件
            this.emit('sessionsListUpdated', {
                type: 'sessionsListUpdated',
                sessions: sessions
            });

            return sessions;
            
        } catch (error) {
            this.logger.error('Failed to load sessions list:', error);
            // 返回空数组而不是抛出错误，避免中断流程
            return [];
        }
    }

    /**
     * ⭐ 获取当前会话ID
     */
    getCurrentSessionId(): string | null {
        return this.currentSessionId || this.sessionInfo?.id || null;
    }

    /**
     * ⭐ 创建新会话
     */
    async createNewSession(): Promise<string> {
        if (!this.client || !this.sessionInfo) {
            // 如果 Agent 未就绪，返回一个临时 ID
            this.logger.warn('Agent not ready, creating temporary session ID');
            const tempId = `temp-${Date.now()}`;
            this.currentSessionId = tempId;
            return tempId;
        }

        this.logger.info('Creating new session...');
        
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const mcpServerUrl = `http://localhost:${this.toolManager?.getPort()}`;
            
            const result = await this.client.request('session/new', {
                cwd: cwd,
                mcpServers: [{
                    name: 'vscode-local-tools',
                    type: 'sse',
                    url: mcpServerUrl,
                    headers: [],
                    command: '',
                    args: [],
                    env: []
                }]
            });

            const newSessionId = result?.sessionId || `session-${Date.now()}`;
            this.currentSessionId = newSessionId;
            this.sessionInfo = {
                id: newSessionId,
                cwd: cwd,
                createdAt: new Date()
            };

            this.logger.info(`New session created: ${newSessionId}`);
            
            this.emit('sessionCreated', {
                type: 'sessionCreated',
                sessionId: newSessionId
            });

            return newSessionId;
            
        } catch (error) {
            this.logger.error('Failed to create new session:', error);
            // 返回临时 ID 以便继续工作
            const tempId = `temp-${Date.now()}`;
            this.currentSessionId = tempId;
            return tempId;
        }
    }

    /**
     * ⭐ 删除会话
     */
    async deleteSession(sessionId: string): Promise<void> {
        if (!this.client || !this.sessionInfo) {
            this.logger.warn('Agent not ready, skipping session deletion');
            return;
        }

        this.logger.info(`Deleting session: ${sessionId}`);
        
        try {
            await this.client.request('session/delete', {
                sessionId: sessionId
            });

            this.logger.info(`Session ${sessionId} deleted`);
            
            if (this.currentSessionId === sessionId) {
                this.currentSessionId = null;
            }

            this.emit('sessionDeleted', {
                type: 'sessionDeleted',
                sessionId: sessionId
            });

        } catch (error) {
            this.logger.error(`Failed to delete session ${sessionId}:`, error);
            // 不抛出错误，只记录
        }
    }

    /**
     * ⭐ 切换会话
     */
    // AgentManager.ts

    /**
     * ⭐ 切换会话（修复版）
     */
    async switchSession(sessionId: string): Promise<void> {
        if (!this.client || !this.sessionInfo) {
            this.logger.warn('Agent not ready, switching session locally');
            this.currentSessionId = sessionId;
            this.emit('sessionSwitched', {
                type: 'sessionSwitched',
                sessionId: sessionId
            });
            return;
        }

        this.logger.info(`Switching to session: ${sessionId}`);
        
        try {
            // ⭐ 使用修复后的 loadSession 方法
            await this.loadSession(sessionId);
            this.currentSessionId = sessionId;
            
            this.emit('sessionSwitched', {
                type: 'sessionSwitched',
                sessionId: sessionId,
            });
            
        } catch (error) {
            this.logger.error(`Failed to switch to session ${sessionId}:`, error);
            // 即使失败也更新本地状态
            this.currentSessionId = sessionId;
        }
    }

    /**
     * ⭐ 获取会话历史消息
     */
    async getSessionMessages(sessionId: string): Promise<any[]> {
        if (!this.client || !this.sessionInfo) {
            this.logger.warn('Agent not ready, returning empty messages');
            return [];
        }

        this.logger.info(`Getting messages for session: ${sessionId}`);
        
        try {
            const result = await this.client.request('session/messages', {
                sessionId: sessionId,
                limit: 1000,
                offset: 0
            });

            return result?.messages || [];
            
        } catch (error) {
            this.logger.error(`Failed to get messages for session ${sessionId}:`, error);
            return [];
        }
}

    // ========== 原有的方法 ==========

    async getPendingChanges(): Promise<any[]> {
        if (!this.backupManager) {
            return [];
        }

        const changes = await this.backupManager.getChangesWithoutEvent();
        return changes
            .filter(c => c.type !== 'unchanged')
            .map(c => ({
                filePath: c.filePath,
                type: c.type,
                status: 'pending',
                description: c.type === 'created' ? '创建新文件' :
                            c.type === 'modified' ? '修改文件' :
                            '删除文件'
            }));
    }

    private async sendPendingChangesToUI(): Promise<void> {
        const changes = await this.getPendingChanges();
        this.emit('updateChanges', {
            type: 'updateChanges',
            changes: changes
        });
        this.logger.info(`Sent ${changes.length} pending changes to UI`);
    }

    private setupBackupManagerListeners(): void {
        if (!this.backupManager) return;

        this.backupManager.on('fileChanged', (data) => {
            this.logger.info(`File changed detected: ${data.filePath}`);
            
            const changes = data.allChanges
                .filter((c: any) => c.type !== 'unchanged')
                .map((c: any) => ({
                    filePath: c.filePath,
                    type: c.type,
                    status: 'pending',
                    description: c.type === 'created' ? '创建新文件' :
                                c.type === 'modified' ? '修改文件' :
                                '删除文件'
                }));
            
            this.emit('updateChanges', {
                type: 'updateChanges',
                changes: changes
            });
        });

        this.backupManager.on('rollbackCompleted', (data) => {
            this.logger.info(`Rollback completed: ${data.success}`);
            this.emit('rollbackCompleted', {
                type: 'rollbackCompleted',
                success: data.success,
                errors: data.errors
            });
            this.emit('changesRolledBack', {
                type: 'changesRolledBack',
                transactionId: this.currentTaskId || null
            });
            this.sendPendingChangesToUI();
        });

        this.backupManager.on('commitCompleted', (data) => {
            this.logger.info(`Commit completed: ${data.changes.length} changes`);
            this.emit('commitCompleted', {
                type: 'commitCompleted',
                changes: data.changes
            });
            this.emit('changesCommitted', {
                type: 'changesCommitted',
                transactionId: this.currentTaskId || null,
                changes: data.changes
            });
            this.sendPendingChangesToUI();
        });

        this.backupManager.on('fileBackedUp', (data) => {
            this.logger.info(`File backed up: ${data.filePath}`);
            setTimeout(() => {
                this.sendPendingChangesToUI();
            }, 100);
        });
    }

    async rollbackChanges(): Promise<void> {
        if (!this.backupManager) {
            vscode.window.showWarningMessage('没有活跃的备份');
            return;
        }

        const result = await this.backupManager.rollbackAll();
        if (result.success) {
            vscode.window.showInformationMessage('✅ 已回滚所有修改');
            this.emit('rollbackCompleted', {
                type: 'rollbackCompleted',
                success: true
            });
            this.emit('changesRolledBack', {
                type: 'changesRolledBack',
                transactionId: this.currentTaskId || null
            });
        } else {
            vscode.window.showErrorMessage(`回滚失败: ${result.errors?.join(', ') || '未知错误'}`);
            this.emit('rollbackCompleted', {
                type: 'rollbackCompleted',
                success: false,
                errors: result.errors
            });
        }
    }

    commitChanges(): void {
        if (!this.backupManager) {
            vscode.window.showWarningMessage('没有活跃的备份');
            return;
        }

        const stats = this.backupManager.getStats();
        if (stats.total === 0) {
            vscode.window.showInformationMessage('没有需要提交的修改');
            return;
        }

        this.backupManager.commitAll();
        vscode.window.showInformationMessage(`✅ 已提交 ${stats.total} 个文件的修改`);
    }

    async showFileDiff(filePath: string): Promise<void> {
        if (!this.backupManager) {
            vscode.window.showWarningMessage('没有备份管理器');
            return;
        }

        const backup = this.backupManager.getBackup(filePath);
        if (!backup) {
            vscode.window.showWarningMessage(`文件 ${filePath} 没有备份，无法查看差分`);
            return;
        }

        let currentContent = '';
        let fileExists = true;
        try {
            const uri = vscode.Uri.file(filePath);
            const data = await vscode.workspace.fs.readFile(uri);
            currentContent = Buffer.from(data).toString('utf8');
        } catch (error) {
            fileExists = false;
            currentContent = '';
        }

        const originalContent = backup.originalContent.toString('utf8');

        if (!fileExists && backup.isNewFile) {
            vscode.window.showWarningMessage(`文件 ${path.basename(filePath)} 已被删除`);
        }

        const originalUri = vscode.Uri.parse(
            `memfs:/original-${Date.now()}/${path.basename(filePath)}`
        );

        const currentUri = vscode.Uri.file(filePath);

        const provider = new (class implements vscode.TextDocumentContentProvider {
            onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
            onDidChange = this.onDidChangeEmitter.event;

            provideTextDocumentContent(uri: vscode.Uri): string {
                return originalContent;
            }
        })();

        const providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
            'memfs', 
            provider
        );

        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalUri,
                currentUri,
                `📊 ${path.basename(filePath)} (原始 ↔ 当前)`,
                { preview: true }
            );
        } catch (error) {
            vscode.window.showErrorMessage(`打开差分失败: ${error}`);
        } finally {
            setTimeout(() => {
                providerRegistration.dispose();
            }, 5000);
        }
    }

    private startNewTask(): void {
        if (this.toolManager) {
            this.currentTaskId = this.toolManager.getApprovalManager().startNewSession();
            this.logger.info(`Started new task session: ${this.currentTaskId}`);
            this.emit('taskStarted', { 
                type: 'taskStarted', 
                taskId: this.currentTaskId 
            });
        }
    }

    private endTask(): void {
        if (this.toolManager) {
            this.toolManager.getApprovalManager().endSession();
            this.logger.info(`Ended task session: ${this.currentTaskId}`);
            this.currentTaskId = null;
        }
    }

    getCurrentTaskId(): string | null {
        return this.currentTaskId;
    }

    getApprovalStatus(): { autoApprove: boolean; approvedTools: string[] } | null {
        if (!this.toolManager) return null;
        const sessionInfo = this.toolManager.getApprovalManager().getSessionInfo();
        if (!sessionInfo) return null;
        return {
            autoApprove: sessionInfo.autoApprove,
            approvedTools: sessionInfo.approvedTools
        };
    }

    disableAutoApprove(): void {
        if (this.toolManager) {
            this.toolManager.getApprovalManager().disableAutoApprove();
            this.emit('autoApproveDisabled', { type: 'autoApproveDisabled' });
            vscode.window.showInformationMessage('Auto-approval disabled for current task');
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
            this.endTask();
        });

        this.client.on('notification', (notification) => {
            this.handleNotification(notification);
        });

        if (this.toolManager) {
            const approvalManager = this.toolManager.getApprovalManager();
            approvalManager.on('approved', (data) => {
                this.emit('toolApproved', { callId: data.callId, toolName: data.toolName });
            });
            approvalManager.on('rejected', (data) => {
                this.emit('toolRejected', { callId: data.callId, toolName: data.toolName });
            });
            approvalManager.on('autoApproved', (data) => {
                this.emit('toolAutoApproved', {
                    type: 'toolAutoApproved',
                    toolName: data.toolName,
                    sessionId: data.sessionId
                });
            });

            approvalManager.on('autoApproveEnabled', (data) => {
                this.emit('autoApproveEnabled', {
                    type: 'autoApproveEnabled',
                    sessionId: data.sessionId
                });
                vscode.window.showInformationMessage(
                    `✅ Auto-approval enabled for this task`
                );
            });

            approvalManager.on('autoApproveDisabled', (data) => {
                this.emit('autoApproveDisabled', {
                    type: 'autoApproveDisabled',
                    sessionId: data.sessionId
                });
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

            const mcpServerUrl = `http://localhost:${this.toolManager?.getPort()}`;
            
            this.logger.info('Creating session with MCP server URL:', mcpServerUrl);
            
            // 创建初始会话
            const sessionResult = await this.client.request('session/new', {
                cwd: cwd,
                mcpServers: [{
                    name: 'vscode-local-tools',
                    type: 'sse',
                    url: mcpServerUrl,
                    headers: [],
                    command: '',
                    args: [],
                    env: []
                }]
            });

            this.sessionInfo = {
                id: sessionResult.sessionId,
                cwd,
                createdAt: new Date()
            };
            
            // 设置当前会话ID
            this.currentSessionId = sessionResult.sessionId;

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
                const content = update.content?.text || '';
                this.emit('thoughtChunk', { type: 'thoughtChunk', content });
                console.log('Thought chunk received:', content);
            }
            else if (update.sessionUpdate === 'thought_message_chunk') {
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
                const status = update.status;
                const output = update.output;
                const error = update.error;
                const toolName = update.title || update.toolName || update.tool || 'unknown';
                console.log(`Tool call update received: ${toolName} (ID: ${toolCallId}) - Status: ${status}`);
                
                if (status === 'completed') {
                    this.emit('toolResult', {
                        type: 'toolResult',
                        toolCallId: toolCallId,
                        name: toolName,
                        result: output,
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
        if (!this.currentTaskId) {
            this.startNewTask();
        }
        
        // 使用当前会话ID
        const sessionId = this.currentSessionId || this.sessionInfo.id;
        if (!sessionId) {
            throw new Error('No active session');
        }
        
        await this.client.request('session/prompt', {
            sessionId: sessionId,
            prompt: [{ type: 'text', text }],
        });
    }

    stop(): void {
        this.doStop();
    }

    private doStop(): void {
        this.endTask();
        if (this.client) {
            this.client.stop();
            this.client = null;
            this.sessionInfo = null;
        }
        if (this.toolManager) {
            this.toolManager.stop();
            this.toolManager = null;
        }
        this.currentTaskId = null;
        this.currentSessionId = null;
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
    toolAutoApproved: { type: 'toolAutoApproved'; toolName: string; sessionId: string };
    autoApproveEnabled: { type: 'autoApproveEnabled'; sessionId: string };
    autoApproveDisabled: { type: 'autoApproveDisabled'; sessionId?: string };
    taskStarted: { type: 'taskStarted'; taskId: string };
    fileChanged: { type: 'fileChanged'; filePath: string; changeType: string; transactionId: string | null };
    updateChanges: { type: 'updateChanges'; changes: any[] };
    rollbackCompleted: { type: 'rollbackCompleted'; success: boolean; errors?: string[] };
    commitCompleted: { type: 'commitCompleted'; changes: any[] };
    changesCommitted: { type: 'changesCommitted'; transactionId: string | null; changes: any[] };
    changesRolledBack: { type: 'changesRolledBack'; transactionId: string | null };
    
    // ⭐ 新增的会话管理事件
    sessionLoaded: { type: 'sessionLoaded'; sessionId: string; messages: any[]; metadata: any };
    sessionCreated: { type: 'sessionCreated'; sessionId: string };
    sessionDeleted: { type: 'sessionDeleted'; sessionId: string };
    sessionSwitched: { type: 'sessionSwitched'; sessionId: string };
    sessionsListUpdated: { type: 'sessionsListUpdated'; sessions: SessionInfo[] };
    messagesRestored: { type: 'messagesRestored'; sessionId: string; messages: any[] };
}