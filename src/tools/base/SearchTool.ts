import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';
import { FileSystemTool } from './FileSystemTool';

export class SearchTool {
    private logger: Logger;
    private fileSystemTool: FileSystemTool;

    constructor() {
        this.logger = new Logger('SearchTool');
        this.fileSystemTool = new FileSystemTool();
    }

    async searchFiles(pattern: string, exclude?: string): Promise<string[]> {
        return await this.fileSystemTool.searchFiles(pattern, exclude);
    }

    async searchContent(query: string, filePattern: string = '**/*', caseSensitive: boolean = false): Promise<any[]> {
        return await this.fileSystemTool.searchContent(query, filePattern, caseSensitive);
    }

    async getProjectStructure(depth: number = 2): Promise<any> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return null;
        
        const structure = await this.buildTree(workspaceRoot, depth);
        return structure;
    }

    private async buildTree(dirPath: string, maxDepth: number, currentDepth: number = 0): Promise<any> {
        if (currentDepth >= maxDepth) return null;
        
        const entries = await this.fileSystemTool.listDirectory(dirPath, false);
        const result: any = {
            name: dirPath.split(/[/\\]/).pop(),
            path: dirPath,
            type: 'directory',
            children: []
        };
        
        for (const entry of entries) {
            const entryPath = `${dirPath}/${entry}`;
            if (entry.endsWith('/')) {
                const subDir = await this.buildTree(entryPath.slice(0, -1), maxDepth, currentDepth + 1);
                if (subDir) result.children.push(subDir);
            } else {
                result.children.push({
                    name: entry,
                    path: entryPath,
                    type: 'file'
                });
            }
        }
        
        return result;
    }
}