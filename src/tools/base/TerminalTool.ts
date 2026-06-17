import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../../utils/logger';

const execAsync = promisify(exec);

export class TerminalTool {
    private logger: Logger;
    private terminals: Map<string, vscode.Terminal> = new Map();

    constructor() {
        this.logger = new Logger('TerminalTool');
    }

    async executeCommand(command: string, cwd?: string, timeout: number = 30000): Promise<string> {
        this.logger.info(`Executing: ${command}`);
        
        const options = {
            cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            timeout,
            maxBuffer: 1024 * 1024 * 10 // 10MB
        };
        
        try {
            const { stdout, stderr } = await execAsync(command, options);
            return stdout + (stderr ? `\n[stderr]: ${stderr}` : '');
        } catch (error: any) {
            return `Error: ${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`;
        }
    }

    createTerminal(name: string, cwd?: string): string {
        const terminal = vscode.window.createTerminal({
            name: `ACP-${name}`,
            cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        });
        
        this.terminals.set(name, terminal);
        terminal.show();
        
        this.logger.info(`Terminal created: ${name}`);
        return name;
    }

    sendToTerminal(terminalName: string, command: string): void {
        const terminal = this.terminals.get(terminalName);
        if (terminal) {
            terminal.sendText(command);
        } else {
            throw new Error(`Terminal not found: ${terminalName}`);
        }
    }

    closeTerminal(name: string): void {
        const terminal = this.terminals.get(name);
        if (terminal) {
            terminal.dispose();
            this.terminals.delete(name);
        }
    }

    listTerminals(): string[] {
        return Array.from(this.terminals.keys());
    }
}