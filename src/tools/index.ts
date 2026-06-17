import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { ToolApprovalManager } from './ToolApprovalManager';

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

export class ToolManager extends EventEmitter {
    private tools: Map<string, Tool> = new Map();
    private mcpServer: any = null;
    private port: number;
    private approvalManager: ToolApprovalManager;

    constructor(port: number = 9876) {
        super();
        this.port = port;
        this.approvalManager = new ToolApprovalManager();
    }

    getPort(): number {
        return this.port;
    }

    getApprovalManager(): ToolApprovalManager {
        return this.approvalManager;
    }

    async start(): Promise<void> {
        // 注册内置工具
        this.registerTool(new ReadFileTool());
        this.registerTool(new WriteFileTool());
        this.registerTool(new ListFilesTool());
        this.registerTool(new ExecuteCommandTool());
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

        // 请求用户审批
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

// 工具实现示例
// tools/index.ts

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

class ReadFileTool implements Tool {
    name = 'read_file_mcp';
    description = 'Read the contents of a file. Supports relative paths (relative to workspace root) or absolute paths.';
    inputSchema = {
        type: 'object' as const,
        properties: {
            path: { 
                type: 'string', 
                description: 'File path. Can be relative to workspace root (e.g., "package.json") or absolute (e.g., "C:/config/settings.json")' 
            }
        },
        required: ['path']
    };

    async execute(params: { path: string }): Promise<string> {
        try {
            const fileUri = resolvePath(params.path);
            const content = await vscode.workspace.fs.readFile(fileUri);
            return Buffer.from(content).toString('utf8');
        } catch (error: any) {
            throw new Error(`Failed to read file: ${error.message}`);
        }
    }
}

class ListFilesTool implements Tool {
    name = 'list_files_mcp';
    description = 'List files in a directory. Use "." for workspace root, or relative/absolute paths.';
    inputSchema = {
        type: 'object' as const,
        properties: {
            directory: { 
                type: 'string', 
                description: 'Directory path. Use "." for workspace root, or "src", or "C:/projects"' 
            },
            recursive: { 
                type: 'boolean', 
                description: 'Whether to list recursively' 
            }
        },
        required: ['directory']
    };

    async execute(params: { directory: string; recursive?: boolean }): Promise<any[]> {
        try {
            let dirUri: vscode.Uri;
            
            // 处理 "." 作为工作空间根目录
            if (params.directory === '.') {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders?.[0]) {
                    throw new Error('No workspace folder open. Use absolute path instead.');
                }
                dirUri = workspaceFolders[0].uri;
            } else {
                dirUri = resolvePath(params.directory);
            }
            
            const files: any[] = [];
            
            const readDir = async (dir: vscode.Uri, relativePath: string = '') => {
                const entries = await vscode.workspace.fs.readDirectory(dir);
                for (const [name, type] of entries) {
                    const fullUri = vscode.Uri.joinPath(dir, name);
                    const relPath = relativePath ? `${relativePath}/${name}` : name;
                    
                    files.push({
                        name: name,
                        path: fullUri.fsPath,
                        relativePath: relPath,
                        type: type === vscode.FileType.File ? 'file' : 'directory'
                    });
                    
                    if (type === vscode.FileType.Directory && params.recursive) {
                        await readDir(fullUri, relPath);
                    }
                }
            };
            
            await readDir(dirUri);
            return files;
        } catch (error: any) {
            throw new Error(`Failed to list files: ${error.message}`);
        }
    }
}

class WriteFileTool implements Tool {
    name = 'write_file_mcp';
    description = 'Write content to a file. Supports relative paths (relative to workspace root) or absolute paths.';
    inputSchema = {
        type: 'object' as const,
        properties: {
            path: { 
                type: 'string', 
                description: 'File path. Can be relative to workspace root (e.g., "output.txt") or absolute (e.g., "C:/data/result.txt")' 
            },
            content: { 
                type: 'string', 
                description: 'Content to write' 
            }
        },
        required: ['path', 'content']
    };

    async execute(params: { path: string; content: string }): Promise<{ success: boolean; path: string }> {
        try {
            const fileUri = resolvePath(params.path);
            
            // 确保目录存在
            const dirUri = vscode.Uri.joinPath(fileUri, '..');
            await vscode.workspace.fs.createDirectory(dirUri);
            
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(fileUri, encoder.encode(params.content));
            
            return { success: true, path: fileUri.fsPath };
        } catch (error: any) {
            throw new Error(`Failed to write file: ${error.message}`);
        }
    }
}

class ExecuteCommandTool implements Tool {
    name = 'execute_command_mcp';
    description = 'Execute a terminal command. Runs in the workspace root directory if available.';
    inputSchema = {
        type: 'object' as const,
        properties: {
            command: { 
                type: 'string', 
                description: 'Command to execute' 
            }
        },
        required: ['command']
    };

    async execute(params: { command: string }): Promise<string> {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        try {
            // 获取工作空间根目录作为执行目录
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            
            // 跨平台命令适配
            let command = params.command;
            const isWindows = process.platform === 'win32';
            
            if (command === 'pwd') {
                command = isWindows ? 'cd' : 'pwd';
            } else if (command === 'ls') {
                command = isWindows ? 'dir' : 'ls';
            }
            
            const { stdout, stderr } = await execAsync(command, { cwd });
            return stdout || stderr || 'Command executed successfully';
        } catch (error: any) {
            throw new Error(`Command failed: ${error.message}`);
        }
    }
}

class GetWorkspaceInfoTool implements Tool {
    name = 'get_workspace_info_mcp';
    description = 'Get current workspace information (root path and name)';
    inputSchema = {
        type: 'object' as const,
        properties: {},
        required: []
    };

    async execute(): Promise<{ rootPath: string; name: string; hasWorkspace: boolean }> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return {
                rootPath: '',
                name: '',
                hasWorkspace: false
            };
        }
        
        return {
            rootPath: workspaceFolders[0].uri.fsPath,
            name: workspaceFolders[0].name,
            hasWorkspace: true
        };
    }
}

class GetCurrentFileTool implements Tool {
    name = 'get_current_file_mcp';
    description = 'Get the currently open file in VSCode editor';
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
        
        // 获取相对于工作区的路径
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let relativePath = document.uri.fsPath;
        if (workspaceFolders?.[0]) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            if (document.uri.fsPath.startsWith(workspaceRoot)) {
                relativePath = document.uri.fsPath.substring(workspaceRoot.length + 1);
            }
        }
        
        return {
            path: relativePath,
            content: document.getText(),
            selection: selectedText,
            lineCount: document.lineCount
        };
    }
}