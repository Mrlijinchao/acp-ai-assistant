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

export class ToolApprovalManager extends EventEmitter {
    private pendingCalls: Map<string, PendingToolCall> = new Map();
    private callIdCounter = 0;

    constructor() {
        super();
    }

    /**
     * 请求工具调用审批
     * @param toolName 工具名称
     * @param args 工具参数
     * @returns Promise<boolean> - true 表示批准，false 表示拒绝
     */
    async requestApproval(toolName: string, args: any): Promise<boolean> {
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
                title: '✅ Approve', 
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
                { title: '✅ Approve', isCloseAffordance: false },
                { title: '❌ Deny', isCloseAffordance: false }
            ];
            
            const fullArgs = JSON.stringify(args, null, 2);
            const detailSelection = await vscode.window.showInformationMessage(
                `Tool: ${toolName}\n\nArguments:\n${fullArgs}`,
                ...detailActions
            );
            
            if (detailSelection?.title === '✅ Approve') {
                this.approveCall(callId);
            } else {
                this.rejectCall(callId);
            }
        } else if (selection?.title === '✅ Approve') {
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
}