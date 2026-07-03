// src/tools/CommandAnalyzer.ts

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Logger } from '../utils/logger';

export interface FileOperation {
    type: 'create' | 'modify' | 'delete' | 'rename' | 'copy' | 'unknown';
    sourcePath?: string;
    targetPath?: string;
    operation: string;
    confidence: number;
    platform?: 'windows' | 'unix';
}

export class CommandAnalyzer {
    private logger: Logger;
    private workspaceRoot: string;
    private platform: 'windows' | 'unix';

    constructor(workspaceRoot: string) {
        this.logger = new Logger('CommandAnalyzer');
        this.workspaceRoot = workspaceRoot;
        this.platform = os.platform() === 'win32' ? 'windows' : 'unix';
        this.logger.info(`CommandAnalyzer initialized for platform: ${this.platform}`);
    }

    /**
     * ⭐ 分析命令，提取文件操作（跨平台）
     */
    analyze(command: string): FileOperation[] {
        const operations: FileOperation[] = [];

        // 检测平台
        const isWindows = this.platform === 'windows';
        const isPowerShell = this.isPowerShellCommand(command);

        this.logger.debug(`Analyzing command: ${command} (isWindows: ${isWindows}, isPowerShell: ${isPowerShell})`);

        // 1. 检查重定向（跨平台）
        const redirectOps = this.parseRedirects(command, isWindows);
        operations.push(...redirectOps);

        // 2. 检查常见命令（Windows + Unix）
        const commandOps = this.parseCommonCommands(command, isWindows, isPowerShell);
        operations.push(...commandOps);

        // 3. 检查管道操作
        const pipeOps = this.parsePipes(command, isWindows);
        operations.push(...pipeOps);

        // 4. 检查 PowerShell 特有操作
        if (isPowerShell) {
            const psOps = this.parsePowerShellCommands(command);
            operations.push(...psOps);
        }

        // 5. 检查 Windows 批处理特有操作
        if (isWindows && !isPowerShell) {
            const batchOps = this.parseBatchCommands(command);
            operations.push(...batchOps);
        }

        return operations;
    }

    /**
     * 检测是否是 PowerShell 命令
     */
    private isPowerShellCommand(command: string): boolean {
        const lowerCmd = command.toLowerCase();
        return lowerCmd.includes('powershell') || 
               lowerCmd.includes('pwsh') ||
               lowerCmd.startsWith('get-') ||
               lowerCmd.startsWith('set-') ||
               lowerCmd.startsWith('new-') ||
               lowerCmd.startsWith('remove-') ||
               lowerCmd.startsWith('copy-') ||
               lowerCmd.startsWith('move-') ||
               lowerCmd.startsWith('rename-');
    }

    /**
     * ⭐ 解析重定向操作（跨平台）
     */
    private parseRedirects(command: string, isWindows: boolean): FileOperation[] {
        const ops: FileOperation[] = [];
        
        // Windows 和 Unix 都支持 >, >>
        const redirectPattern = /([>|][>|]?)\s*([^\s]+)/g;
        let match;
        while ((match = redirectPattern.exec(command)) !== null) {
            // 跳过 Windows 的 >nul, >NUL
            if (match[2].toLowerCase() === 'nul') continue;
            
            const targetPath = this.resolvePath(match[2], isWindows);
            if (targetPath) {
                ops.push({
                    type: 'modify',
                    targetPath,
                    operation: command,
                    confidence: 0.9,
                    platform: isWindows ? 'windows' : 'unix'
                });
            }
        }
        return ops;
    }

    /**
     * ⭐ 解析常见命令（跨平台）
     */
    private parseCommonCommands(command: string, isWindows: boolean, isPowerShell: boolean): FileOperation[] {
        const ops: FileOperation[] = [];
        const parts = this.splitCommand(command, isWindows);
        if (parts.length === 0) return ops;

        const cmd = parts[0].toLowerCase();
        
        // 移除路径前缀（Windows 下可能带路径）
        const baseCmd = path.basename(cmd);

        this.logger.debug(`Processing command: ${baseCmd}, parts: ${parts.length}`);

        switch (baseCmd) {
            // ========== Windows + Unix 通用命令 ==========
            case 'rm':
            case 'del':
            case 'erase':
            case 'rd':
            case 'rmdir':
                // 删除文件/目录
                for (let i = 1; i < parts.length; i++) {
                    const arg = parts[i];
                    if (this.isOption(arg, isWindows)) continue;
                    if (arg.startsWith('-') || arg.startsWith('/')) continue;
                    const targetPath = this.resolvePath(arg, isWindows);
                    if (targetPath) {
                        ops.push({
                            type: 'delete',
                            targetPath,
                            operation: command,
                            confidence: 0.95,
                            platform: isWindows ? 'windows' : 'unix'
                        });
                    }
                }
                break;

            case 'mv':
            case 'move':
            case 'ren':
            case 'rename':
                // 重命名/移动
                if (parts.length >= 3) {
                    const sourcePath = this.resolvePath(parts[1], isWindows);
                    const targetPath = this.resolvePath(parts[2], isWindows);
                    if (sourcePath && targetPath) {
                        ops.push({
                            type: 'rename',
                            sourcePath,
                            targetPath,
                            operation: command,
                            confidence: 0.95,
                            platform: isWindows ? 'windows' : 'unix'
                        });
                    }
                }
                break;

            case 'cp':
            case 'copy':
            case 'xcopy':
            case 'robocopy':
                // 复制文件
                if (parts.length >= 3) {
                    // 对于 xcopy 和 robocopy，需要跳过选项
                    let sourceIdx = 1;
                    let targetIdx = 2;
                    
                    // 跳过选项
                    while (sourceIdx < parts.length && this.isOption(parts[sourceIdx], isWindows)) {
                        sourceIdx++;
                        targetIdx++;
                    }
                    if (targetIdx < parts.length) {
                        const sourcePath = this.resolvePath(parts[sourceIdx], isWindows);
                        const targetPath = this.resolvePath(parts[targetIdx], isWindows);
                        if (sourcePath && targetPath) {
                            ops.push({
                                type: 'copy',
                                sourcePath,
                                targetPath,
                                operation: command,
                                confidence: 0.9,
                                platform: isWindows ? 'windows' : 'unix'
                            });
                        }
                    }
                }
                break;

            case 'touch':
            case 'type':
                // 创建或更新文件 (Windows 的 type > file)
                if (baseCmd === 'type' && command.includes('>')) {
                    // type file > newfile 已经在重定向中处理
                    break;
                }
                for (let i = 1; i < parts.length; i++) {
                    if (this.isOption(parts[i], isWindows)) continue;
                    const targetPath = this.resolvePath(parts[i], isWindows);
                    if (targetPath) {
                        ops.push({
                            type: 'modify',
                            targetPath,
                            operation: command,
                            confidence: 0.85,
                            platform: isWindows ? 'windows' : 'unix'
                        });
                    }
                }
                break;

            case 'echo':
            case 'printf':
                // echo text > file (重定向已处理)
                const redirectMatch = command.match(/[>|][>|]?\s*([^\s]+)/);
                if (redirectMatch && redirectMatch[1].toLowerCase() !== 'nul') {
                    const targetPath = this.resolvePath(redirectMatch[1], isWindows);
                    if (targetPath) {
                        ops.push({
                            type: 'modify',
                            targetPath,
                            operation: command,
                            confidence: 0.85,
                            platform: isWindows ? 'windows' : 'unix'
                        });
                    }
                }
                break;

            case 'sed':
            case 'awk':
                // 仅 Unix，Windows 需要安装
                if (parts.includes('-i') || parts.includes('--in-place')) {
                    const idx = parts.indexOf('-i');
                    let fileIndex = idx + 1;
                    // 处理 -i'' 或 -i '' 的情况
                    if (fileIndex < parts.length && parts[fileIndex].startsWith('-')) {
                        fileIndex++;
                    }
                    if (fileIndex < parts.length) {
                        const targetPath = this.resolvePath(parts[fileIndex], isWindows);
                        if (targetPath) {
                            ops.push({
                                type: 'modify',
                                targetPath,
                                operation: command,
                                confidence: 0.8,
                                platform: 'unix'
                            });
                        }
                    }
                }
                break;

            // ========== Windows 特有命令 ==========
            case 'attrib':
                // Windows 属性修改
                for (let i = 1; i < parts.length; i++) {
                    const arg = parts[i];
                    if (arg.startsWith('/') || arg.startsWith('+') || arg.startsWith('-')) continue;
                    const targetPath = this.resolvePath(arg, isWindows);
                    if (targetPath) {
                        ops.push({
                            type: 'modify',
                            targetPath,
                            operation: command,
                            confidence: 0.6,
                            platform: 'windows'
                        });
                    }
                }
                break;

            case 'fc':
                // Windows 文件比较 (可能修改输出)
                if (command.includes('>')) {
                    // 输出重定向已处理
                    break;
                }
                break;

            // ========== 包管理器 ==========
            case 'npm':
            case 'yarn':
            case 'pnpm':
                this.parsePackageManagerCommands(command, parts, ops, isWindows);
                break;

            // ========== Git ==========
            case 'git':
                this.parseGitCommands(command, parts, ops, isWindows);
                break;

            // ========== Python ==========
            case 'python':
            case 'python3':
                this.parsePythonCommands(command, parts, ops, isWindows);
                break;
        }

        return ops;
    }

    /**
     * 解析包管理器命令
     */
    private parsePackageManagerCommands(
        command: string, 
        parts: string[], 
        ops: FileOperation[],
        isWindows: boolean
    ): void {
        const subCmd = parts.length > 1 ? parts[1].toLowerCase() : '';
        
        if (['install', 'i', 'add', 'remove', 'uninstall', 'upgrade', 'update'].includes(subCmd)) {
            // 包管理会修改 package.json 和 lock 文件
            const packageJson = this.resolvePath('package.json', isWindows);
            const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
            
            if (packageJson) {
                ops.push({
                    type: 'modify',
                    targetPath: packageJson,
                    operation: command,
                    confidence: 0.85,
                    platform: isWindows ? 'windows' : 'unix'
                });
            }
            for (const lockFile of lockFiles) {
                const lockPath = this.resolvePath(lockFile, isWindows);
                if (lockPath) {
                    ops.push({
                        type: 'modify',
                        targetPath: lockPath,
                        operation: command,
                        confidence: 0.75,
                        platform: isWindows ? 'windows' : 'unix'
                    });
                }
            }
        }
    }

    /**
     * 解析 Git 命令
     */
    private parseGitCommands(
        command: string, 
        parts: string[], 
        ops: FileOperation[],
        isWindows: boolean
    ): void {
        const subCmd = parts.length > 1 ? parts[1].toLowerCase() : '';
        
        if (['checkout', 'reset', 'merge', 'rebase', 'cherry-pick', 'pull', 'am'].includes(subCmd)) {
            // Git 操作可能修改大量文件
            ops.push({
                type: 'modify',
                targetPath: '.',
                operation: command,
                confidence: 0.6,
                platform: isWindows ? 'windows' : 'unix'
            });
        } else if (['add', 'rm', 'mv'].includes(subCmd)) {
            // Git 操作特定文件
            for (let i = 2; i < parts.length; i++) {
                if (this.isOption(parts[i], isWindows)) continue;
                const targetPath = this.resolvePath(parts[i], isWindows);
                if (targetPath) {
                    ops.push({
                        type: subCmd === 'rm' ? 'delete' : 'modify',
                        targetPath,
                        operation: command,
                        confidence: 0.9,
                        platform: isWindows ? 'windows' : 'unix'
                    });
                }
            }
        }
    }

    /**
     * 解析 Python 命令
     */
    private parsePythonCommands(
        command: string, 
        parts: string[], 
        ops: FileOperation[],
        isWindows: boolean
    ): void {
        // 查找 Python 脚本可能修改的文件
        for (let i = 1; i < parts.length; i++) {
            const arg = parts[i];
            if (arg.endsWith('.py') && !arg.startsWith('-')) {
                // Python 脚本执行，可能修改文件
                ops.push({
                    type: 'modify',
                    targetPath: '.',
                    operation: command,
                    confidence: 0.4,
                    platform: isWindows ? 'windows' : 'unix'
                });
                break;
            }
        }
    }

    /**
     * ⭐ 解析 PowerShell 特有命令
     */
    private parsePowerShellCommands(command: string): FileOperation[] {
        const ops: FileOperation[] = [];
        const lower = command.toLowerCase();

        // PowerShell 的 New-Item, Remove-Item, Copy-Item, Move-Item, Rename-Item
        const patterns = [
            { regex: /new-item\s+["']?([^"'\s]+)["']?/i, type: 'create' as const },
            { regex: /remove-item\s+["']?([^"'\s]+)["']?/i, type: 'delete' as const },
            { regex: /copy-item\s+["']?([^"'\s]+)["']?\s+["']?([^"'\s]+)["']?/i, type: 'copy' as const },
            { regex: /move-item\s+["']?([^"'\s]+)["']?\s+["']?([^"'\s]+)["']?/i, type: 'rename' as const },
            { regex: /rename-item\s+["']?([^"'\s]+)["']?\s+["']?([^"'\s]+)["']?/i, type: 'rename' as const },
            { regex: /set-content\s+["']?([^"'\s]+)["']?/i, type: 'modify' as const },
            { regex: /add-content\s+["']?([^"'\s]+)["']?/i, type: 'modify' as const },
            { regex: /out-file\s+["']?([^"'\s]+)["']?/i, type: 'modify' as const },
        ];

        for (const pattern of patterns) {
            const match = command.match(pattern.regex);
            if (match) {
                // 对于重命名/复制/移动，有源和目标
                if (pattern.type === 'copy' || pattern.type === 'rename') {
                    const sourcePath = this.resolvePath(match[1], true);
                    const targetPath = this.resolvePath(match[2], true);
                    if (sourcePath && targetPath) {
                        ops.push({
                            type: pattern.type,
                            sourcePath,
                            targetPath,
                            operation: command,
                            confidence: 0.95,
                            platform: 'windows'
                        });
                    }
                } else {
                    // 单文件操作
                    const targetPath = this.resolvePath(match[1], true);
                    if (targetPath) {
                        ops.push({
                            type: pattern.type,
                            targetPath,
                            operation: command,
                            confidence: 0.95,
                            platform: 'windows'
                        });
                    }
                }
            }
        }

        return ops;
    }

    /**
     * ⭐ 解析 Windows 批处理命令
     */
    private parseBatchCommands(command: string): FileOperation[] {
        const ops: FileOperation[] = [];
        const lower = command.toLowerCase();

        // 批处理特有的命令
        // copy, xcopy, robocopy, move, del, erase, ren, rename, md, mkdir, rd, rmdir
        // 这些已经在通用解析中处理了

        // 但需要特殊处理 copy con: 等
        if (lower.includes('copy con:')) {
            const match = command.match(/copy\s+con:\s+([^\s]+)/i);
            if (match) {
                const targetPath = this.resolvePath(match[1], true);
                if (targetPath) {
                    ops.push({
                        type: 'create',
                        targetPath,
                        operation: command,
                        confidence: 0.7,
                        platform: 'windows'
                    });
                }
            }
        }

        return ops;
    }

    /**
     * ⭐ 解析管道操作
     */
    private parsePipes(command: string, isWindows: boolean): FileOperation[] {
        const ops: FileOperation[] = [];
        
        // Windows 和 Unix 都支持 | tee
        const teeMatch = command.match(/\|\s*tee\s+([^\s]+)/);
        if (teeMatch) {
            const targetPath = this.resolvePath(teeMatch[1], isWindows);
            if (targetPath) {
                ops.push({
                    type: 'modify',
                    targetPath,
                    operation: command,
                    confidence: 0.85,
                    platform: isWindows ? 'windows' : 'unix'
                });
            }
        }

        // Windows 的 findstr 输出到文件
        const findstrMatch = command.match(/findstr\s+.*\s+>\s*([^\s]+)/i);
        if (findstrMatch) {
            const targetPath = this.resolvePath(findstrMatch[1], isWindows);
            if (targetPath) {
                ops.push({
                    type: 'modify',
                    targetPath,
                    operation: command,
                    confidence: 0.8,
                    platform: 'windows'
                });
            }
        }

        return ops;
    }

    /**
     * ⭐ 解析文件路径（跨平台）
     */
    private resolvePath(filePath: string, isWindows: boolean): string | null {
        if (!filePath) return null;
        
        // 移除引号
        filePath = filePath.replace(/^["']|["']$/g, '');
        
        // 移除通配符
        if (filePath.includes('*') || filePath.includes('?')) {
            // 通配符，无法精确解析，但可以尝试
            this.logger.debug(`Wildcard detected: ${filePath}`);
            return null;
        }

        // 处理 Windows 特殊路径
        if (isWindows) {
            // CON, PRN, AUX, NUL 等设备
            if (/^(con|prn|aux|nul)$/i.test(filePath)) {
                return null;
            }
            // 处理 Windows 路径
            if (/^[A-Za-z]:[/\\]/.test(filePath)) {
                return filePath; // 绝对路径
            }
            // 处理 Windows 网络路径
            if (filePath.startsWith('\\\\')) {
                return filePath; // UNC 路径
            }
        }
        
        // 如果是绝对路径（Unix）
        if (filePath.startsWith('/')) {
            return filePath;
        }
        
        // 处理 Windows 上的 Unix 风格路径
        if (isWindows && filePath.startsWith('/')) {
            // 在 Windows 上，/ 开头的路径可能是指当前驱动器的根
            // 这里简化处理
            const drive = process.cwd().split(':')[0];
            return `${drive}:${filePath}`;
        }
        
        // 相对路径，基于工作区
        if (this.workspaceRoot) {
            return path.resolve(this.workspaceRoot, filePath);
        }
        
        return null;
    }

    /**
     * ⭐ 分割命令（跨平台）
     */
    private splitCommand(command: string, isWindows: boolean): string[] {
        if (isWindows) {
            // Windows 命令分割（考虑引号）
            const parts: string[] = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < command.length; i++) {
                const char = command[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                    current += char;
                } else if (char === ' ' && !inQuotes) {
                    if (current) {
                        parts.push(current);
                        current = '';
                    }
                } else {
                    current += char;
                }
            }
            if (current) {
                parts.push(current);
            }
            return parts;
        } else {
            // Unix 使用标准分割
            return command.split(/\s+/);
        }
    }

    /**
     * ⭐ 判断是否是选项（跨平台）
     */
    private isOption(arg: string, isWindows: boolean): boolean {
        if (!arg) return true;
        if (isWindows) {
            return arg.startsWith('/') || arg.startsWith('-') && arg.length > 1;
        }
        return arg.startsWith('-') && arg.length > 1;
    }
}