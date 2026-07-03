// storage/SessionManager.ts
import * as vscode from 'vscode';
import { ChatMessage } from './ChatHistory';

export interface ChatSession {
    id: string;
    name: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
    isActive?: boolean;
}

export class SessionManager {
    private storage: vscode.Memento;
    private sessions: ChatSession[] = [];
    private currentSessionId: string | null = null;
    private readonly STORAGE_KEY = 'chatSessions';
    private readonly CURRENT_SESSION_KEY = 'currentSessionId';

    constructor(context: vscode.ExtensionContext) {
        this.storage = context.globalState;
        this.loadSessions();
        this.loadCurrentSession();
    }

    private loadSessions(): void {
        this.sessions = this.storage.get<ChatSession[]>(this.STORAGE_KEY, []);
        this.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        console.log(`Loaded ${this.sessions.length} sessions`);
    }

    private loadCurrentSession(): void {
        const sessionId = this.storage.get<string | undefined>(this.CURRENT_SESSION_KEY, undefined);
        this.currentSessionId = sessionId || null;
        
        // 如果当前会话不存在，但会话列表不为空，使用最新会话
        if (this.currentSessionId && !this.sessions.find(s => s.id === this.currentSessionId)) {
            this.currentSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
        }
        
        // 标记当前激活的会话
        this.sessions.forEach(s => {
            s.isActive = s.id === this.currentSessionId;
        });
        
        console.log('Current session:', this.currentSessionId);
    }

    private saveSessions(): void {
        this.storage.update(this.STORAGE_KEY, this.sessions);
        console.log(`Saved ${this.sessions.length} sessions`);
    }

    private saveCurrentSession(): void {
        if (this.currentSessionId) {
            this.storage.update(this.CURRENT_SESSION_KEY, this.currentSessionId);
        } else {
            this.storage.update(this.CURRENT_SESSION_KEY, undefined);
        }
    }

    createSession(name?: string): ChatSession {
        const session: ChatSession = {
            id: `session-${Date.now()}`,
            name: name || `Chat ${this.sessions.length + 1}`,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isActive: false
        };
        
        this.sessions.unshift(session);
        this.saveSessions();
        console.log('Created session:', session.id, session.name);
        return session;
    }

    switchSession(sessionId: string): ChatSession | null {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            console.log('Session not found:', sessionId);
            return null;
        }

        // 取消当前会话的激活状态
        if (this.currentSessionId) {
            const current = this.sessions.find(s => s.id === this.currentSessionId);
            if (current) current.isActive = false;
        }

        this.currentSessionId = sessionId;
        session.isActive = true;
        session.updatedAt = Date.now();
        
        this.saveSessions();
        this.saveCurrentSession();
        console.log('Switched to session:', sessionId, session.name);
        return session;
    }

    getCurrentSession(): ChatSession | null {
        if (!this.currentSessionId) return null;
        return this.sessions.find(s => s.id === this.currentSessionId) || null;
    }

    getAllSessions(): ChatSession[] {
        return this.sessions;
    }

    getSessionMessages(sessionId: string): ChatMessage[] {
        const session = this.sessions.find(s => s.id === sessionId);
        return session ? session.messages : [];
    }

    addMessageToCurrentSession(role: ChatMessage['role'], content: string): void {
        const session = this.getCurrentSession();
        if (!session) {
            console.log('No current session, creating one');
            const newSession = this.createSession('New Chat');
            this.switchSession(newSession.id);
            // 重新获取当前会话
            const currentSession = this.getCurrentSession();
            if (!currentSession) return;
            currentSession.messages.push({
                role,
                content,
                timestamp: Date.now()
            });
            currentSession.updatedAt = Date.now();
        } else {
            session.messages.push({
                role,
                content,
                timestamp: Date.now()
            });
            session.updatedAt = Date.now();
        }
        
        this.saveSessions();
    }

    clearCurrentSession(): void {
        const session = this.getCurrentSession();
        if (!session) return;

        session.messages = [];
        session.updatedAt = Date.now();
        this.saveSessions();
    }

    deleteSession(sessionId: string): boolean {
        const index = this.sessions.findIndex(s => s.id === sessionId);
        if (index === -1) return false;

        this.sessions.splice(index, 1);
        console.log('🗑️ Deleted session:', sessionId);
        
        // 如果删除的是当前会话
        if (this.currentSessionId === sessionId) {
            // 切换到第一个会话，如果没有则设为 null
            this.currentSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
            
            // 更新激活状态
            this.sessions.forEach(s => {
                s.isActive = s.id === this.currentSessionId;
            });
            
            this.saveCurrentSession();
        }
        
        this.saveSessions();
        return true;
    }

    renameSession(sessionId: string, newName: string): boolean {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return false;

        session.name = newName;
        session.updatedAt = Date.now();
        this.saveSessions();
        console.log('Renamed session:', sessionId, 'to', newName);
        return true;
    }

    
    /**
     * 导出会话为JSON
     */
    exportSession(sessionId: string): string | null {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) return null;
        return JSON.stringify(session, null, 2);
    }

    /**
     * 导入会话
     */
    importSession(data: string): boolean {
        try {
            const session = JSON.parse(data) as ChatSession;
            if (session.id && session.messages) {
                // 检查是否已存在相同ID的会话
                const existing = this.sessions.find(s => s.id === session.id);
                if (existing) {
                    // 更新现有会话
                    existing.messages = session.messages;
                    existing.updatedAt = Date.now();
                    existing.name = session.name || existing.name;
                } else {
                    session.updatedAt = Date.now();
                    this.sessions.unshift(session);
                }
                this.saveSessions();
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to import session:', error);
            return false;
        }
    }


    ensureCurrentSession(): ChatSession {
        let session = this.getCurrentSession();
        if (!session) {
            session = this.createSession('New Chat');
            this.switchSession(session.id);
            session = this.getCurrentSession()!;
        }
        return session;
    }
}