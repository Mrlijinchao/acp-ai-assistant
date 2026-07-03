import * as vscode from 'vscode';
import { AgentManager } from '../agent/AgentManager';
import { ChatHistory } from '../storage/ChatHistory';
import { Logger } from '../utils/logger';

export class CommandManager {
    private logger: Logger;

    constructor(
        private agentManager: AgentManager,
        private chatHistory: ChatHistory
    ) {
        this.logger = new Logger('CommandManager');
    }

    registerCommands(context: vscode.ExtensionContext): void {
        const commands = [
            vscode.commands.registerCommand('acp.startAgent', () => this.startAgent()),
            vscode.commands.registerCommand('acp.stopAgent', () => this.stopAgent()),
            vscode.commands.registerCommand('acp.clearHistory', () => this.clearHistory()),
            vscode.commands.registerCommand('acp.showStatus', () => this.showStatus()),
            vscode.commands.registerCommand('acp.exportHistory', () => this.exportHistory()),
            vscode.commands.registerCommand('acp.importHistory', () => this.importHistory()),
            vscode.commands.registerCommand('acp.sendSelection', () => this.sendSelection()),
            vscode.commands.registerCommand('acp.explainCode', () => this.explainCode()),
            vscode.commands.registerCommand('acp.refactorCode', () => this.refactorCode()),
        ];

        context.subscriptions.push(...commands);
        this.logger.info('Commands registered');
    }

    private async startAgent(): Promise<void> {
        try {
            await this.agentManager.start("qwen-agent");
            vscode.window.showInformationMessage('🚀 Agent started successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start agent: ${error}`);
            this.logger.error('Start agent failed:', error);
        }
    }

    private stopAgent(): void {
        this.agentManager.stop();
        vscode.window.showInformationMessage('⏹️ Agent stopped');
    }

    private async clearHistory(): Promise<void> {
        const answer = await vscode.window.showWarningMessage(
            'Clear all chat history?',
            'Yes',
            'No'
        );
        if (answer === 'Yes') {
            await this.chatHistory.clear();
            vscode.window.showInformationMessage('🗑️ Chat history cleared');
        }
    }

    private async showStatus(): Promise<void> {
        const isRunning = this.agentManager.isRunning();
        const sessionId = this.agentManager.getSessionId();
        const messageCount = (await this.chatHistory.getMessages()).length;
        
        vscode.window.showInformationMessage(
            `Agent: ${isRunning ? '🟢 Running' : '🔴 Stopped'} | ` +
            `Session: ${sessionId?.slice(-8) || 'None'} | ` +
            `Messages: ${messageCount}`
        );
    }

    private async exportHistory(): Promise<void> {
        const history = await this.chatHistory.exportAllSessions();
        const uri = await vscode.window.showSaveDialog({
            title: 'Export Chat History',
            filters: { 'JSON files': ['json'] },
            defaultUri: vscode.Uri.file('chat-history.json')
        });
        
        if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(history, 'utf8'));
            vscode.window.showInformationMessage(`📁 History exported to ${uri.fsPath}`);
        }
    }

    private async importHistory(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            title: 'Import Chat History',
            filters: { 'JSON files': ['json'] },
            canSelectMany: false
        });
        
        if (uris && uris[0]) {
            const content = await vscode.workspace.fs.readFile(uris[0]);
            const history = Buffer.from(content).toString('utf8');
            await this.chatHistory.importSession(history);
            vscode.window.showInformationMessage('📂 History imported successfully');
        }
    }

    private async sendSelection(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);
        
        if (!text) {
            vscode.window.showWarningMessage('No text selected');
            return;
        }

        if (!this.agentManager.isRunning()) {
            const answer = await vscode.window.showWarningMessage(
                'Agent is not running. Start agent?',
                'Start',
                'Cancel'
            );
            if (answer === 'Start') {
                await this.startAgent();
            } else {
                return;
            }
        }

        const prompt = `Please analyze this code:\n\`\`\`\n${text}\n\`\`\``;
        await this.agentManager.sendPrompt(prompt);
        
        // 同时保存到聊天历史
        await this.chatHistory.addMessage('user', prompt);
        
        vscode.window.showInformationMessage('📤 Code sent to agent');
    }

    private async explainCode(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);
        
        if (!text) {
            vscode.window.showWarningMessage('No code selected');
            return;
        }

        if (!this.agentManager.isRunning()) {
            const answer = await vscode.window.showWarningMessage(
                'Agent is not running. Start agent?',
                'Start',
                'Cancel'
            );
            if (answer === 'Start') {
                await this.startAgent();
            } else {
                return;
            }
        }

        const prompt = `Please explain this code in detail:\n\`\`\`\n${text}\n\`\`\``;
        await this.agentManager.sendPrompt(prompt);
        await this.chatHistory.addMessage('user', prompt);
        
        vscode.window.showInformationMessage('📖 Explanation requested');
    }

    private async refactorCode(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        const text = editor.document.getText(selection);
        
        if (!text) {
            vscode.window.showWarningMessage('No code selected');
            return;
        }

        if (!this.agentManager.isRunning()) {
            const answer = await vscode.window.showWarningMessage(
                'Agent is not running. Start agent?',
                'Start',
                'Cancel'
            );
            if (answer === 'Start') {
                await this.startAgent();
            } else {
                return;
            }
        }

        const prompt = `Please refactor this code for better readability and performance:\n\`\`\`\n${text}\n\`\`\``;
        await this.agentManager.sendPrompt(prompt);
        await this.chatHistory.addMessage('user', prompt);
        
        vscode.window.showInformationMessage('🔧 Refactoring requested');
    }
}