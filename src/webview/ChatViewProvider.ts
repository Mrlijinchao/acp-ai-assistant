import * as vscode from 'vscode';
import { AgentManager } from '../agent/AgentManager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private webviewView?: vscode.WebviewView;
    private messageBuffer = '';
    private cachedHtml: string | null = null;
    private isWebviewReady = false;
    private pendingMessages: Array<{ type: string; data: any }> = [];
    private currentSessionId: string | null = null;
    private sessions: any[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly agentManager: AgentManager
    ) {}

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
                console.log('Webview became visible, reloading...');
                this.reloadAll();
            }
        });

        let html = this.cachedHtml || this.getFallbackHtml();

        const jsPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'js', 'main.js');
        const jsUri = webviewView.webview.asWebviewUri(jsPath);
        
        html = html.replace(
            'js/main.js',
            jsUri.toString()
        );
        
        webviewView.webview.html = html;
        
        this.setupMessageHandler();
        this.setupAgentEventListeners();
        this.handleWebviewReady();
        console.log("========================resolveWebviewView: ")
    }

    private async handleWebviewReady(): Promise<void> {
        console.log("========================handleWebviewReady: ")
        this.isWebviewReady = true;
        
        // 发送所有待处理消息
        for (const pending of this.pendingMessages) {
            this.sendToWebview(pending.type, pending.data);
        }
        this.pendingMessages = [];
        
        // 发送 Agent 状态
        this.sendAgentStatus();
        
        // // 加载会话列表
        // await this.loadSessions();
        
        // // 加载当前会话消息
        // await this.loadCurrentSessionMessages();
    }

    private async reloadAll(): Promise<void> {
        // 重新加载会话列表
        await this.loadSessions();
        
        // 加载当前会话的消息
        await this.loadCurrentSessionMessages();
        
        // 重新发送 agent 状态
        this.sendAgentStatus();
        
        // 发送当前会话ID
        this.sendCurrentSession();
    }

    private async loadCurrentSessionMessages(): Promise<void> {
        const sessionId = this.currentSessionId || await this.getDefaultSessionId();
        if (sessionId) {
            await this.loadSessionMessages(sessionId);
        }
    }

    private setupMessageHandler(): void {
        this.webviewView?.webview.onDidReceiveMessage(async (message) => {
            console.log('Received message from webview:', message);
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
                    // 清空当前会话消息
                    this.sendToWebview('clearMessages', {});
                    this.messageBuffer = '';
                    break;
                case 'webviewReady':
                    await this.handleWebviewReady();
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
                    const confirmResult = await vscode.window.showWarningMessage(
                        `确定要删除会话 "${message.sessionName || '未命名'}" 吗？`,
                        { modal: true },
                        '确定删除',
                        '取消'
                    );
                    
                    if (confirmResult === '确定删除') {
                        console.log('🗑️ User confirmed delete:', message.sessionId);
                        await this.handleDeleteSession(message.sessionId);
                    }
                    break;
                case 'renameSession':
                    console.log('Renaming session:', message.sessionId, 'to', message.newName);
                    await this.handleRenameSession(message.sessionId, message.newName);
                    break;
                case 'getPendingChanges':
                    await this.sendPendingChanges();
                    break;
                case 'commitAllChanges':
                    await this.agentManager.commitChanges();
                    break;
                case 'rollbackAllChanges':
                    await this.agentManager.rollbackChanges();
                    break;
                case 'acceptSingleChange':
                    await this.agentManager.commitChanges();
                    break;
                case 'rejectSingleChange':
                    await this.agentManager.rollbackChanges();
                    break;
                case 'showFileDiff':
                    await this.agentManager.showFileDiff(message.filePath);
                    break;
            }
        });
    }

    // ChatViewProvider.ts

    private async handleSwitchSession(sessionId: string): Promise<void> {
        try {
            this.sendToWebview('clearMessages', {});
            // AgentManager 的 switchSession 方法内部会调用 loadSession
            await this.agentManager.switchSession(sessionId);
            this.currentSessionId = sessionId;
            
            console.log('Switched to session:', sessionId);
            
            this.messageBuffer = '';
            
            // 会话消息会在 sessionLoaded 事件中自动加载
            // await this.loadSessions();
            this.sendCurrentSession();
            
        } catch (error) {
            console.error('Failed to switch session:', error);
            vscode.window.showErrorMessage('Failed to switch session');
        }
    }

    private async handleDeleteSession(sessionId: string): Promise<void> {
        try {
            console.log('🗑️ Deleting session:', sessionId);
            await this.agentManager.deleteSession(sessionId);
            
            // 如果删除的是当前会话
            if (this.currentSessionId === sessionId) {
                this.currentSessionId = null;
                this.sendToWebview('clearMessages', {});
                this.messageBuffer = '';
            }
            
            // 获取最新会话列表
            const sessions = await this.agentManager.loadAllSessions();
            
            if (sessions && sessions.length > 0 && !this.currentSessionId) {
                // 自动切换到第一个会话
                const firstSession = sessions[0];
                await this.handleSwitchSession(firstSession.sessionId);
            } else if (!sessions || sessions.length === 0) {
                // 没有会话了，创建一个新会话
                await this.handleCreateSession('新会话');
            }

            // 更新会话列表
            await this.loadSessions();
            
        } catch (error) {
            console.error('Failed to delete session:', error);
            vscode.window.showErrorMessage('删除会话失败');
        }
    }

    /**
     * ⭐ 处理重命名会话
     */
    private async handleRenameSession(sessionId: string, newName: string): Promise<void> {
        try {
            console.log(`🔄 Renaming session ${sessionId} to "${newName}"`);
            
            // 调用 AgentManager 的重命名方法
            await this.agentManager.renameSession(sessionId, newName);
            
            // 如果重命名的是当前会话，更新 currentSessionId
            if (this.currentSessionId === sessionId) {
                // 不需要更新 currentSessionId，因为 sessionId 没变
                // 但可以触发 UI 更新
            }
            
            // 会话列表会在 renameSession 中自动刷新
            // 但我们可以在这里显式刷新以确保 UI 更新
            await this.loadSessions();
            
        } catch (error) {
            console.error('Failed to rename session:', error);
            vscode.window.showErrorMessage(`重命名会话失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async loadSessionMessages(sessionId: string): Promise<void> {
        try {
            const messages = await this.agentManager.loadSession(sessionId);
            for (const msg of messages) {
                this.sendToWebview('addMessage', {
                    role: msg.role || 'assistant',
                    content: msg.content || msg.text || ''
                });
            }
            console.log(`Loaded ${messages.length} messages for session ${sessionId}`);
        } catch (error) {
            console.error('Failed to load session messages:', error);
        }
    }

    private async loadSessions(): Promise<void> {
        try {
            const sessions = await this.agentManager.loadAllSessions();
            // 确保 sessions 是数组
            
            this.sessions = Array.isArray(sessions) ? sessions : [];
            
            console.log(`Sending ${this.sessions.length} sessions to webview`);
            this.sendToWebview('updateSessions', {
                sessions: this.sessions.map(s => ({
                    id: s.sessionId || `session-${Date.now()}`,
                    name: s.title || `Chat ${this.sessions.indexOf(s) + 1}`,
                    messageCount: s.messageCount || 0,
                    createdAt: s.createdAt || new Date().toISOString(),
                    updatedAt: s.updatedAt || new Date().toISOString(),
                    isActive: s.id === this.currentSessionId
                })),
                currentSessionId: this.currentSessionId
            });
        } catch (error) {
            console.error('Failed to load sessions:', error);
            // 发送空列表
            this.sendToWebview('updateSessions', {
                sessions: [],
                currentSessionId: null
            });
        }
    }

    private async getDefaultSessionId(): Promise<string | null> {
        try {
            const sessions = await this.agentManager.loadAllSessions();
            if (sessions && sessions.length > 0) {
                return sessions[0].id;
            }
            return null;
        } catch (error) {
            console.error('Failed to get default session:', error);
            return null;
        }
    }

    private async handleCreateSession(name?: string): Promise<void> {

            // 先检查当前是否有会话
            const sessions = await this.agentManager.loadAllSessions();
            const sessionCount = Array.isArray(sessions) ? sessions.length : 0;
            const defaultName = name || `Chat ${sessionCount + 1}`;
            
            const newSessionId = await this.agentManager.createNewSession();
            if (newSessionId) {
                this.currentSessionId = newSessionId;
                console.log('✅ Session created:', newSessionId);
                
                this.sendToWebview('clearMessages', {});
                this.messageBuffer = '';
                
                await this.loadSessions();
                this.sendCurrentSession();
                
                this.sendToWebview('sessionCreated', {
                    session: {
                        id: newSessionId,
                        name: defaultName,
                        messageCount: 0,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        isActive: true
                    }
                });
            }
        } catch (error) {
            console.error('Failed to create session:', error);
            vscode.window.showErrorMessage('Failed to create new session');
        }
    }

    private sendCurrentSession(): void {
        const sessionId = this.currentSessionId;
        if (sessionId) {
            this.sendToWebview('currentSession', { sessionId });
        }
    }

    private setupAgentEventListeners(): void {
        // 会话加载完成
        this.agentManager.on('sessionLoaded', (data) => {
            // this.sendToWebview('sessionLoaded', {
            //     sessionId: data.sessionId,
            //     messages: data.messages
            // });
            for (const msg of data.messages) {
                this.sendToWebview('addMessage', {
                    role: msg.role,
                    content: msg.content
                });
            }
            this.currentSessionId = data.sessionId;
            this.sendCurrentSession();
        });

        // 会话列表更新
        this.agentManager.on('sessionsListUpdated', (data) => {
            this.sessions = data.sessions;
            // this.loadSessions();
        });

        // 消息恢复
        this.agentManager.on('messagesRestored', (data) => {
            this.sendToWebview('messagesRestored', {
                sessionId: data.sessionId,
                messages: data.messages
            });
        });

        // Agent 就绪
        this.agentManager.on('ready', (data) => {
            this.sendToWebview('agentReady', { sessionId: data.sessionId });
            // 加载会话列表
            this.loadSessions();
            // // 如果有当前会话，加载其消息
            // if (this.currentSessionId) {
            //     this.loadSessionMessages(this.currentSessionId);
            // }
            
            this.loadCurrentSessionMessages();

        });

        this.agentManager.on('stopped', () => {
            this.sendToWebview('agentStopped', {});
            this.messageBuffer = '';
        });

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
                status: data.status || 'executing'
            });
        });
        
        this.agentManager.on('toolResult', (result) => {
            this.sendToWebview('toolResult', {
                callId: result.toolCallId,
                name: result.name,
                result: result.result,
                error: result.error || null,
                status: result.status || 'completed'
            });
        });

        this.agentManager.on('thoughtChunk', (data) => {
            this.sendToWebview('thoughtChunk', { content: data.content });
        });

        // 文件变更相关
        this.agentManager.on('updateChanges', (data) => {
            this.sendToWebview('updateChanges', {
                changes: data.changes
            });
        });

        // 会话创建事件
        this.agentManager.on('sessionCreated', (data) => {
            this.currentSessionId = data.sessionId;
            this.loadSessions();
            this.sendCurrentSession();
        });

        // 会话删除事件
        // this.agentManager.on('sessionDeleted', (data) => {
        //     if (this.currentSessionId === data.sessionId) {
        //         this.currentSessionId = null;
        //         this.sendToWebview('clearMessages', {});
        //     }
        //     this.loadSessions();
        // });

        // 会话切换事件
        this.agentManager.on('sessionSwitched', (data) => {
            this.currentSessionId = data.sessionId;
            this.sendCurrentSession();
        });
        
        // ⭐ 监听会话重命名事件
        this.agentManager.on('sessionRenamed', (data) => {
            console.log(`🔄 Session renamed: ${data.sessionId} -> "${data.newTitle}"`);
            
            // 更新当前会话 ID（如果需要）
            if (this.currentSessionId === data.sessionId) {
                // sessionId 没变，不需要更新
            }
            
            // 刷新会话列表
            this.loadSessions();
            
            // 通知 Webview 会话已重命名
            this.sendToWebview('sessionRenamed', {
                sessionId: data.sessionId,
                newTitle: data.newTitle
            });
        });


    }

    

    private async sendPendingChanges(): Promise<void> {
        const changes = await this.agentManager.getPendingChanges();
        this.sendToWebview('updateChanges', { changes });
    }

    private async handleUserMessage(text: string): Promise<void> {
        // 如果没有当前会话，创建新的
        if (!this.currentSessionId) {
            await this.handleCreateSession('新会话');
        }
        
        // 发送用户消息到 Webview
        this.sendToWebview('addMessage', { role: 'user', content: text });
        
        this.messageBuffer = '';
        this.sendToWebview('startAssistantMessage', {});
        
        let assistantResponse = '';
        let thoughtResponse = '';
        
        const messageChunkListener = (data: { content: string }) => {
            assistantResponse += data.content;
            this.messageBuffer += data.content;
            this.sendToWebview('updateAssistantMessage', { content: this.messageBuffer });
        };

        const thoughtChunkListener = (data: { content: string }) => {
            thoughtResponse += data.content;
            this.sendToWebview('thoughtChunk', { 
                content: data.content,
                fullThought: thoughtResponse 
            });
        };
        
        this.agentManager.on('messageChunk', messageChunkListener);
        this.agentManager.on('thoughtChunk', thoughtChunkListener);
        
        try {
            await this.agentManager.sendPrompt(text);
            
            // 完成后刷新
            setTimeout(() => {
                this.sendPendingChanges();
                // 更新会话列表（消息数可能变化）
                // this.loadSessions();
            }, 500);
        } catch (error) {
            console.error('Error sending prompt:', error);
        } finally {
            this.agentManager.off('messageChunk', messageChunkListener);
            this.agentManager.off('thoughtChunk', thoughtChunkListener);
        }
    }

    private sendAgentStatus(): void {
        if (this.agentManager.isRunning()) {
            const sessionId = this.agentManager.getSessionId();
            this.sendToWebview('agentReady', { sessionId });
        } else {
            this.sendToWebview('agentStopped', {});
        }
    }

    private sendToWebview(type: string, data: any): void {
        if (!this.isWebviewReady) {
            this.pendingMessages.push({ type, data });
            return;
        }
        this.webviewView?.webview.postMessage({ type, ...data });
    }

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