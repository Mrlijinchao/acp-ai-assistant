// src/tools/index.ts

import * as vscode from 'vscode';
import { VirtualFileSystem } from '../edits/VirtualFileSystem';
import { EventEmitter } from 'events';
import { ToolApprovalManager } from './ToolApprovalManager';
import { Logger } from '../utils/logger'
import { FileBackupManager } from './FileBackupManager';
import * as path from 'path';  // 添加 path 导入
import { CommandAnalyzer, FileOperation } from './CommandAnalyzer';

// 工具接口定义
export interface Tool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    execute(params: any): Promise<any>;
}

// 辅助函数：将文件路径转换为 VSCode URI
function resolveUri(filePath: string): vscode.Uri {
    // 如果是绝对路径，直接转换为 URI
    if (filePath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(filePath)) {
        return vscode.Uri.file(filePath);
    }
    
    // 相对路径，基于工作区根目录解析
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        // 使用 VSCode 的 joinPath 方法
        return vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
    }
    
    // 没有工作区，当作绝对路径处理
    return vscode.Uri.file(filePath);
}


// 辅助函数：判断是否是绝对路径（跨平台）
function isAbsolutePath(filePath: string): boolean {
    // Windows: C:\ 或 C:/
    if (/^[A-Za-z]:[/\\]/.test(filePath)) {
        return true;
    }
    // Unix: / 开头
    if (filePath.startsWith('/')) {
        return true;
    }
    // Windows UNC: \\server\share
    if (filePath.startsWith('\\\\')) {
        return true;
    }
    return false;
}


// 辅助函数：智能路径解析（纯 VSCode API）
function resolvePath(filePath: string): vscode.Uri {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceRoot = workspaceFolders?.[0]?.uri;
    
    if (isAbsolutePath(filePath)) {
        // 绝对路径：直接转换为 URI
        return vscode.Uri.file(filePath);
    } else if (workspaceRoot) {
        // 相对路径：基于工作空间根目录拼接
        // 使用 vscode.Uri.joinPath 处理路径拼接（自动处理分隔符）
        return vscode.Uri.joinPath(workspaceRoot, filePath);
    } else {
        // 没有打开的工作区，尝试作为绝对路径处理
        return vscode.Uri.file(filePath);
    }
}


/**
 * 读取文件工具 - 支持虚拟文件系统
 */
class ReadFileTool implements Tool {
    name = 'read_file_mcp';
    description = 'Read the contents of a file. Supports relative paths (relative to workspace root) or absolute paths. Optionally read only a portion using offset and limit.';
    inputSchema = {
        type: 'object' as const,
        properties: {
            path: { 
                type: 'string', 
                description: 'File path. Can be relative to workspace root (e.g., "package.json") or absolute (e.g., "C:/config/settings.json")' 
            },
            offset: { 
                type: 'integer', 
                description: 'Line number to start reading from (0-indexed). Default: 0.',
                default: 0
            },
            limit: { 
                type: 'integer', 
                description: 'Maximum number of lines to read. If omitted, reads all lines from offset.'
            }
        },
        required: ['path']
    };

    async execute(params: { path: string; offset?: number; limit?: number }): Promise<string> {
        try {
            const fileUri = resolvePath(params.path);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const decodedContent = Buffer.from(content).toString('utf8');
            
            // 如果提供了 offset 或 limit，则进行行切片
            if (params.offset !== undefined || params.limit !== undefined) {
                const lines = decodedContent.split('\n');
                const startLine = params.offset ?? 0;
                const endLine = params.limit ? startLine + params.limit : lines.length;
                
                // 确保索引不越界
                const safeStart = Math.max(0, Math.min(startLine, lines.length));
                const safeEnd = Math.max(safeStart, Math.min(endLine, lines.length));
                
                return lines.slice(safeStart, safeEnd).join('\n');
            }
            
            return decodedContent;
        } catch (error: any) {
            throw new Error(`Failed to read file: ${error.message}`);
        }
    }
}



class WriteFileTool implements Tool {
    name = 'write_file_mcp';
    description = '写入文件内容（自动备份）';
    inputSchema = {
        type: 'object' as const,
        properties: {
            path: { 
                type: 'string', 
                description: '文件路径' 
            },
            content: { 
                type: 'string', 
                description: '文件内容' 
            }
        },
        required: ['path', 'content']
    };

    private logger: Logger;
    private backupManager: FileBackupManager | null = null;

    constructor(backupManager: FileBackupManager | null = null) {
        this.logger = new Logger('WriteFileTool');
        this.backupManager = backupManager;
    }

    async execute(params: { path: string; content: string }): Promise<any> {
        // const uri = resolveUri(params.path);
        const uri = resolvePath(params.path);
        const filePath = uri.fsPath;
        console.log("filePath: " + filePath);
        // ⭐ 执行前备份
        let backedUp = false;
        if (this.backupManager) {
            const result = await this.backupManager.backupFile(filePath);
            backedUp = result.success;
            if (result.success) {
                this.logger.info(`Backed up: ${filePath}`);
            }
        }

        try {
            const encoder = new TextEncoder();
            const dirUri = vscode.Uri.joinPath(uri, '..');
            await vscode.workspace.fs.createDirectory(dirUri);
            await vscode.workspace.fs.writeFile(uri, encoder.encode(params.content));


            await this.backupManager?.detectChanges();

            return {
                success: true,
                message: `文件已写入: ${filePath}`,
                filePath: filePath,
                backedUp: backedUp
            };
        } catch (error: any) {
            // 失败则清理备份
            if (this.backupManager && backedUp) {
                await this.backupManager.removeBackup(filePath);
            }
            throw new Error(`Failed to write file: ${error.message}`);
        }
    }
}


/**
 * 列出文件工具 - 使用 VSCode API
 */
class ListFilesTool implements Tool {
    name = 'list_files_mcp';
    description = '列出目录中的文件';
    inputSchema = {
        type: 'object' as const,
        properties: {
            directory: { 
                type: 'string', 
                description: '目录路径（支持相对路径和绝对路径）' 
            },
            recursive: { 
                type: 'boolean', 
                description: '是否递归列出' 
            }
        },
        required: ['directory']
    };

    async execute(params: { directory: string; recursive?: boolean }): Promise<any[]> {
        const uri = resolveUri(params.directory);
        const files: any[] = [];
        
        const readDir = async (dirUri: vscode.Uri, relativePath: string = '') => {
            try {
                const entries = await vscode.workspace.fs.readDirectory(dirUri);
                for (const [name, type] of entries) {
                    const fullUri = vscode.Uri.joinPath(dirUri, name);
                    const relPath = relativePath ? `${relativePath}/${name}` : name;
                    
                    files.push({
                        name: name,
                        path: fullUri.fsPath,
                        relativePath: relPath,
                        type: type === vscode.FileType.File ? 'file' : 
                              type === vscode.FileType.Directory ? 'directory' : 'other',
                        size: type === vscode.FileType.File ? (await vscode.workspace.fs.stat(fullUri)).size : undefined
                    });
                    
                    if (type === vscode.FileType.Directory && params.recursive) {
                        await readDir(fullUri, relPath);
                    }
                }
            } catch (error: any) {
                throw new Error(`Failed to read directory: ${error.message}`);
            }
        };
        
        await readDir(uri);
        return files;
    }
}



class ExecuteCommandTool implements Tool {
    name = 'execute_command_mcp';
    description = '执行终端命令（自动分析并备份可能被修改的文件）';
    inputSchema = {
        type: 'object' as const,
        properties: {
            command: { 
                type: 'string', 
                description: '要执行的命令' 
            },
            cwd: {
                type: 'string',
                description: '工作目录（可选）'
            }
        },
        required: ['command']
    };

    private logger: Logger;
    private backupManager: FileBackupManager | null = null;

    constructor(backupManager: FileBackupManager | null = null) {
        this.logger = new Logger('ExecuteCommandTool');
        this.backupManager = backupManager;
    }

    async execute(params: { command: string; cwd?: string }): Promise<any> {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        try {
            let cwd = params.cwd;
            if (!cwd) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    cwd = workspaceFolders[0].uri.fsPath;
                } else {
                    cwd = process.cwd();
                }
            }

            // ⭐ 1. 使用 CommandAnalyzer 分析命令
            const analyzer = new CommandAnalyzer(cwd);
            const operations = analyzer.analyze(params.command);
            
            console.log("cwd: " + cwd);
            console.log("params.command: " + params.command);
            console.log(operations);

            // ⭐ 2. 从操作中提取文件路径
            const filePaths: string[] = [];
            for (const op of operations) {
                if (op.sourcePath && op.sourcePath !== '.' && op.sourcePath !== '') {
                    filePaths.push(op.sourcePath);
                }
                if (op.targetPath && op.targetPath !== '.' && op.targetPath !== '') {
                    filePaths.push(op.targetPath);
                }
            }

            // 去重
            const uniquePaths = [...new Set(filePaths)];
            this.logger.info(`Extracted ${uniquePaths.length} file paths from command`);

            // ⭐ 3. 备份这些文件
            const backupResults: any[] = [];
            if (this.backupManager) {
                for (const filePath of uniquePaths) {
                    console.log("ExecuteCommandTool backup: " + filePath);
                    const result = await this.backupManager.backupFile(filePath);
                    backupResults.push(result);
                    this.logger.info(`Backed up: ${filePath} (${result.success ? 'success' : 'failed'})`);
                }
            }

            // ⭐ 4. 执行命令
            this.logger.info(`Executing: ${params.command} in ${cwd}`);
            const isWindows = process.platform === 'win32';
            const { stdout, stderr } = await execAsync(params.command, {
                cwd: cwd,
                shell: isWindows ? 'cmd.exe' : '/bin/sh',
                windowsHide: true,
                maxBuffer: 1024 * 1024 * 100
            });

            // ⭐ 5. 检测实际变化
            let actualChanges: any[] = [];
            if (this.backupManager) {
                actualChanges = await this.backupManager.detectChanges();
                this.logger.info(`Detected ${actualChanges.filter(c => c.type !== 'unchanged').length} changes`);
            }

            const changedFiles = actualChanges.filter(c => c.type !== 'unchanged');

            return {
                success: true,
                stdout: stdout,
                stderr: stderr,
                command: params.command,
                cwd: cwd,
                operations: operations,
                backupResults: backupResults,
                actualChanges: changedFiles,
                hasChanges: changedFiles.length > 0,
                message: changedFiles.length > 0 ? 
                    `⚠️ 检测到 ${changedFiles.length} 个文件变化` : 
                    '没有检测到文件变化'
            };
        } catch (error: any) {
            if (this.backupManager) {
                await this.backupManager.cleanupFailedBackups();
            }
            throw new Error(`Command failed: ${error.message}`);
        }
    }
}



/**
 * 获取当前文件工具
 */
class GetCurrentFileTool implements Tool {
    name = 'get_current_file_mcp';
    description = '获取当前打开的文件信息';
    inputSchema = {
        type: 'object' as const,
        properties: {},
        required: []
    };

    async execute(): Promise<{ path: string; content: string; selection: string; lineCount: number }> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor');
        }
        
        const document = editor.document;
        const selection = editor.selection;
        const selectedText = document.getText(selection);
        
        return {
            path: getRelativePath(document.uri),
            content: document.getText(),
            selection: selectedText,
            lineCount: document.lineCount
        };
    }
}

/**
 * 获取工作区信息工具
 */
class GetWorkspaceInfoTool implements Tool {
    name = 'get_workspace_info_mcp';
    description = '获取当前工作区信息';
    inputSchema = {
        type: 'object' as const,
        properties: {},
        required: []
    };

    async execute(): Promise<{ rootPath: string; name: string; hasWorkspace: boolean; folders: string[] }> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return {
                rootPath: '',
                name: '',
                hasWorkspace: false,
                folders: []
            };
        }
        
        return {
            rootPath: workspaceFolders[0].uri.fsPath,
            name: workspaceFolders[0].name,
            hasWorkspace: true,
            folders: workspaceFolders.map(f => f.uri.fsPath)
        };
    }
}


/**
 * ToolManager - 管理所有工具
 */
export class ToolManager extends EventEmitter {
    private tools: Map<string, Tool> = new Map();
    private mcpServer: any = null;
    private port: number;
    private approvalManager: ToolApprovalManager;
    private backupManager: FileBackupManager | null = null;

    constructor(port: number = 9876, backupManager: FileBackupManager | null = null) {
        super();
        this.port = port;
        this.approvalManager = new ToolApprovalManager();
        this.backupManager = backupManager;
    }

    getPort(): number {
        return this.port;
    }

    getApprovalManager(): ToolApprovalManager {
        return this.approvalManager;
    }

    async start(): Promise<void> {
        // 注册所有工具
        this.registerTool(new ReadFileTool());
        // this.registerTool(new WriteFileTool());
        this.registerTool(new WriteFileTool(this.backupManager));
        this.registerTool(new ListFilesTool());
        // this.registerTool(new ExecuteCommandTool());
        this.registerTool(new ExecuteCommandTool(this.backupManager)); 
        this.registerTool(new GetCurrentFileTool());
        this.registerTool(new GetWorkspaceInfoTool());
        
        // 启动 MCP Server
        const { MCPServer } = await import('./mcp/MCPServer');
        this.mcpServer = new MCPServer(this.port, this.tools, this);
        await this.mcpServer.start();
        
        console.log(`MCP Server started on port ${this.port}`);
    }

    registerTool(tool: Tool): void {
        this.tools.set(tool.name, tool);
        this.emit('toolRegistered', tool.name);
    }

    getTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    async executeTool(name: string, params: any): Promise<any> {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool not found: ${name}`);
        }

        // 请求用户审批（如果需要）
        const approved = await this.approvalManager.requestApproval(name, params);
        
        if (!approved) {
            throw new Error(`Tool execution rejected by user: ${name}`);
        }

        // 执行工具
        try {
            const result = await tool.execute(params);
            return result;
        } catch (error: any) {
            throw new Error(`Tool execution failed: ${error.message}`);
        }
    }

    stop(): void {
        // 取消所有待审批的调用
        if (this.approvalManager) {
            this.approvalManager.cancelAllPending();
        }
        if (this.mcpServer) {
            this.mcpServer.stop();
            this.mcpServer = null;
        }
    }
}