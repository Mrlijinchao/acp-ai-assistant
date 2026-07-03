// src/tools/FileBackupManager.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';

export interface FileBackup {
    filePath: string;
    backupPath: string;      // 备份文件存储位置
    originalContent: Buffer;
    timestamp: number;
    isNewFile: boolean;
    operationType: 'create' | 'modify' | 'delete' | 'rename';
}

export class FileBackupManager extends EventEmitter {
    private logger: Logger;
    private backups: Map<string, FileBackup> = new Map();
    private workspaceRoot: string;
    private backupDir: string;
    private sessionId: string;

    constructor(workspaceRoot: string) {
        super();
        this.logger = new Logger('FileBackupManager');
        this.workspaceRoot = workspaceRoot;
        this.sessionId = `session-${Date.now()}`;
        this.backupDir = path.join(workspaceRoot, '.vscode', 'acp-backups', this.sessionId);
        this.ensureBackupDir();
    }

    /**
     * ⭐ 确保备份目录存在
     */
    private ensureBackupDir(): void {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
            this.logger.info(`Backup directory created: ${this.backupDir}`);
        }
    }

    /**
     * ⭐ 备份单个文件
     */
    async backupFile(filePath: string): Promise<{ success: boolean; filePath: string; error?: string }> {
        try {
            console.log("filePath1: " + filePath);
            // 检查是否已经备份过
            if (this.backups.has(filePath)) {
                this.logger.debug(`File already backed up: ${filePath}`);
                return { success: true, filePath };
            }

            const uri = vscode.Uri.file(filePath);
            let isNewFile = false;
            let content: Buffer;

            try {
                console.log("filePath2: " + filePath);
                // 尝试读取文件内容
                const data = await vscode.workspace.fs.readFile(uri);
                content = Buffer.from(data);
            } catch (error) {
                console.log("filePath3: " + filePath);
                // 文件不存在，标记为新文件
                isNewFile = true;
                content = Buffer.from('');
                this.logger.debug(`File does not exist, treating as new: ${filePath}`);
            }

            // 生成备份文件名
            // const relativePath = path.relative(this.workspaceRoot, filePath);
            // const backupFileName = `${relativePath.replace(/[\/\\]/g, '_')}_${Date.now()}.backup`;
            // const backupPath = path.join(this.backupDir, backupFileName);
            const backupPath = this.getBackupPath(filePath, Date.now());

            // 如果文件存在，保存到备份
            if (!isNewFile) {
                console.log("filePath4: " + filePath);
                fs.writeFileSync(backupPath, content);
            }

            // 记录备份信息
            const backup: FileBackup = {
                filePath,
                backupPath: backupPath,
                originalContent: content,
                timestamp: Date.now(),
                isNewFile,
                operationType: 'modify' // 默认，后续可能更新
            };

            console.log("backupInfo: "+ backup)

            this.backups.set(filePath, backup);

            // ⭐⭐⭐ 这里触发 fileBackedUp 事件！
            this.emit('fileBackedUp', { 
                filePath, 
                isNewFile: backup.isNewFile,
                timestamp: Date.now()
            });

            return { success: true, filePath };
        } catch (error: any) {
            this.logger.error(`Backup failed for ${filePath}: ${error.message}`);
            return { success: false, filePath, error: error.message };
        }
    }


    /**
     * ⭐ 回滚所有变化 - 这里触发 rollbackCompleted
     */
    async rollbackAll(): Promise<{ success: boolean; errors: string[] }> {
        const errors: string[] = [];

        for (const [filePath, backup] of this.backups) {
            try {
                const uri = vscode.Uri.file(filePath);
                
                if (backup.isNewFile) {
                    // 新文件：删除
                    try {
                        await vscode.workspace.fs.delete(uri);
                        this.logger.info(`Deleted new file: ${filePath}`);
                    } catch (error) {
                        // 文件可能已被删除
                    }
                } else {
                    // 恢复原始内容
                    await vscode.workspace.fs.writeFile(uri, backup.originalContent);
                    this.logger.info(`Restored file: ${filePath}`);
                }
            } catch (error: any) {
                errors.push(`Failed to rollback ${filePath}: ${error.message}`);
            }
        }

        // 清理备份
        this.cleanup();

        const result = {
            success: errors.length === 0,
            errors
        };

        // ⭐⭐⭐ 这里触发 rollbackCompleted 事件！
        this.emit('rollbackCompleted', result);
        this.logger.info(`Rollback completed: ${result.success ? 'success' : 'failed'}`);

        return result;
    }

    /**
     * ⭐ 提交所有变化 - 这里触发 commitCompleted
     */
    commitAll(): void {
        const changes = Array.from(this.backups.values());
        this.logger.info(`Committing ${changes.length} changes`);
        
        // 清理备份，保留修改
        this.cleanup();

        // ⭐⭐⭐ 这里触发 commitCompleted 事件！
        this.emit('commitCompleted', { 
            changes: changes.map(b => ({
                filePath: b.filePath,
                type: b.isNewFile ? 'created' : 'modified'
            })),
            sessionId: this.sessionId 
        });
    }

     /**
     * ⭐ 批量备份文件
     */
    async backupFiles(filePaths: string[]): Promise<{ success: number; failed: number }> {

        let success = 0;
        let failed = 0;

        for (const filePath of filePaths) {
            const result = await this.backupFile(filePath);
            if (result.success) {
                success++;
            } else {
                failed++;
            }
        }

        return { success, failed };
    }

     /**
     * ⭐ 检测变化（会触发事件）
     */
    async detectChanges(): Promise<Array<{
        filePath: string;
        type: 'created' | 'modified' | 'deleted' | 'unchanged';
        backup?: FileBackup;
    }>> {
        const changes: Array<{
            filePath: string;
            type: 'created' | 'modified' | 'deleted' | 'unchanged';
            backup?: FileBackup;
        }> = [];

        for (const [filePath, backup] of this.backups) {
            const uri = vscode.Uri.file(filePath);
            
            try {
                const currentContent = await vscode.workspace.fs.readFile(uri);
                const currentBuffer = Buffer.from(currentContent);

                if (backup.isNewFile) {
                    changes.push({ filePath, type: 'created', backup });
                } else if (!currentBuffer.equals(backup.originalContent)) {
                    changes.push({ filePath, type: 'modified', backup });
                } else {
                    changes.push({ filePath, type: 'unchanged', backup });
                }
            } catch (error) {
                if (!backup.isNewFile) {
                    changes.push({ filePath, type: 'deleted', backup });
                }
            }
        }

        // ⭐ 只触发事件，不在这里调用 sendPendingChangesToUI
        const changedFiles = changes.filter(c => c.type !== 'unchanged');
        if (changedFiles.length > 0) {
            this.emit('fileChanged', {
                filePath: changedFiles[0].filePath,
                type: changedFiles[0].type,
                allChanges: changes  // 传递所有变化
            });
        }

        return changes;
    }

    /**
     * ⭐ 生成备份文件路径（带目录检查）
     */
    private getBackupPath(filePath: string, timestamp: number): string {
        // 确保目录存在
        this.ensureBackupDir();
        
        const relativePath = path.relative(this.workspaceRoot, filePath);
        // 替换路径分隔符为下划线，避免路径嵌套
        const safeFileName = relativePath.replace(/[\/\\:]/g, '_');
        const backupFileName = `${safeFileName}_${timestamp}.backup`
        const backupPath = path.join(this.backupDir, `${safeFileName}_${timestamp}.backup`);
        this.logger.info(`Backup created: ${filePath} -> ${backupFileName}`);
        return backupPath;
    }

    /**
     * ⭐ 只获取变化列表，不触发事件（用于 UI 查询）
     */
    async getChangesWithoutEvent(): Promise<Array<{
        filePath: string;
        type: 'created' | 'modified' | 'deleted' | 'unchanged';
    }>> {
        const changes: Array<{
            filePath: string;
            type: 'created' | 'modified' | 'deleted' | 'unchanged';
        }> = [];

        for (const [filePath, backup] of this.backups) {
            const uri = vscode.Uri.file(filePath);
            
            try {
                const currentContent = await vscode.workspace.fs.readFile(uri);
                const currentBuffer = Buffer.from(currentContent);

                if (backup.isNewFile) {
                    changes.push({ filePath, type: 'created' });
                } else if (!currentBuffer.equals(backup.originalContent)) {
                    changes.push({ filePath, type: 'modified' });
                } else {
                    changes.push({ filePath, type: 'unchanged' });
                }
            } catch (error) {
                if (!backup.isNewFile) {
                    changes.push({ filePath, type: 'deleted' });
                }
            }
        }

        return changes;
    }

    /**
     * 清理备份
     */
    private cleanup(): void {
        if (fs.existsSync(this.backupDir)) {
            try {
                fs.rmSync(this.backupDir, { recursive: true, force: true });
                this.logger.info(`Backup directory cleaned up: ${this.backupDir}`);
            } catch (error) {
                this.logger.error(`Failed to cleanup backup directory: ${error}`);
            }
        }
        this.backups.clear();

        // ⭐⭐⭐ 这里触发 cleanupCompleted 事件
        this.emit('cleanupCompleted', { 
            sessionId: this.sessionId,
            timestamp: Date.now()
        });
    }


    /**
     * ⭐ 移除单个文件的备份（用于操作失败时的清理）
     */
    async removeBackup(filePath: string): Promise<boolean> {
        const backup = this.backups.get(filePath);
        if (!backup) {
            return false;
        }

        try {
            // 删除备份文件
            if (fs.existsSync(backup.backupPath)) {
                fs.unlinkSync(backup.backupPath);
            }
            this.backups.delete(filePath);
            this.logger.info(`Removed backup for: ${filePath}`);
            return true;
        } catch (error) {
            this.logger.error(`Failed to remove backup for ${filePath}: ${error}`);
            return false;
        }
    }

    /**
     * ⭐ 批量移除备份
     */
    async removeBackups(filePaths: string[]): Promise<number> {
        let removed = 0;
        for (const filePath of filePaths) {
            if (await this.removeBackup(filePath)) {
                removed++;
            }
        }
        return removed;
    }

    /**
     * ⭐ 获取单个文件的备份
     */
    getBackup(filePath: string): FileBackup | undefined {
        return this.backups.get(filePath);
    }

    /**
     * ⭐ 获取备份的原始内容
     */
    getOriginalContent(filePath: string): string | null {
        const backup = this.backups.get(filePath);
        if (!backup) {
            return null;
        }
        return backup.originalContent.toString('utf8');
    }


     /**
     * ⭐ 清理失败的备份（命令执行失败时调用）
     */
    async cleanupFailedBackups(): Promise<void> {
        // ✅ 只清理备份文件，不删除目录
        if (fs.existsSync(this.backupDir)) {
            try {
                const files = fs.readdirSync(this.backupDir);
                for (const file of files) {
                    const filePath = path.join(this.backupDir, file);
                    fs.unlinkSync(filePath);
                }
                this.logger.info(`Failed backups cleaned up: ${this.backupDir}`);
            } catch (error) {
                this.logger.error(`Failed to cleanup backups: ${error}`);
            }
        }
        this.backups.clear();
        this.logger.info('Failed backups cleaned up');
    }


    /**
     * 获取所有备份的文件路径
     */
    getBackedUpFiles(): string[] {
        return Array.from(this.backups.keys());
    }

    /**
     * 获取备份统计
     */
    getStats(): { total: number; newFiles: number; existingFiles: number } {
        let newFiles = 0;
        let existingFiles = 0;

        for (const backup of this.backups.values()) {
            if (backup.isNewFile) {
                newFiles++;
            } else {
                existingFiles++;
            }
        }

        return {
            total: this.backups.size,
            newFiles,
            existingFiles
        };
    }

}