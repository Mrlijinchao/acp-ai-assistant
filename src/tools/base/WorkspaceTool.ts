import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../../utils/logger';

export class WorkspaceTool {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('WorkspaceTool');
    }

    // 获取当前工作区信息
    getWorkspaceInfo(): any {
        const folders = vscode.workspace.workspaceFolders;
        
        if (!folders || folders.length === 0) {
            return {
                hasWorkspace: false,
                message: 'No workspace folder is open. Please open a workspace first.'
            };
        }
        
        const workspaceInfo = {
            hasWorkspace: true,
            roots: folders.map(folder => ({
                name: folder.name,
                path: folder.uri.fsPath,
                uri: folder.uri.toString()
            })),
            rootCount: folders.length,
            isMultiRoot: folders.length > 1
        };
        
        // 如果是单根工作区，添加当前工作区路径
        if (folders.length === 1) {
            return {
                ...workspaceInfo,
                currentWorkspace: folders[0].uri.fsPath,
                workspaceName: folders[0].name
            };
        }
        
        return workspaceInfo;
    }

    // 获取工作区中的文件列表（限制深度）
    async getWorkspaceFiles(depth: number = 3): Promise<string[]> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return [];
        
        const files: string[] = [];
        const fs = require('fs/promises');
        
        for (const folder of folders) {
            await this.collectFiles(folder.uri.fsPath, files, depth, 0);
        }
        
        return files;
    }

    private async collectFiles(dir: string, files: string[], maxDepth: number, currentDepth: number): Promise<void> {
        if (currentDepth >= maxDepth) return;
        
        const fs = require('fs/promises');
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            // 跳过隐藏目录和 node_modules
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }
            
            if (entry.isDirectory()) {
                await this.collectFiles(fullPath, files, maxDepth, currentDepth + 1);
            } else {
                files.push(fullPath);
            }
        }
    }

    // 获取当前打开的文件
    getCurrentOpenFile(): any {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return { hasActiveFile: false, message: 'No file is currently open' };
        }
        
        const document = editor.document;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        
        return {
            hasActiveFile: true,
            path: document.uri.fsPath,
            fileName: path.basename(document.uri.fsPath),
            languageId: document.languageId,
            isDirty: document.isDirty,
            isUntitled: document.isUntitled,
            relativePath: workspaceFolder ? 
                path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath) : 
                document.uri.fsPath,
            workspaceFolder: workspaceFolder?.name || null
        };
    }

    // 验证路径是否在工作区内
    isPathInWorkspace(filePath: string): boolean {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return false;
        
        const resolvedPath = path.resolve(filePath);
        
        for (const folder of folders) {
            const relativePath = path.relative(folder.uri.fsPath, resolvedPath);
            if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
                return true;
            }
        }
        
        return false;
    }
}