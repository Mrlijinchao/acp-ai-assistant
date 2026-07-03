// tools/ToolApprovalManager.ts
import * as vscode from 'vscode';
import { EventEmitter } from 'events';

export interface PendingToolCall {
    id: string;
    toolName: string;
    args: any;
    resolve: (approved: boolean) => void;
    timestamp: number;
}

export interface ApprovalSession {
    sessionId: string;
    autoApprove: boolean; // 是否自动批准本次会话中的所有工具
    approvedTools: Set<string>; // 已批准的工具列表（用于记录）
    startTime: number;
}

export class ToolApprovalManager extends EventEmitter {
    private pendingCalls: Map<string, PendingToolCall> = new Map();
    private callIdCounter = 0;

    // 当前会话的审批状态
    private currentSession: ApprovalSession | null = null;
    private sessionIdCounter = 0;

    constructor() {
        super();
    }

    /**
     * 开始一个新的会话（任务）
     */
    startNewSession(): string {
        const sessionId = `session-${++this.sessionIdCounter}-${Date.now()}`;
        this.currentSession = {
            sessionId,
            autoApprove: false,
            approvedTools: new Set<string>(),
            startTime: Date.now()
        };
        this.emit('sessionStarted', { sessionId });
        return sessionId;
    }

    /**
     * 结束当前会话
     */
    endSession(): void {
        if (this.currentSession) {
            // 取消所有待处理的调用
            this.cancelAllPending();
            const sessionInfo = { ...this.currentSession };
            this.currentSession = null;
            this.emit('sessionEnded', sessionInfo);
        }
    }

    /**
     * 获取当前会话ID
     */
    getCurrentSessionId(): string | null {
        return this.currentSession?.sessionId || null;
    }

    /**
     * 检查当前会话是否处于自动批准模式
     */
    isAutoApprove(): boolean {
        return this.currentSession?.autoApprove || false;
    }


    /**
     * 请求工具调用审批
     * @param toolName 工具名称
     * @param args 工具参数
     * @returns Promise<boolean> - true 表示批准，false 表示拒绝
     */
    async requestApproval(toolName: string, args: any): Promise<boolean> {

        // 如果当前会话是自动批准模式，直接批准
        if (this.isAutoApprove()) {
            this.emit('autoApproved', { toolName, args, sessionId: this.currentSession?.sessionId });
            return true;
        }

        const callId = `tool-${++this.callIdCounter}-${Date.now()}`;
        
        return new Promise((resolve) => {
            const pendingCall: PendingToolCall = {
                id: callId,
                toolName,
                args,
                resolve,
                timestamp: Date.now()
            };
            
            this.pendingCalls.set(callId, pendingCall);
            
            // 显示审批对话框
            this.showApprovalDialog(callId, toolName, args);
            
            // 设置超时自动拒绝（30秒）
            setTimeout(() => {
                if (this.pendingCalls.has(callId)) {
                    this.rejectCall(callId);
                    resolve(false);
                    vscode.window.showWarningMessage(`Tool "${toolName}" approval timed out`);
                }
            }, 30000);
        });
    }

    private async showApprovalDialog(callId: string, toolName: string, args: any): Promise<void> {
        const argsStr = JSON.stringify(args, null, 2);
        const truncatedArgs = argsStr.length > 200 ? argsStr.substring(0, 200) + '...' : argsStr;
        
        // 显示带有详细信息的对话框
        const actions: vscode.MessageItem[] = [
            { 
                title: '✅ Approve Once', 
                isCloseAffordance: false 
            },
            { 
                title: '✅ Approve All in Session', 
                isCloseAffordance: false 
            },
            { 
                title: '❌ Deny', 
                isCloseAffordance: false 
            },
            { 
                title: '📋 Show Details', 
                isCloseAffordance: false 
            }
        ];

        const selection = await vscode.window.showInformationMessage(
            `🔧 Tool call requires approval: ${toolName}`,
            ...actions
        );

        if (selection?.title === '📋 Show Details') {
            // 显示详细参数
            const detailActions: vscode.MessageItem[] = [
                { title: '✅ Approve Once', isCloseAffordance: false },
                { title: '✅ Approve All in Session', isCloseAffordance: false },
                { title: '❌ Deny', isCloseAffordance: false }
            ];
            
            const fullArgs = JSON.stringify(args, null, 2);
            const detailSelection = await vscode.window.showInformationMessage(
                `Tool: ${toolName}\n\nArguments:\n${fullArgs}`,
                ...detailActions
            );
            
            if (detailSelection?.title === '✅ Approve Once') {
                this.approveCall(callId);
            } else if (detailSelection?.title === '✅ Approve All in Session') {
                this.enableAutoApprove();
                this.approveCall(callId);
            } else {
                this.rejectCall(callId);
            }
        } else if (selection?.title === '✅ Approve Once') {
            this.approveCall(callId);
        } else if (selection?.title === '✅ Approve All in Session') {
            this.enableAutoApprove();
            this.approveCall(callId);
        } else {
            this.rejectCall(callId);
        }
    }

    private approveCall(callId: string): void {
        const pending = this.pendingCalls.get(callId);
        if (pending) {
            pending.resolve(true);
            this.pendingCalls.delete(callId);
            // 记录已批准的工具
            if (this.currentSession) {
                this.currentSession.approvedTools.add(pending.toolName);
            }
            this.emit('approved', { callId, toolName: pending.toolName });
        }
    }

    private rejectCall(callId: string): void {
        const pending = this.pendingCalls.get(callId);
        if (pending) {
            pending.resolve(false);
            this.pendingCalls.delete(callId);
            this.emit('rejected', { callId, toolName: pending.toolName });
        }
    }

    /**
     * 启用自动批准模式（当前会话中所有工具调用自动批准）
     */
    private enableAutoApprove(): void {
        if (this.currentSession) {
            this.currentSession.autoApprove = true;
            vscode.window.showInformationMessage(
                `✅ All tools will be automatically approved for this session`
            );
            this.emit('autoApproveEnabled', { 
                sessionId: this.currentSession.sessionId 
            });
        }
    }

    /**
     * 禁用自动批准模式
     */
    disableAutoApprove(): void {
        if (this.currentSession) {
            this.currentSession.autoApprove = false;
            this.emit('autoApproveDisabled', { 
                sessionId: this.currentSession.sessionId 
            });
        }
    }

    /**
     * 取消所有待处理的工具调用
     */
    cancelAllPending(): void {
        for (const [callId, pending] of this.pendingCalls) {
            pending.resolve(false);
            this.pendingCalls.delete(callId);
        }
        this.emit('allCancelled', {});
    }

    getPendingCount(): number {
        return this.pendingCalls.size;
    }

    isPending(callId: string): boolean {
        return this.pendingCalls.has(callId);
    }
    /**
     * 获取当前会话信息
     */
    getSessionInfo(): { sessionId: string; autoApprove: boolean; approvedTools: string[] } | null {
        if (!this.currentSession) return null;
        return {
            sessionId: this.currentSession.sessionId,
            autoApprove: this.currentSession.autoApprove,
            approvedTools: Array.from(this.currentSession.approvedTools)
        };
    }
}