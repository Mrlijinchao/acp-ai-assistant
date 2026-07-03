import * as vscode from 'vscode';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';

export interface FileBackup {
    filePath: string;
    originalContent: Buffer;
    timestamp: number;
    isNewFile: boolean;
}

export interface FileChange {
    filePath: string;
    type: 'create' | 'modify' | 'delete';
    backup?: FileBackup;
    timestamp: number;
}

export interface TrackingConfig {
    enabled: boolean;           // 是否启用追踪
    pauseOnLargeOperations: boolean;  // 大规模操作时是否自动暂停
    ignorePatterns: RegExp[];   // 忽略模式
    trackBinaryFiles: boolean;  // 是否追踪二进制文件
    maxFileSize: number;        // 最大文件大小（字节），超过不追踪
}

export class FileChangeTracker extends EventEmitter {
    private logger: Logger;
    private changes: Map<string, FileChange> = new Map();
    private fileSystemWatcher: vscode.FileSystemWatcher | null = null;
    private workspaceRoot: string = '';
    private isTracking = false;
    private isPaused = false;
    private pendingChanges: vscode.FileChangeEvent[] = [];
    private config: TrackingConfig;

    // 扩展控制标志
    private flags: Map<string, boolean> = new Map();
    private sessionId: string | null = null;

    // 默认配置
    private static readonly DEFAULT_CONFIG: TrackingConfig = {
        enabled: true,
        pauseOnLargeOperations: true,
        ignorePatterns: [
            /node_modules/,
            /\.git/,
            /\.vscode/,
            /dist/,
            /build/,
            /out/,
            /\.next/,
            /coverage/,
            /\.cache/,
            /\.env/,
            /\.log$/
        ],
        trackBinaryFiles: false,
        maxFileSize: 10 * 1024 * 1024 // 10MB
    };

    constructor(config?: Partial<TrackingConfig>) {
        super();
        this.logger = new Logger('FileChangeTracker');
        this.config = { ...FileChangeTracker.DEFAULT_CONFIG, ...config };
        this.initializeFlags();
    }

    /**
     * 初始化控制标志
     */
    private initializeFlags(): void {
        // 核心控制标志
        this.flags.set('trackingEnabled', this.config.enabled);
        this.flags.set('autoPause', this.config.pauseOnLargeOperations);
        this.flags.set('trackBinaryFiles', this.config.trackBinaryFiles);
        this.flags.set('recordChanges', true);
        this.flags.set('emitEvents', true);
        
        // 扩展控制标志
        this.flags.set('allowRollback', true);
        this.flags.set('allowCommit', true);
        this.flags.set('trackDeletions', true);
        this.flags.set('trackModifications', true);
        this.flags.set('trackCreations', true);
        this.flags.set('notifyOnChange', true);
        this.flags.set('batchProcessing', false);
    }

    /**
     * 设置标志
     */
    setFlag(flag: string, value: boolean): void {
        this.flags.set(flag, value);
        this.logger.info(`Flag ${flag} set to ${value}`);
        this.emit('flagChanged', { flag, value, sessionId: this.sessionId });
    }

    /**
     * 获取标志
     */
    getFlag(flag: string): boolean {
        return this.flags.get(flag) ?? false;
    }

    /**
     * 批量设置标志
     */
    setFlags(flags: Record<string, boolean>): void {
        for (const [key, value] of Object.entries(flags)) {
            this.flags.set(key, value);
        }
        this.logger.info(`Batch flags updated: ${Object.keys(flags).join(', ')}`);
        this.emit('flagsChanged', { flags, sessionId: this.sessionId });
    }

    /**
     * 获取所有标志状态
     */
    getFlags(): Record<string, boolean> {
        const result: Record<string, boolean> = {};
        for (const [key, value] of this.flags) {
            result[key] = value;
        }
        return result;
    }

    /**
     * 开始追踪
     */
    startTracking(workspaceRoot: string, sessionId?: string): void {
        if (this.isTracking) {
            this.logger.warn('Already tracking');
            return;
        }

        this.sessionId = sessionId || `session-${Date.now()}`;
        this.workspaceRoot = workspaceRoot;
        this.isTracking = true;
        this.changes.clear();
        this.pendingChanges = [];

        // 创建文件系统监控器
        const pattern = new vscode.RelativePattern(workspaceRoot, '**/*');
        this.fileSystemWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        
        // 监听文件变化（受标志控制）
        this.fileSystemWatcher.onDidChange((uri) => {
            if (this.getFlag('trackingEnabled') && this.getFlag('trackModifications')) {
                this.handleFileChange(uri, 'modify');
            }
        });

        this.fileSystemWatcher.onDidCreate((uri) => {
            if (this.getFlag('trackingEnabled') && this.getFlag('trackCreations')) {
                this.handleFileChange(uri, 'create');
            }
        });

        this.fileSystemWatcher.onDidDelete((uri) => {
            if (this.getFlag('trackingEnabled') && this.getFlag('trackDeletions')) {
                this.handleFileDelete(uri);
            }
        });

        this.logger.info(`Started tracking in ${workspaceRoot} (session: ${this.sessionId})`);
        this.emit('trackingStarted', { 
            workspaceRoot, 
            sessionId: this.sessionId,
            flags: this.getFlags()
        });
    }

    /**
     * 暂停追踪
     */
    pauseTracking(): void {
        if (!this.isTracking) return;
        this.isPaused = true;
        this.logger.info('Tracking paused');
        this.emit('trackingPaused', { sessionId: this.sessionId });
    }

    /**
     * 恢复追踪
     */
    resumeTracking(): void {
        if (!this.isTracking) return;
        this.isPaused = false;
        
        // 处理暂停期间积累的事件
        if (this.pendingChanges.length > 0) {
            this.logger.info(`Processing ${this.pendingChanges.length} pending changes`);
            this.processPendingChanges();
        }
        
        this.logger.info('Tracking resumed');
        this.emit('trackingResumed', { sessionId: this.sessionId });
    }

    /**
     * 停止追踪
     */
    stopTracking(): void {
        if (this.fileSystemWatcher) {
            this.fileSystemWatcher.dispose();
            this.fileSystemWatcher = null;
        }
        this.isTracking = false;
        this.isPaused = false;
        this.pendingChanges = [];
        this.logger.info('Stopped tracking');
        this.emit('trackingStopped', { sessionId: this.sessionId });
    }

    /**
     * 清除所有变更记录（不删除文件）
     */
    clearChanges(): void {
        this.changes.clear();
        this.logger.info('Changes cleared');
        this.emit('changesCleared', { sessionId: this.sessionId });
    }

    /**
     * 判断是否应该忽略文件
     */
    private shouldIgnore(relativePath: string): boolean {
        if (!relativePath) return true;
        
        // 检查文件大小
        // 实际检查需要在文件读取时进行
        
        const parts = relativePath.split(path.sep);
        for (const part of parts) {
            for (const pattern of this.config.ignorePatterns) {
                if (pattern.test(part)) {
                    return true;
                }
            }
        }
        
        // 检查二进制文件
        if (!this.getFlag('trackBinaryFiles')) {
            const binaryExtensions = ['.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc', '.o', '.a', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico'];
            const ext = path.extname(relativePath).toLowerCase();
            if (binaryExtensions.includes(ext)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 处理文件变化
     */
    private async handleFileChange(uri: vscode.Uri, type: 'create' | 'modify'): Promise<void> {
        if (this.isPaused) {
            this.pendingChanges.push({ uri, type: type as any });
            return;
        }

        if (!this.getFlag('recordChanges')) {
            return;
        }

        const filePath = uri.fsPath;
        const relativePath = path.relative(this.workspaceRoot, filePath);

        if (this.shouldIgnore(relativePath)) {
            return;
        }

        // 检查文件大小
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > this.config.maxFileSize) {
                this.logger.debug(`Skipping large file: ${relativePath} (${stat.size} bytes)`);
                return;
            }
        } catch (error) {
            // 文件可能已被删除
        }

        if (this.changes.has(filePath)) {
            const existing = this.changes.get(filePath)!;
            if (existing.type === 'delete') {
                existing.type = 'modify';
                existing.timestamp = Date.now();
                if (!existing.backup) {
                    existing.backup = await this.createBackup(filePath);
                }
                if (this.getFlag('emitEvents')) {
                    this.emit('fileChanged', { filePath, type: 'modify', sessionId: this.sessionId });
                }
                return;
            }
            existing.timestamp = Date.now();
            if (this.getFlag('emitEvents')) {
                this.emit('fileChanged', { filePath, type: existing.type, sessionId: this.sessionId });
            }
            return;
        }

        const backup = await this.createBackup(filePath);
        if (backup) {
            this.changes.set(filePath, {
                filePath,
                type,
                backup,
                timestamp: Date.now()
            });
            
            this.logger.info(`File ${type}: ${relativePath}`);
            if (this.getFlag('emitEvents') && this.getFlag('notifyOnChange')) {
                this.emit('fileChanged', { filePath, type, sessionId: this.sessionId });
            }
        }
    }

    /**
     * 处理文件删除
     */
    private async handleFileDelete(uri: vscode.Uri): Promise<void> {
        if (this.isPaused) {
            this.pendingChanges.push({ uri, type: vscode.FileChangeType.Deleted });
            return;
        }

        if (!this.getFlag('recordChanges') || !this.getFlag('trackDeletions')) {
            return;
        }

        const filePath = uri.fsPath;
        const relativePath = path.relative(this.workspaceRoot, filePath);

        if (this.shouldIgnore(relativePath)) {
            return;
        }

        if (this.changes.has(filePath)) {
            const existing = this.changes.get(filePath)!;
            if (existing.type === 'create') {
                this.changes.delete(filePath);
                this.logger.info(`Removed new file that was deleted: ${relativePath}`);
                if (this.getFlag('emitEvents')) {
                    this.emit('fileChanged', { filePath, type: 'removed', sessionId: this.sessionId });
                }
                return;
            }
            existing.type = 'delete';
            existing.timestamp = Date.now();
            if (this.getFlag('emitEvents')) {
                this.emit('fileChanged', { filePath, type: 'delete', sessionId: this.sessionId });
            }
            return;
        }

        const backup = await this.createBackup(filePath);
        if (backup) {
            this.changes.set(filePath, {
                filePath,
                type: 'delete',
                backup,
                timestamp: Date.now()
            });
            this.logger.info(`File deleted: ${relativePath}`);
            if (this.getFlag('emitEvents')) {
                this.emit('fileChanged', { filePath, type: 'delete', sessionId: this.sessionId });
            }
        }
    }

    /**
     * 创建文件备份
     */
    private async createBackup(filePath: string): Promise<FileBackup | undefined> {
        try {
            const uri = vscode.Uri.file(filePath);
            const stat = await vscode.workspace.fs.stat(uri);
            
            // 检查文件大小
            if (stat.size > this.config.maxFileSize) {
                return undefined;
            }
            
            const content = await vscode.workspace.fs.readFile(uri);
            return {
                filePath,
                originalContent: Buffer.from(content),
                timestamp: Date.now(),
                isNewFile: false
            };
        } catch (error) {
            // 文件不存在，说明是新文件
            return {
                filePath,
                originalContent: Buffer.from(''),
                timestamp: Date.now(),
                isNewFile: true
            };
        }
    }

    /**
     * 处理待处理的事件
     */
    private processPendingChanges(): void {
        const fileMap = new Map<string, vscode.FileChangeEvent>();
        for (const event of this.pendingChanges) {
            fileMap.set(event.uri.fsPath, event);
        }
        
        this.pendingChanges = [];
        
        for (const [filePath, event] of fileMap) {
            this.checkFileStateAndRecord(filePath);
        }
    }

    /**
     * 检查文件实际状态并记录
     */
    private async checkFileStateAndRecord(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        const relativePath = path.relative(this.workspaceRoot, filePath);
        
        if (this.shouldIgnore(relativePath)) {
            return;
        }

        try {
            await vscode.workspace.fs.stat(uri);
            const existing = this.changes.get(filePath);
            if (existing) {
                existing.timestamp = Date.now();
            } else {
                const backup = await this.createBackup(filePath);
                if (backup) {
                    this.changes.set(filePath, {
                        filePath,
                        type: 'modify',
                        backup,
                        timestamp: Date.now()
                    });
                }
            }
        } catch (error) {
            const existing = this.changes.get(filePath);
            if (existing) {
                existing.type = 'delete';
                existing.timestamp = Date.now();
            } else {
                const backup = await this.createBackup(filePath);
                if (backup) {
                    this.changes.set(filePath, {
                        filePath,
                        type: 'delete',
                        backup,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }

    /**
     * 回滚所有变更
     */
    async rollbackChanges(): Promise<{ success: boolean; errors: string[] }> {
        if (!this.getFlag('allowRollback')) {
            return { success: false, errors: ['Rollback is disabled by flag'] };
        }

        const errors: string[] = [];
        const changes = Array.from(this.changes.values());

        this.logger.info(`Rolling back ${changes.length} changes`);

        for (const change of changes.reverse()) {
            try {
                const uri = vscode.Uri.file(change.filePath);
                
                if (change.type === 'delete') {
                    if (change.backup && !change.backup.isNewFile) {
                        await vscode.workspace.fs.writeFile(uri, change.backup.originalContent);
                        this.logger.info(`Restored deleted file: ${change.filePath}`);
                    }
                } else if (change.type === 'create') {
                    try {
                        await vscode.workspace.fs.delete(uri);
                        this.logger.info(`Removed new file: ${change.filePath}`);
                    } catch (error) {
                        // 文件可能已经被删除
                    }
                } else if (change.type === 'modify') {
                    if (change.backup) {
                        await vscode.workspace.fs.writeFile(uri, change.backup.originalContent);
                        this.logger.info(`Restored modified file: ${change.filePath}`);
                    }
                }
            } catch (error) {
                errors.push(`Failed to rollback ${change.filePath}: ${error}`);
                this.logger.error(`Rollback failed for ${change.filePath}:`, error);
            }
        }

        this.changes.clear();
        this.emit('rollbackCompleted', { success: errors.length === 0, errors, sessionId: this.sessionId });

        return { success: errors.length === 0, errors };
    }

    /**
     * 提交变更
     */
    commitChanges(): void {
        if (!this.getFlag('allowCommit')) {
            this.logger.warn('Commit is disabled by flag');
            return;
        }

        const changes = Array.from(this.changes.values());
        this.logger.info(`Committing ${changes.length} changes`);
        this.changes.clear();
        this.emit('commitCompleted', { changes, sessionId: this.sessionId });
    }

    /**
     * 获取所有变更
     */
    getChanges(): FileChange[] {
        return Array.from(this.changes.values());
    }

    /**
     * 获取变更统计
     */
    getChangeStats(): { created: number; modified: number; deleted: number } {
        const stats = { created: 0, modified: 0, deleted: 0 };
        for (const change of this.changes.values()) {
            if (change.type === 'create') stats.created++;
            else if (change.type === 'modify') stats.modified++;
            else if (change.type === 'delete') stats.deleted++;
        }
        return stats;
    }

    /**
     * 获取变更摘要
     */
    getChangeSummary(): string {
        const stats = this.getChangeStats();
        const parts = [];
        if (stats.created > 0) parts.push(`📄 创建 ${stats.created} 个文件`);
        if (stats.modified > 0) parts.push(`✏️ 修改 ${stats.modified} 个文件`);
        if (stats.deleted > 0) parts.push(`🗑️ 删除 ${stats.deleted} 个文件`);
        return parts.join('、') || '无修改';
    }

    /**
     * 获取单个文件的差异
     */
    getFileDiff(filePath: string): { original: string; current: string } | null {
        const change = this.changes.get(filePath);
        if (!change || !change.backup) {
            return null;
        }

        // 读取当前内容
        let currentContent = '';
        try {
            const uri = vscode.Uri.file(filePath);
            // 使用同步读取或异步
            // 这里返回空，实际使用时需要异步
        } catch (error) {
            // 文件已被删除
        }

        return {
            original: change.backup.originalContent.toString('utf8'),
            current: currentContent
        };
    }
}