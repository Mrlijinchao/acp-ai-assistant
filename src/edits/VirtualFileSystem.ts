// src/edits/VirtualFileSystem.ts
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';

export interface FileChange {
    filePath: string;
    type: 'create' | 'modify' | 'delete';
    originalContent?: string;
    newContent?: string;
    timestamp: number;
}

export interface VirtualFileSnapshot {
    path: string;
    content: string;
    exists: boolean;
}

export interface DiffChange {
    type: 'added' | 'removed' | 'modified' | 'unchanged';
    lineNumber: number;
    originalLine: string;
    modifiedLine: string;
    startChar?: number;
    endChar?: number;
}

export interface FileDiff {
    filePath: string;
    originalContent: string;
    modifiedContent: string;
    changes: DiffChange[];
    stats: {
        additions: number;
        deletions: number;
        modifications: number;
        totalChanges: number;
    };
}

export class VirtualFileSystem extends EventEmitter {
    private logger: Logger;
    private changes: Map<string, FileChange> = new Map();
    private snapshots: Map<string, VirtualFileSnapshot> = new Map();
    private isTransactionActive = false;
    private transactionId: string | null = null;

    constructor() {
        super();
        this.logger = new Logger('VirtualFileSystem');
    }

    /**
     * 开始一个事务（任务）
     */
    beginTransaction(transactionId: string): void {
        if (this.isTransactionActive) {
            throw new Error('Transaction already active');
        }
        this.isTransactionActive = true;
        this.transactionId = transactionId;
        this.changes.clear();
        this.snapshots.clear();
        this.logger.info(`Transaction started: ${transactionId}`);
        
        this.emit('transactionStarted', { 
            transactionId,
            timestamp: Date.now()
        });
    }

    /**
     * 提交事务 - 将所有修改应用到真实文件系统
     */
    async commitTransaction(): Promise<{ success: boolean; errors: string[] }> {
        if (!this.isTransactionActive) {
            throw new Error('No active transaction');
        }

        const errors: string[] = [];
        const changes = Array.from(this.changes.values());
        const transactionId = this.transactionId;

        for (const change of changes) {
            try {
                const uri = vscode.Uri.file(change.filePath);
                
                switch (change.type) {
                    case 'create':
                    case 'modify': {
                        const encoder = new TextEncoder();
                        // 确保目录存在
                        const dirUri = vscode.Uri.joinPath(uri, '..');
                        await vscode.workspace.fs.createDirectory(dirUri);
                        // 写入文件
                        await vscode.workspace.fs.writeFile(uri, encoder.encode(change.newContent || ''));
                        break;
                    }
                    case 'delete': {
                        await vscode.workspace.fs.delete(uri);
                        break;
                    }
                }
                this.logger.info(`Applied ${change.type} for ${change.filePath}`);
            } catch (error) {
                errors.push(`Failed to apply ${change.type} for ${change.filePath}: ${error}`);
                this.logger.error(`Failed to apply change: ${error}`);
            }
        }

        // 清除事务状态
        this.isTransactionActive = false;
        this.transactionId = null;
        this.changes.clear();
        this.snapshots.clear();

        this.emit('transactionCommitted', { 
            transactionId,
            changes,
            errors,
            success: errors.length === 0,
            timestamp: Date.now()
        });
        
        return {
            success: errors.length === 0,
            errors
        };
    }

    /**
     * 回滚事务 - 放弃所有修改
     */
    rollbackTransaction(): void {
        if (!this.isTransactionActive) {
            throw new Error('No active transaction');
        }

        const transactionId = this.transactionId;
        this.isTransactionActive = false;
        this.transactionId = null;
        this.changes.clear();
        this.snapshots.clear();

        this.logger.info(`Transaction rolled back: ${transactionId}`);
        
        this.emit('transactionRolledBack', { 
            transactionId,
            timestamp: Date.now()
        });
    }

    /**
     * 检查是否有活跃的事务
     */
    hasActiveTransaction(): boolean {
        return this.isTransactionActive;
    }

    /**
     * 获取当前事务ID
     */
    getTransactionId(): string | null {
        return this.transactionId;
    }

    /**
     * 读取文件（优先返回虚拟内容）
     */
    async readFile(filePath: string): Promise<string> {
        // 检查是否在事务中并且有修改
        if (this.isTransactionActive) {
            const change = this.changes.get(filePath);
            if (change) {
                // 如果文件被删除
                if (change.type === 'delete') {
                    throw new Error(`File ${filePath} has been deleted`);
                }
                // 返回修改后的内容
                return change.newContent || '';
            }

            // 检查是否有快照（原始内容）
            const snapshot = this.snapshots.get(filePath);
            if (snapshot && snapshot.exists) {
                return snapshot.content;
            }
        }

        // 从真实文件系统读取
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');
            
            // 如果在事务中，保存快照
            if (this.isTransactionActive && !this.snapshots.has(filePath)) {
                this.snapshots.set(filePath, {
                    path: filePath,
                    content: text,
                    exists: true
                });
            }
            
            return text;
        } catch (error) {
            // 文件不存在
            if (this.isTransactionActive && !this.snapshots.has(filePath)) {
                this.snapshots.set(filePath, {
                    path: filePath,
                    content: '',
                    exists: false
                });
            }
            throw new Error(`File not found: ${filePath}`);
        }
    }

    /**
     * 写入文件（虚拟写入）
     */
    async writeFile(filePath: string, content: string): Promise<void> {
        if (!this.isTransactionActive) {
            // 不在事务中，直接写入真实文件
            const uri = vscode.Uri.file(filePath);
            const encoder = new TextEncoder();
            // 确保目录存在
            const dirUri = vscode.Uri.joinPath(uri, '..');
            await vscode.workspace.fs.createDirectory(dirUri);
            await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
            this.logger.info(`Direct write to ${filePath}`);
            return;
        }

        // 在事务中，先保存原始内容（如果是第一次修改）
        if (!this.snapshots.has(filePath)) {
            try {
                const uri = vscode.Uri.file(filePath);
                const originalContent = await vscode.workspace.fs.readFile(uri);
                this.snapshots.set(filePath, {
                    path: filePath,
                    content: Buffer.from(originalContent).toString('utf8'),
                    exists: true
                });
            } catch (error) {
                // 文件不存在，记录为不存在
                this.snapshots.set(filePath, {
                    path: filePath,
                    content: '',
                    exists: false
                });
            }
        }

        // 记录修改
        const existingChange = this.changes.get(filePath);
        if (existingChange) {
            if (existingChange.type === 'delete') {
                // 如果之前被删除，改为修改
                existingChange.type = 'modify';
                existingChange.newContent = content;
                this.logger.info(`Changed delete to modify for ${filePath}`);
            } else {
                // 更新内容
                existingChange.newContent = content;
                this.logger.info(`Updated modify for ${filePath}`);
            }
        } else {
            // 检查文件是否存在
            const snapshot = this.snapshots.get(filePath);
            const type = snapshot?.exists ? 'modify' : 'create';
            this.changes.set(filePath, {
                filePath,
                type,
                originalContent: snapshot?.content,
                newContent: content,
                timestamp: Date.now()
            });
            this.logger.info(`Added ${type} for ${filePath}`);
        }

        this.emit('fileChanged', { 
            filePath, 
            type: 'modify',
            transactionId: this.transactionId 
        });
    }

    /**
     * 删除文件（虚拟删除）
     */
    async deleteFile(filePath: string): Promise<void> {
        if (!this.isTransactionActive) {
            // 不在事务中，直接删除真实文件
            const uri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.delete(uri);
            this.logger.info(`Direct delete of ${filePath}`);
            return;
        }

        // 在事务中
        if (!this.snapshots.has(filePath)) {
            try {
                const uri = vscode.Uri.file(filePath);
                const content = await vscode.workspace.fs.readFile(uri);
                this.snapshots.set(filePath, {
                    path: filePath,
                    content: Buffer.from(content).toString('utf8'),
                    exists: true
                });
            } catch (error) {
                throw new Error(`File ${filePath} does not exist`);
            }
        }

        // 记录删除
        const existingChange = this.changes.get(filePath);
        if (existingChange) {
            if (existingChange.type === 'create') {
                // 如果之前是创建，直接移除记录
                this.changes.delete(filePath);
                this.snapshots.delete(filePath);
                this.logger.info(`Removed create for ${filePath} due to delete`);
                return;
            }
            // 否则改为删除
            existingChange.type = 'delete';
            existingChange.newContent = undefined;
            this.logger.info(`Changed modify to delete for ${filePath}`);
        } else {
            this.changes.set(filePath, {
                filePath,
                type: 'delete',
                originalContent: this.snapshots.get(filePath)?.content,
                timestamp: Date.now()
            });
            this.logger.info(`Added delete for ${filePath}`);
        }

        this.emit('fileChanged', { 
            filePath, 
            type: 'delete',
            transactionId: this.transactionId 
        });
    }

    /**
     * 移除单个文件的修改
     */
    removeChange(filePath: string): boolean {
        if (!this.isTransactionActive) {
            this.logger.warn('No active transaction');
            return false;
        }

        const change = this.changes.get(filePath);
        if (!change) {
            this.logger.warn(`No change found for ${filePath}`);
            return false;
        }

        // 如果文件原本不存在，删除快照
        const snapshot = this.snapshots.get(filePath);
        if (snapshot && !snapshot.exists) {
            this.snapshots.delete(filePath);
        }

        this.changes.delete(filePath);
        this.logger.info(`Removed change for ${filePath}`);
        
        this.emit('fileChanged', {
            filePath,
            type: 'removed',
            transactionId: this.transactionId
        });

        return true;
    }

    /**
     * 检查文件是否存在（虚拟检查）
     */
    async fileExists(filePath: string): Promise<boolean> {
        if (this.isTransactionActive) {
            const change = this.changes.get(filePath);
            if (change) {
                if (change.type === 'delete') {
                    return false;
                }
                return true;
            }
            
            // 检查快照
            const snapshot = this.snapshots.get(filePath);
            if (snapshot) {
                return snapshot.exists;
            }
        }

        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取所有待应用的修改
     */
    getPendingChanges(): FileChange[] {
        return Array.from(this.changes.values());
    }

    /**
     * 获取修改统计
     */
    getChangeStats(): { created: number; modified: number; deleted: number } {
        const stats = { created: 0, modified: 0, deleted: 0 };
        for (const change of this.changes.values()) {
            // 使用 'created' 而不是 'create'
            if (change.type === 'create') stats.created++;
            else if (change.type === 'modify') stats.modified++;
            else if (change.type === 'delete') stats.deleted++;
        }
        return stats;
    }

    /**
     * 获取修改摘要（用于显示给用户）
     */
    getChangeSummary(): string {
        const stats = this.getChangeStats();
        const parts: string[] = [];
        if (stats.created > 0) parts.push(`📄 创建 ${stats.created} 个文件`);
        if (stats.modified > 0) parts.push(`✏️ 修改 ${stats.modified} 个文件`);
        if (stats.deleted > 0) parts.push(`🗑️ 删除 ${stats.deleted} 个文件`);
        return parts.join('、') || '无修改';
    }

    /**
     * 获取文件的差分对比
     */
    getFileDiff(filePath: string): FileDiff | null {
        const change = this.changes.get(filePath);
        if (!change) return null;

        // 获取原始内容
        const snapshot = this.snapshots.get(filePath);
        const originalContent = snapshot?.exists ? snapshot.content : '';
        const modifiedContent = change.type === 'delete' ? '' : (change.newContent || '');

        // 计算差分
        const changes = this.computeDiff(originalContent, modifiedContent);
        const stats = this.computeStats(changes);

        return {
            filePath,
            originalContent,
            modifiedContent,
            changes,
            stats
        };
    }

    /**
     * 获取所有文件的差分
     */
    getAllDiffs(): FileDiff[] {
        const diffs: FileDiff[] = [];
        for (const filePath of this.changes.keys()) {
            const diff = this.getFileDiff(filePath);
            if (diff) {
                diffs.push(diff);
            }
        }
        return diffs;
    }

    /**
     * 计算两个文本的差分
     */
    private computeDiff(original: string, modified: string): DiffChange[] {
        const changes: DiffChange[] = [];
        const originalLines = original.split('\n');
        const modifiedLines = modified.split('\n');

        // 使用简化的 Myers diff 算法
        const diffResult = this.computeLineDiff(originalLines, modifiedLines);
        
        let originalIdx = 0;
        let modifiedIdx = 0;

        for (const result of diffResult) {
            if (result.type === 'equal') {
                changes.push({
                    type: 'unchanged',
                    lineNumber: originalIdx,
                    originalLine: originalLines[originalIdx] || '',
                    modifiedLine: modifiedLines[modifiedIdx] || ''
                });
                originalIdx++;
                modifiedIdx++;
            } else if (result.type === 'insert') {
                changes.push({
                    type: 'added',
                    lineNumber: modifiedIdx,
                    originalLine: '',
                    modifiedLine: modifiedLines[modifiedIdx] || ''
                });
                modifiedIdx++;
            } else if (result.type === 'delete') {
                changes.push({
                    type: 'removed',
                    lineNumber: originalIdx,
                    originalLine: originalLines[originalIdx] || '',
                    modifiedLine: ''
                });
                originalIdx++;
            } else if (result.type === 'replace') {
                const origLine = originalLines[originalIdx] || '';
                const modLine = modifiedLines[modifiedIdx] || '';
                
                // 计算字符级差异
                const charDiff = this.computeCharDiff(origLine, modLine);
                
                changes.push({
                    type: 'modified',
                    lineNumber: originalIdx,
                    originalLine: origLine,
                    modifiedLine: modLine,
                    startChar: charDiff.startChar,
                    endChar: charDiff.endChar
                });
                originalIdx++;
                modifiedIdx++;
            }
        }

        return changes;
    }

    /**
     * 计算行级别差异
     */
    private computeLineDiff(
        original: string[],
        modified: string[]
    ): Array<{ type: 'equal' | 'insert' | 'delete' | 'replace' }> {
        const result: Array<{ type: 'equal' | 'insert' | 'delete' | 'replace' }> = [];
        
        let i = 0, j = 0;
        const maxI = original.length;
        const maxJ = modified.length;

        // 使用 LCS 算法找公共部分
        const lcs = this.computeLCS(original, modified);
        let lcsIdx = 0;

        while (i < maxI || j < maxJ) {
            if (lcsIdx < lcs.length) {
                const lcsLine = lcs[lcsIdx];
                // 跳过原始中的非 LCS 行（删除）
                while (i < maxI && original[i] !== lcsLine) {
                    result.push({ type: 'delete' });
                    i++;
                }
                // 跳过修改中的非 LCS 行（插入）
                while (j < maxJ && modified[j] !== lcsLine) {
                    result.push({ type: 'insert' });
                    j++;
                }
                // 匹配的 LCS 行（相等）
                if (i < maxI && j < maxJ && original[i] === lcsLine) {
                    result.push({ type: 'equal' });
                    i++;
                    j++;
                    lcsIdx++;
                }
            } else {
                // 剩余行
                if (i < maxI && j < maxJ) {
                    result.push({ type: 'replace' });
                    i++;
                    j++;
                } else if (i < maxI) {
                    result.push({ type: 'delete' });
                    i++;
                } else if (j < maxJ) {
                    result.push({ type: 'insert' });
                    j++;
                }
            }
        }

        return result;
    }

    /**
     * 计算最长公共子序列
     */
    private computeLCS(original: string[], modified: string[]): string[] {
        const m = original.length;
        const n = modified.length;
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        // 填充 DP 表
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (original[i - 1] === modified[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // 回溯找到 LCS
        const lcs: string[] = [];
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (original[i - 1] === modified[j - 1]) {
                lcs.unshift(original[i - 1]);
                i--;
                j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }

        return lcs;
    }

    /**
     * 计算字符级差异
     */
    private computeCharDiff(original: string, modified: string): { startChar: number; endChar: number } {
        let startChar = 0;
        let endChar = 0;
        
        const minLen = Math.min(original.length, modified.length);
        
        // 找前缀相同
        while (startChar < minLen && original[startChar] === modified[startChar]) {
            startChar++;
        }
        
        // 找后缀相同
        let origEnd = original.length - 1;
        let modEnd = modified.length - 1;
        while (origEnd >= startChar && modEnd >= startChar && 
               original[origEnd] === modified[modEnd]) {
            origEnd--;
            modEnd--;
        }
        
        endChar = Math.max(origEnd, modEnd) + 1;
        
        return { startChar, endChar };
    }

    /**
     * 计算统计信息
     */
    private computeStats(changes: DiffChange[]): {
        additions: number;
        deletions: number;
        modifications: number;
        totalChanges: number;
    } {
        let additions = 0;
        let deletions = 0;
        let modifications = 0;

        for (const change of changes) {
            if (change.type === 'added') additions++;
            else if (change.type === 'removed') deletions++;
            else if (change.type === 'modified') modifications++;
        }

        return {
            additions,
            deletions,
            modifications,
            totalChanges: additions + deletions + modifications
        };
    }

    /**
     * 生成差分 HTML（用于预览）
     */
    generateDiffHtml(filePath: string): string {
        const diff = this.getFileDiff(filePath);
        if (!diff) {
            return '<div class="empty">没有修改</div>';
        }

        const fileName = filePath.split(/[\/\\]/).pop() || filePath;
        const { stats, changes } = diff;

        let rowsHtml = '';
        let lineNumber = 0;

        for (const change of changes) {
            lineNumber++;
            const rowClass = change.type === 'added' ? 'added' :
                           change.type === 'removed' ? 'removed' :
                           change.type === 'modified' ? 'modified' : 'unchanged';
            const icon = change.type === 'added' ? '➕' :
                        change.type === 'removed' ? '➖' :
                        change.type === 'modified' ? '✏️' : '·';
            
            const oldContent = this.escapeHtml(change.originalLine) || '&nbsp;';
            const newContent = this.escapeHtml(change.modifiedLine) || '&nbsp;';
            
            // 字符级高亮
            let highlightedOld = oldContent;
            let highlightedNew = newContent;
            if (change.type === 'modified' && change.startChar !== undefined) {
                highlightedOld = this.highlightDiffChars(oldContent, change.startChar, change.endChar, 'old');
                highlightedNew = this.highlightDiffChars(newContent, change.startChar, change.endChar, 'new');
            }

            rowsHtml += `
                <tr class="diff-row ${rowClass}">
                    <td class="line-num">${lineNumber}</td>
                    <td class="old-line">${highlightedOld}</td>
                    <td class="change-icon">${icon}</td>
                    <td class="new-line">${highlightedNew}</td>
                    <td class="line-num">${lineNumber}</td>
                </tr>
            `;
        }

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 20px;
                }
                .diff-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px;
                    background: var(--vscode-sideBar-background);
                    border-radius: 4px;
                    margin-bottom: 16px;
                }
                .diff-header .file-info {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .diff-header .file-info h3 {
                    font-size: 14px;
                    font-weight: 600;
                }
                .diff-header .file-info .path {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                .diff-stats {
                    display: flex;
                    gap: 12px;
                    font-size: 12px;
                }
                .diff-stats .added { color: #2ecc71; }
                .diff-stats .removed { color: #e74c3c; }
                .diff-stats .modified { color: #f39c12; }
                .diff-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-family: 'Consolas', 'Courier New', monospace;
                    font-size: 12px;
                }
                .diff-row {
                    min-height: 20px;
                }
                .diff-row:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .line-num {
                    color: var(--vscode-descriptionForeground);
                    padding: 0 12px;
                    text-align: right;
                    user-select: none;
                    min-width: 40px;
                    font-size: 11px;
                }
                .old-line, .new-line {
                    padding: 1px 8px;
                    white-space: pre-wrap;
                    word-break: break-all;
                }
                .change-icon {
                    text-align: center;
                    padding: 0 6px;
                    min-width: 30px;
                    font-size: 14px;
                }
                .diff-row.added .new-line {
                    background: rgba(46, 204, 113, 0.15);
                }
                .diff-row.removed .old-line {
                    background: rgba(231, 76, 60, 0.15);
                    text-decoration: line-through;
                }
                .diff-row.modified .old-line {
                    background: rgba(231, 76, 60, 0.1);
                }
                .diff-row.modified .new-line {
                    background: rgba(46, 204, 113, 0.1);
                }
                .diff-highlight-old {
                    background: rgba(231, 76, 60, 0.3);
                    border-radius: 2px;
                    padding: 0 1px;
                }
                .diff-highlight-new {
                    background: rgba(46, 204, 113, 0.3);
                    border-radius: 2px;
                    padding: 0 1px;
                }
                .empty {
                    text-align: center;
                    padding: 40px;
                    color: var(--vscode-descriptionForeground);
                }
                .actions {
                    display: flex;
                    gap: 8px;
                    margin-top: 16px;
                    padding: 12px;
                    background: var(--vscode-sideBar-background);
                    border-radius: 4px;
                }
                .actions button {
                    padding: 6px 16px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                }
                .btn-commit {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .btn-commit:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .btn-rollback {
                    background: var(--vscode-errorForeground);
                    color: white;
                }
                .btn-rollback:hover {
                    opacity: 0.8;
                }
            </style>
        </head>
        <body>
            <div class="diff-header">
                <div class="file-info">
                    <h3>📝 差分预览</h3>
                    <span class="path">${this.escapeHtml(filePath)}</span>
                </div>
                <div class="diff-stats">
                    <span class="added">+${stats.additions}</span>
                    <span class="removed">-${stats.deletions}</span>
                    <span class="modified">~${stats.modifications}</span>
                    <span style="color:var(--vscode-descriptionForeground)">| 共 ${stats.totalChanges} 处变化</span>
                </div>
            </div>
            <table class="diff-table">
                <thead>
                    <tr>
                        <th class="line-num">行号</th>
                        <th style="text-align:left;padding:4px 8px;color:#e74c3c;">原始</th>
                        <th style="width:30px;"></th>
                        <th style="text-align:left;padding:4px 8px;color:#2ecc71;">修改后</th>
                        <th class="line-num">行号</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </body>
        </html>`;
    }

    private highlightDiffChars(text: string, start: number | undefined, end: number | undefined, type: 'old' | 'new'): string {
        if (start === undefined || end === undefined || start >= end || start >= text.length) {
            return this.escapeHtml(text);
        }

        const before = this.escapeHtml(text.substring(0, start));
        const highlight = this.escapeHtml(text.substring(start, Math.min(end, text.length)));
        const after = this.escapeHtml(text.substring(Math.min(end, text.length)));

        const className = type === 'old' ? 'diff-highlight-old' : 'diff-highlight-new';
        return `${before}<span class="${className}">${highlight}</span>${after}`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '↵');
    }
}