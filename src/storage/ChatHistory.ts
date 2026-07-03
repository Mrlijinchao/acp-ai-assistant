// storage/ChatHistory.ts
import * as vscode from 'vscode';
import { SessionManager, ChatSession } from './SessionManager';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}

export class ChatHistory {
    private sessionManager: SessionManager;

    constructor(context: vscode.ExtensionContext) {
        this.sessionManager = new SessionManager(context);
    }

    /**
     * 获取会话管理器
     */
    getSessionManager(): SessionManager {
        return this.sessionManager;
    }

    /**
     * 添加消息到当前会话
     */
    async addMessage(role: ChatMessage['role'], content: string): Promise<void> {
        const session = this.sessionManager.ensureCurrentSession();
        this.sessionManager.addMessageToCurrentSession(role, content);
        console.log(`Message saved to session ${session.name}: ${role}, length: ${content.length}`);
    }

    /**
     * 添加助手消息
     */
    async addAssistantMessage(content: string): Promise<void> {
        await this.addMessage('assistant', content);
    }

    /**
     * 获取当前会话的所有消息
     */
    async getMessages(): Promise<ChatMessage[]> {
        const session = this.sessionManager.getCurrentSession();
        return session ? session.messages : [];
    }

    /**
     * 获取指定会话的消息
     */
    async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
        return this.sessionManager.getSessionMessages(sessionId);
    }

    /**
     * 获取所有会话
     */
    async getSessions(): Promise<ChatSession[]> {
        return this.sessionManager.getAllSessions();
    }

    /**
     * 创建新会话
     */
    async createSession(name?: string): Promise<ChatSession> {
        const session = this.sessionManager.createSession(name);
        this.sessionManager.switchSession(session.id);
        return session;
    }

    /**
     * 切换到指定会话
     */
    async switchSession(sessionId: string): Promise<ChatSession | null> {
        const session = this.sessionManager.switchSession(sessionId);
        if (session) {
            console.log(`Switched to session: ${session.name}`);
        }
        return session;
    }

    /**
     * 删除会话
     */
    async deleteSession(sessionId: string): Promise<boolean> {
        const result = this.sessionManager.deleteSession(sessionId);
        if (result) {
            console.log(`Deleted session: ${sessionId}`);
        }
        return result;
    }

    /**
     * 重命名会话
     */
    async renameSession(sessionId: string, newName: string): Promise<boolean> {
        return this.sessionManager.renameSession(sessionId, newName);
    }

    /**
     * 获取当前会话ID
     */
    getCurrentSessionId(): string | null {
        return this.sessionManager.getCurrentSession()?.id || null;
    }

    /**
     * 清空当前会话
     */
    async clear(): Promise<void> {
        this.sessionManager.clearCurrentSession();
        console.log('Current session cleared');
    }

    /**
     * 导出会话
     */
    async exportSession(sessionId: string): Promise<string | null> {
        return this.sessionManager.exportSession(sessionId);
    }

    /**
     * 导入会话
     */
    async importSession(data: string): Promise<boolean> {
        return this.sessionManager.importSession(data);
    }

    /**
     * 导出所有会话
     */
    async exportAllSessions(): Promise<string> {
        const sessions = this.sessionManager.getAllSessions();
        return JSON.stringify(sessions, null, 2);
    }

}