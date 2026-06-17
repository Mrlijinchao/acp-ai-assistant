import * as vscode from 'vscode';

export class Logger {
    private enabled = true;
    
    constructor(private prefix: string) {
        const config = vscode.workspace.getConfiguration('acp');
        this.enabled = config.get<boolean>('debug', true);
    }
    
    info(message: string, ...args: any[]): void {
        if (this.enabled) {
            console.log(`[${this.prefix}] [INFO] ${message}`, ...args);
        }
    }
    
    error(message: string, error?: any): void {
        console.error(`[${this.prefix}] [ERROR] ${message}`, error);
    }
    
    warn(message: string, ...args: any[]): void {
        if (this.enabled) {
            console.warn(`[${this.prefix}] [WARN] ${message}`, ...args);
        }
    }
    
    debug(message: string, ...args: any[]): void {
        if (this.enabled) {
            console.debug(`[${this.prefix}] [DEBUG] ${message}`, ...args);
        }
    }
}