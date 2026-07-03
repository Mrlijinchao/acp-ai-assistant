import * as vscode from 'vscode';
import { AgentManager } from '../agent/AgentManager';
import { ChatHistory } from '../storage/ChatHistory';
import { ChatSession } from '../storage/SessionManager';



export class ChatViewProvider implements vscode.WebviewViewProvider {
    private webviewView?: vscode.WebviewView;
    private messageBuffer = '';
    private cachedHtml: string | null = null;
    private isWebviewReady = false;
    private pendingMessages: Array<{ type: string; data: any }> = [];
    private currentSessionId: string | null = null;
    private reloadHistoryFlg = false
    private count = 0;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agentManager: AgentManager,
        private readonly chatHistory: ChatHistory
    ) {}

    //  resolveWebviewView(webviewView: vscode.WebviewView): void {
    //     this.webviewView = webviewView;
        
    //     webviewView.webview.options = {
    //         enableScripts: true,
    //         localResourceRoots: [this.extensionUri]
    //     };

    //     // 使用缓存的 HTML，并替换 JS 路径
    //     let html = this.cachedHtml || this.getFallbackHtml();
        
    //     // 替换 JS 脚本路径
    //     const jsUri = webviewView.webview.asWebviewUri(
    //         vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.js')
    //     );
    //     html = html.replace(
    //         '<script src="chat-view.js"></script>',
    //         `<script src="${jsUri}"></script>`
    //     );
        
    //     webviewView.webview.html = html;
        
    //     this.setupMessageHandler();
    //     this.setupAgentEventListeners();
    //     this.loadChatHistory();
    // }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.webviewView = webviewView;
        this.isWebviewReady = false;
        this.pendingMessages = [];
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        // 监听 webview 的可见性变化
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                console.log('Webview became visible, reloading history...');
                this.reloadAll();
            }
        });

        let html = this.cachedHtml || this.getFallbackHtml();
        
        // const jsPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.js');
        // const jsUri = webviewView.webview.asWebviewUri(jsPath);
        
        // html = html.replace(
        //     '<script src="chat-view.js"></script>',
        //     `<script src="${jsUri}"></script>`
        // );

         // ⭐ 不需要特殊处理 JS 路径，因为 HTML 中已经是相对路径
        // 但为了确保正确，最好还是使用 asWebviewUri
        const jsPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'js', 'main.js');
        const jsUri = webviewView.webview.asWebviewUri(jsPath);
        
        // 替换 main.js 的路径
        html = html.replace(
            'js/main.js',
            jsUri.toString()
        );
        
        webviewView.webview.html = html;
        
        this.setupMessageHandler();
        this.setupAgentEventListeners();
        // this.loadChatHistory();

        this.handleWebviewReady()
        console.log("========================resolveWebviewView: ")
    }

    // 修改 webviewReady 处理
    private async handleWebviewReady(): Promise<void> {
        console.log("========================handleWebviewReady: ")
        this.isWebviewReady = true;
        for (const pending of this.pendingMessages) {
            this.sendToWebview(pending.type, pending.data);
        }
        this.pendingMessages = [];
        this.sendAgentStatus();
        this.sendCurrentSession();
        await this.loadSessions();
        await this.loadChatHistory();
        
        // 发送待确认修改
        this.sendPendingChanges();
    }

    private async reloadAll(): Promise<void> {
        // 重新加载会话列表
        await this.loadSessions();
        
        // 加载当前会话的消息
        await this.loadChatHistory();
        
        // 重新发送 agent 状态
        this.sendAgentStatus();
        
        // 发送当前会话ID
        this.sendCurrentSession();
    }

    private async reloadChatHistory(): Promise<void> {
        // 清空当前显示的消息
        this.sendToWebview('clearMessages', {});
        await this.loadChatHistory();
        this.reloadHistoryFlg = true;
        // 重新发送 agent 状态
        this.sendAgentStatus();
    }

    private setupMessageHandler(): void {
        this.webviewView?.webview.onDidReceiveMessage(async (message) => {
            console.log('Received message from webview:', message); // 添加日志
            switch (message.type) {
                case 'sendMessage':
                    await this.handleUserMessage(message.text);
                    break;
                case 'startAgent':
                    await this.agentManager.start(message.agentName);
                    break;
                case 'stopAgent':
                    this.agentManager.stop();
                    break;
                case 'clearHistory':
                    await this.chatHistory.clear();
                    this.sendToWebview('clearMessages', {});
                    break;
                case 'webviewReady':
                    this.isWebviewReady = true;
                    // 发送所有待处理的消息
                    for (const pending of this.pendingMessages) {
                        this.sendToWebview(pending.type, pending.data);
                    }
                    this.pendingMessages = [];
                    this.sendAgentStatus();
                    this.sendCurrentSession();
                    await this.loadSessions();
                    break;
                case 'createSession':
                    console.log('Creating session with name:', message.name);
                    await this.handleCreateSession(message.name);
                    break;
                case 'switchSession':
                    console.log('Switching to session:', message.sessionId);
                    await this.handleSwitchSession(message.sessionId);
                    break;
                case 'deleteSession':
                    console.log('🗑️ Delete session request:', message.sessionId);
                    // 先显示确认对话框
                    const confirmResult = await vscode.window.showWarningMessage(
                        `确定要删除会话 "${message.sessionName || '未命名'}" 吗？`,
                        { modal: true },
                        '确定删除',
                        '取消'
                    );
                    
                    if (confirmResult === '确定删除') {
                        console.log('🗑️ User confirmed delete:', message.sessionId);
                        await this.handleDeleteSession(message.sessionId);
                    } else {
                        console.log('❌ User cancelled delete');
                    }
                    break;
                case 'renameSession':
                    console.log('Renaming session:', message.sessionId, 'to', message.newName);
                    await this.handleRenameSession(message.sessionId, message.newName);
                    break;
                // ⭐ 获取待确认修改
                case 'getPendingChanges':
                    this.sendPendingChanges();
                    break;

                // ⭐ 提交所有修改
                case 'commitAllChanges':
                    await this.agentManager.commitChanges();
                    break;

                // ⭐ 回滚所有修改
                case 'rollbackAllChanges':
                    await this.agentManager.rollbackChanges();
                    break;

                // ⭐ 接受单个修改
                case 'acceptSingleChange':
                    // 目前只支持全部提交，可以扩展
                    await this.agentManager.commitChanges();
                    break;

                // ⭐ 拒绝单个修改
                case 'rejectSingleChange':
                    // 目前只支持全部回滚，可以扩展
                    await this.agentManager.rollbackChanges();
                    break;

                // ⭐ 查看文件差分
                case 'showFileDiff':
                    // 打开差分预览
                    // vscode.window.showInformationMessage(`📊 查看文件差异: ${message.filePath}`);
                    await this.agentManager.showFileDiff(message.filePath);
                    break;
                
            }
        });
    }

    private async handleCreateSession(name?: string): Promise<void> {
        try {
            // 自动生成名称，不需要用户输入
            const sessions = await this.chatHistory.getSessions();
            const defaultName = `Chat ${sessions.length + 1}`;
            const session = await this.chatHistory.createSession(defaultName);
            this.currentSessionId = session.id;
            
            console.log('✅ Session created:', session.id, session.name);
            
            // 清空消息
            this.sendToWebview('clearMessages', {});
            this.messageBuffer = '';
            
            // 更新会话列表
            await this.loadSessions();
            
            // 发送当前会话ID
            this.sendCurrentSession();
            
            // 通知 webview 会话已创建
            this.sendToWebview('sessionCreated', {
                session: this.formatSessionForWebview(session)
            });
            
        } catch (error) {
            console.error('Failed to create session:', error);
            vscode.window.showErrorMessage('Failed to create new session');
        }
    }

    private async handleSwitchSession(sessionId: string): Promise<void> {
        try {
            const session = await this.chatHistory.switchSession(sessionId);
            if (session) {
                this.currentSessionId = sessionId;
                
                console.log('Switched to session:', session.name);
                
                // 清空消息
                this.sendToWebview('clearMessages', {});
                this.messageBuffer = '';
                
                // 加载会话消息
                await this.loadSessionMessages(sessionId);
                
                // 更新会话列表
                await this.loadSessions();
                
                // 发送当前会话ID
                this.sendCurrentSession();
            }
        } catch (error) {
            console.error('Failed to switch session:', error);
            vscode.window.showErrorMessage('Failed to switch session');
        }
    }

    private async handleDeleteSession(sessionId: string): Promise<void> {
        try {
            console.log('🗑️ Deleting session:', sessionId);
            const success = await this.chatHistory.deleteSession(sessionId);
            
            if (success) {
                // 如果删除的是当前会话
                if (this.currentSessionId === sessionId) {
                    this.currentSessionId = null;
                    this.sendToWebview('clearMessages', {});
                    this.messageBuffer = '';
                }
                
                // 更新会话列表
                await this.loadSessions();
                
                // 获取最新会话列表
                const sessions = await this.chatHistory.getSessions();
                
                if (sessions.length > 0 && !this.currentSessionId) {
                    // 自动切换到第一个会话
                    const firstSession = sessions[0];
                    this.currentSessionId = firstSession.id;
                    await this.chatHistory.switchSession(firstSession.id);
                    await this.loadSessionMessages(firstSession.id);
                    this.sendCurrentSession();
                } else if (sessions.length === 0) {
                    // 没有会话了，创建一个新会话
                    await this.handleCreateSession('新会话');
                }
                
                // 重新加载会话列表
                await this.loadSessions();
            }
        } catch (error) {
            console.error('Failed to delete session:', error);
            vscode.window.showErrorMessage('删除会话失败');
        }
    }

    private async handleRenameSession(sessionId: string, newName: string): Promise<void> {
        const success = await this.chatHistory.renameSession(sessionId, newName);
        if (success) {
            await this.loadSessions();
        }
    }

    private async loadSessionMessages(sessionId: string): Promise<void> {
        const messages = await this.chatHistory.getSessionMessages(sessionId);
        for (const msg of messages) {
            this.sendToWebview('addMessage', {
                role: msg.role,
                content: msg.content
            });
        }
    }

        private async loadSessions(): Promise<void> {
        const sessions = await this.chatHistory.getSessions();
        console.log(`Sending ${sessions.length} sessions to webview`);
        this.sendToWebview('updateSessions', {
            sessions: sessions.map(s => this.formatSessionForWebview(s)),
            currentSessionId: this.currentSessionId || this.chatHistory.getCurrentSessionId()
        });
    }

    private async loadAllData(): Promise<void> {
        await this.loadSessions();
        await this.loadChatHistory();
        this.sendCurrentSession();
    }

    private sendCurrentSession(): void {
        const sessionId = this.currentSessionId || this.chatHistory.getCurrentSessionId();
        if (sessionId) {
            this.sendToWebview('currentSession', { sessionId });
        }
    }

    private formatSessionForWebview(session: ChatSession): any {
        return {
            id: session.id,
            name: session.name,
            messageCount: session.messages.length,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            isActive: session.isActive || false
        };
    }

    private setupAgentEventListeners(): void {
        this.agentManager.on('ready', (data) => {
            this.sendToWebview('agentReady', { sessionId: data.sessionId });
            this.sendToWebview('addMessage', {
                role: 'assistant',
                content: 'Agent is ready. How can I help you?'
            });
        });

        this.agentManager.on('stopped', () => {
            this.sendToWebview('agentStopped', {});
            this.messageBuffer = '';
        });

        // this.agentManager.on('messageChunk', (data) => {
        //     this.messageBuffer += data.content;
        //     this.sendToWebview('updateAssistantMessage', { content: this.messageBuffer });
        // });

        // this.agentManager.on('messageChunk', async (data) => {
        //     this.messageBuffer += data.content;
        //     this.sendToWebview('updateAssistantMessage', { content: this.messageBuffer });
        // });

        // 当消息完成时（通过 messageChunk 的 end 或者单独的事件）
        // 这里需要在 AgentManager 中添加一个 'messageEnd' 事件
        // 临时方案：在收到完整的工具结果后保存

        this.agentManager.on('error', (data) => {
            this.sendToWebview('addMessage', {
                role: 'system',
                content: `Error: ${data.error.message}`
            });
        });

        this.agentManager.on('toolCall', (data) => {
        this.sendToWebview('toolCall', { 
            callId: data.toolCallId,
            name: data.name, 
            args: data.args,
            status: data.status || 'executing' // 可以是 executing, completed, failed
        });
        });
        
        // 可以添加工具执行结果的监听
        this.agentManager.on('toolResult', (result) => {
            this.sendToWebview('toolResult', {
                callId: result.toolCallId,
                name: result.name,
                result: result.result,
                error: result.error ? result.error : null,
                status: result.status || 'completed'
            });
        });

         // 添加工具进度监听（可选）
        this.agentManager.on('toolProgress', (data) => {
            this.sendToWebview('toolProgress', {
                name: data.name,
                progress: data.progress
            });
        });

         // 添加思考过程监听
        this.agentManager.on('thoughtChunk', (data) => {
            this.sendToWebview('thoughtChunk', { content: data.content });
        });

        // 监听审批相关事件
        this.agentManager.on('autoApproveEnabled', (data) => {
            // 发送到 webview，不添加到消息流
            this.sendToWebview('autoApproveEnabled', { 
                sessionId: data.sessionId 
            });
        });

        this.agentManager.on('autoApproveDisabled', (data) => {
            this.sendToWebview('autoApproveDisabled', {});
        });

        this.agentManager.on('toolAutoApproved', (data) => {
            // 发送工具自动批准事件，显示在工具调用位置
            this.sendToWebview('toolAutoApproved', {
                toolName: data.toolName,
                sessionId: data.sessionId
            });
        });

        this.agentManager.on('taskStarted', (data) => {
            this.sendToWebview('taskStarted', {
                taskId: data.taskId
            });
        });

        // ⭐ 监听 rollbackCompleted
        this.agentManager.on('rollbackCompleted', (data) => {
            if (data.success) {
                this.sendToWebview('changesRolledBack', {
                    message: '所有修改已回滚'
                });
            }
            this.sendPendingChanges();
        });

        // ⭐ 监听 commitCompleted
        this.agentManager.on('commitCompleted', (data) => {
            this.sendToWebview('changesCommitted', {
                changes: data.changes
            });
            this.sendPendingChanges();
        });

        // ⭐ 监听 changesRolledBack（兼容）
        this.agentManager.on('changesRolledBack', (data) => {
            this.sendToWebview('changesRolledBack', {
                transactionId: data.transactionId
            });
            this.sendPendingChanges();
        });

        // ⭐ 监听 changesCommitted（兼容）
        this.agentManager.on('changesCommitted', (data) => {
            this.sendToWebview('changesCommitted', {
                transactionId: data.transactionId,
                changes: data.changes
            });
            this.sendPendingChanges();
        });

        // ⭐ 监听文件变化
        this.agentManager.on('fileChanged', (data) => {
            this.sendPendingChanges();
        });

        // ⭐ 监听 updateChanges
        this.agentManager.on('updateChanges', (data) => {
            this.sendToWebview('updateChanges', {
                changes: data.changes
            });
        });


    }

    private async sendPendingChanges(): Promise<void> {
        const changes = await this.agentManager.getPendingChanges();
        this.sendToWebview('updateChanges', { changes });
    }


    // webview/ChatViewProvider.ts
    private async handleUserMessage(text: string): Promise<void> {
        // 保存用户消息
        await this.chatHistory.addMessage('user', text);
        this.sendToWebview('addMessage', { role: 'user', content: text });
        
        this.messageBuffer = '';
        this.sendToWebview('startAssistantMessage', {});
        
        let assistantResponse = '';

        let thoughtResponse = '';
        let thoughtDiv: any = null;
        
        const messageChunkListener = (data: { content: string }) => {
            assistantResponse += data.content;
            this.messageBuffer += data.content;
            this.sendToWebview('updateAssistantMessage', { content: this.messageBuffer });
        };

        // 添加思考块监听器
        const thoughtChunkListener = (data: { content: string }) => {
            thoughtResponse += data.content;
            // 实时发送思考过程到 UI
            this.sendToWebview('thoughtChunk', { 
                content: data.content,
                fullThought: thoughtResponse 
            });
        };
        
        this.agentManager.on('messageChunk', messageChunkListener);
        this.agentManager.on('thoughtChunk', thoughtChunkListener);
        
        try {
            // sendPrompt 的 Promise 会在整个响应完成后 resolve
            await this.agentManager.sendPrompt(text);
            
            // 此时 AI 回答已经完整接收
            if (assistantResponse.trim()) {
                await this.chatHistory.addMessage('assistant', assistantResponse);
                console.log(`✅ Saved assistant response: ${assistantResponse.length} chars`);
            }
            // 完成后刷新修改列表
            setTimeout(() => {
                this.sendPendingChanges();
            }, 500);
        } catch (error) {
            // 错误处理
        } finally {
            this.agentManager.off('messageChunk', messageChunkListener);
            this.agentManager.off('thoughtChunk', thoughtChunkListener);
        }
    }

    private async loadChatHistory(): Promise<void> {
        const history = await this.chatHistory.getMessages();
        for (const msg of history) {
            this.sendToWebview('addMessage', {
                role: msg.role,
                content: msg.content
            });
        }
    }

    private sendAgentStatus(): void {
        if (this.agentManager.isRunning()) {
            this.sendToWebview('agentReady', { sessionId: this.agentManager.getSessionId() });
        } else {
            this.sendToWebview('agentStopped', {});
        }
    }

    private sendToWebview(type: string, data: any): void {
        if (!this.isWebviewReady) {
            // 缓存消息，等待 webview 准备好
            this.pendingMessages.push({ type, data });
            return;
        }
        this.webviewView?.webview.postMessage({ type, ...data });
    }

    // async loadHtml(): Promise<void> {
    //     try {
    //         // 使用 VSCode API 异步读取文件
    //         const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.html');
    //         const jsPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.js');
            
    //         const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
    //         let html = Buffer.from(htmlContent).toString('utf-8');
            
    //         // 获取 JS 的 webview URI（这个在 resolveWebviewView 时才可用）
    //         // 所以这里先保存占位符
    //         this.cachedHtml = html;
            
    //         console.log('HTML loaded successfully');
    //     } catch (error) {
    //         console.error('Failed to load HTML:', error);
    //         this.cachedHtml = this.getFallbackHtml();
    //     }
    // }

    async loadHtml(): Promise<void> {
        try {
            const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.html');
            const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
            let html = Buffer.from(htmlContent).toString('utf-8');
            this.cachedHtml = html;
            console.log('HTML loaded successfully');
        } catch (error) {
            console.error('Failed to load HTML:', error);
            this.cachedHtml = this.getFallbackHtml();
        }
    }

    private getFallbackHtml(): string {
            return `<!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        background: var(--vscode-inputValidation-errorBackground);
                        padding: 10px;
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="error">
                    <strong>⚠️ Failed to load chat interface</strong><br>
                    Please check the extension installation.
                </div>
            </body>
            </html>`;
        }

}