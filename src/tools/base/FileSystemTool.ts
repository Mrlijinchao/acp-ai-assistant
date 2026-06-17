import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { Logger } from '../../utils/logger';

export class FileSystemTool {
    private logger: Logger;
    private workspaceRoot: string = '';
    private workspaceRoots: string[] = [];  // 支持多根工作区

    constructor() {
        this.logger = new Logger('FileSystemTool');
        this.updateWorkspaceRoots();
        
        // 监听工作区变化
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            this.updateWorkspaceRoots();
        });
    }

    private updateWorkspaceRoots(): void {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            this.workspaceRoots = folders.map(f => f.uri.fsPath);
            this.workspaceRoot = this.workspaceRoots[0];
            this.logger.info(`Workspace roots: ${this.workspaceRoots.join(', ')}`);
        } else {
            this.workspaceRoots = [];
            this.workspaceRoot = '';
            this.logger.info('No workspace open');
        }
    }

    // 检查路径是否在工作区内
    private isPathInWorkspace(filePath: string): boolean {
        if (this.workspaceRoots.length === 0) {
            return false;
        }
        
        const resolvedPath = path.resolve(filePath);
        
        for (const root of this.workspaceRoots) {
            const relativePath = path.relative(root, resolvedPath);
            // 如果不是相对路径（即路径不在 root 下），并且没有返回 ".."
            if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
                return true;
            }
        }
        return false;
    }

    // 确保路径在工作区内，否则抛出错误
    private assertPathInWorkspace(filePath: string): string {
        const fullPath = this.resolvePath(filePath);
        
        if (!this.isPathInWorkspace(fullPath)) {
            const errorMsg = `Access denied: Path "${filePath}" is outside the current workspace. Only files within the workspace can be accessed.`;
            this.logger.warn(errorMsg);
            throw new Error(errorMsg);
        }
        
        return fullPath;
    }

    async readFile(filePath: string): Promise<string> {
        const fullPath = this.assertPathInWorkspace(filePath);
        this.logger.info(`Reading file: ${fullPath}`);
        
        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            return content;
        } catch (error) {
            throw new Error(`Failed to read file: ${filePath} - ${error}`);
        }
    }

    async writeFile(filePath: string, content: string): Promise<void> {
        const fullPath = this.assertPathInWorkspace(filePath);
        this.logger.info(`Writing file: ${fullPath}`);
        
        // 确保目录在工作区内
        const dirPath = path.dirname(fullPath);
        this.assertPathInWorkspace(dirPath);
        
        await fs.mkdir(dirPath, { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
    }

    async createDirectory(dirPath: string, recursive: boolean = true): Promise<void> {
        const fullPath = this.assertPathInWorkspace(dirPath);
        await fs.mkdir(fullPath, { recursive });
        this.logger.info(`Directory created: ${fullPath}`);
    }

    async deleteFile(filePath: string, force: boolean = false): Promise<void> {
        const fullPath = this.assertPathInWorkspace(filePath);
        
        if (!force) {
            const confirm = await vscode.window.showWarningMessage(
                `Delete ${filePath}?`,
                { modal: true },
                'Yes',
                'No'
            );
            if (confirm !== 'Yes') return;
        }
        
        await fs.rm(fullPath, { recursive: true, force: true });
        this.logger.info(`Deleted: ${fullPath}`);
    }

    async listDirectory(dirPath: string, recursive: boolean = false): Promise<string[]> {
        const fullPath = this.assertPathInWorkspace(dirPath);
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        
        const result: string[] = [];
        for (const entry of entries) {
            const entryPath = path.join(fullPath, entry.name);
            if (entry.isDirectory() && recursive) {
                const subEntries = await this.listDirectory(entryPath, true);
                result.push(entry.name + '/', ...subEntries.map(s => entry.name + '/' + s));
            } else {
                result.push(entry.name);
            }
        }
        return result;
    }

    async moveFile(source: string, destination: string): Promise<void> {
        const fullSource = this.assertPathInWorkspace(source);
        const fullDest = this.assertPathInWorkspace(destination);
        
        await fs.rename(fullSource, fullDest);
        this.logger.info(`Moved: ${source} -> ${destination}`);
    }

    async searchFiles(pattern: string, exclude?: string): Promise<string[]> {
        if (this.workspaceRoots.length === 0) {
            throw new Error('No workspace open');
        }
        
        const files = await glob(pattern, {
            cwd: this.workspaceRoot,
            ignore: exclude ? [exclude] : ['node_modules/**'],
            absolute: true
        });
        
        // 只返回工作区内的文件
        return files.filter(f => this.isPathInWorkspace(f));
    }

    async searchContent(query: string, filePattern: string = '**/*', caseSensitive: boolean = false): Promise<Array<{ file: string; line: number; content: string }>> {
        const files = await this.searchFiles(filePattern);
        const results: Array<{ file: string; line: number; content: string }> = [];
        const regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
        
        for (const file of files) {
            try {
                const content = await this.readFile(file);
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        results.push({
                            file: path.relative(this.workspaceRoot, file),
                            line: i + 1,
                            content: lines[i].trim()
                        });
                    }
                }
            } catch (error) {
                this.logger.warn(`Failed to search in ${file}:`, error);
            }
        }
        
        return results;
    }

    async getFileInfo(filePath: string): Promise<any> {
        const fullPath = this.assertPathInWorkspace(filePath);
        const stat = await fs.stat(fullPath);
        return {
            name: path.basename(fullPath),
            path: fullPath,
            size: stat.size,
            created: stat.birthtime,
            modified: stat.mtime,
            isDirectory: stat.isDirectory(),
            isFile: stat.isFile(),
            inWorkspace: true
        };
    }

    async getWorkspaceInfo(): Promise<any> {
        return {
            roots: this.workspaceRoots,
            rootCount: this.workspaceRoots.length,
            hasWorkspace: this.workspaceRoots.length > 0,
            currentRoot: this.workspaceRoot
        };
    }

    private resolvePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        
        if (this.workspaceRoot) {
            return path.resolve(this.workspaceRoot, filePath);
        }
        
        return path.resolve(filePath);
    }
}