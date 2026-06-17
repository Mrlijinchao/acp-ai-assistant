import * as vscode from 'vscode';
import { AgentManager } from '../agent/AgentManager';
import { ChatHistory } from '../storage/ChatHistory';



export class ChatViewProvider implements vscode.WebviewViewProvider {
    private webviewView?: vscode.WebviewView;
    private messageBuffer = '';
    private cachedHtml: string | null = null;
    private isWebviewReady = false;
    private pendingMessages: Array<{ type: string; data: any }> = [];

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
                this.reloadChatHistory();
            }
        });

        let html = this.cachedHtml || this.getFallbackHtml();
        
        const jsPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.js');
        const jsUri = webviewView.webview.asWebviewUri(jsPath);
        
        html = html.replace(
            '<script src="chat-view.js"></script>',
            `<script src="${jsUri}"></script>`
        );
        
        webviewView.webview.html = html;
        
        this.setupMessageHandler();
        this.setupAgentEventListeners();
        this.loadChatHistory();
    }

    private async reloadChatHistory(): Promise<void> {
        // 清空当前显示的消息
        this.sendToWebview('clearMessages', {});
        
        // 重新加载历史消息
        await this.loadChatHistory();
        
        // 重新发送 agent 状态
        this.sendAgentStatus();
    }

    private setupMessageHandler(): void {
        this.webviewView?.webview.onDidReceiveMessage(async (message) => {
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
                    break;
            }
        });
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

    }

    // webview/ChatViewProvider.ts


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

    async loadHtml(): Promise<void> {
        try {
            // 使用 VSCode API 异步读取文件
            const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.html');
            const jsPath = vscode.Uri.joinPath(this.extensionUri, 'webview', 'chat-view.js');
            
            const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
            let html = Buffer.from(htmlContent).toString('utf-8');
            
            // 获取 JS 的 webview URI（这个在 resolveWebviewView 时才可用）
            // 所以这里先保存占位符
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