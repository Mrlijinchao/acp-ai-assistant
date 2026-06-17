// import * as vscode from 'vscode';
// import * as path from 'path';
// import type { AgentConfig } from '../agent/types';

// export class Configuration {
//     private workspaceConfig() {
//         return vscode.workspace.getConfiguration('acp.deep.agent');
//     }

//     getAgentConfig(): AgentConfig {
//         const config = this.workspaceConfig();
        
//         let command = config.get<string>('agent.command') || 'node';
//         let args = config.get<string[]>('agent.args') || [];
//         const env = config.get<Record<string, string>>('agent.env') || {};
        
//         // 处理 Windows 路径
//         if (args.length > 0) {
//             args = this.resolveAgentPath(args);
//         }
        
//         const workspaceFolders = vscode.workspace.workspaceFolders;
//         const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

//         return { command, args, env, cwd };
//     }

//     private resolveAgentPath(args: string[]): string[] {
//         const firstArg = args[0];
        
//         // 检查是否是 Windows 绝对路径 (如 D:\xxx 或 D:/xxx)
//         if (path.isAbsolute(firstArg) || /^[A-Za-z]:[/\\]/.test(firstArg)) {
//             return args;
//         }
        
//         // 相对路径转绝对路径
//         const workspaceFolders = vscode.workspace.workspaceFolders;
//         if (workspaceFolders?.length) {
//             const absolutePath = path.resolve(workspaceFolders[0].uri.fsPath, firstArg);
//             return [absolutePath, ...args.slice(1)];
//         }
        
//         return args;
//     }

//     onDidChangeConfiguration(callback: () => void): vscode.Disposable {
//         return vscode.workspace.onDidChangeConfiguration(e => {
//             if (e.affectsConfiguration('acp')) {
//                 callback();
//             }
//         });
//     }
// }


import * as vscode from 'vscode';
import * as path from 'path';
import type { AgentConfig } from '../agent/types';

export class Configuration {
    private currentAgent: string = 'qwen-agent';

    constructor(agentName?: string) {
        if (agentName) {
            this.currentAgent = agentName;
        }
    }

    private workspaceConfig() {
        console.log(`[Configuration] Loaded workspace configuration for 'acp':`, vscode.workspace.getConfiguration('acp'));
        return vscode.workspace.getConfiguration('acp');
    }

    private userConfig() {
        console.log(`[Configuration] Loaded user configuration for 'acp':`, vscode.workspace.getConfiguration('acp', null));
        return vscode.workspace.getConfiguration('acp', null);
    }

    private getAgentConfigValue<T>(key: string, defaultValue: T): T {
        // 配置路径：deep.agents.{agentName}.{key}
        const fullKey = `deep.agents.${this.currentAgent}.${key}`;
        
        console.log(`[Configuration] Looking for key: ${fullKey}`);
        
        // 优先从工作区配置获取
        let value = this.workspaceConfig().get<T>(fullKey);
        console.log(`[Configuration] Workspace config value:`, value);
    
        console.log(`[Configuration] Workspace config value:`, JSON.stringify(this.workspaceConfig(), null, 2));
        
        // 如果工作区配置没有设置，则从用户配置获取
        if (value === undefined || value === null) {
            value = this.userConfig().get<T>(fullKey);
            console.log(`[Configuration] User config value:`, value);
        }
        
        // 如果都没有，返回默认值
        const result = value !== undefined && value !== null ? value : defaultValue;
        console.log(`[Configuration] Final value for ${fullKey}:`, result);
        
        return result;
    }

    setCurrentAgent(agentName: string) {
        this.currentAgent = agentName;
    }

    getAvailableAgents(): string[] {
        // 获取 deep.agents 对象
        const agents = this.workspaceConfig().get<Record<string, any>>('deep.agents');
        
        if (!agents) {
            const userAgents = this.userConfig().get<Record<string, any>>('deep.agents');
            return userAgents ? Object.keys(userAgents) : [];
        }
        
        return Object.keys(agents);
    }

    getAgentConfig(agentName: string): AgentConfig {
        this.setCurrentAgent(agentName);
        let command = this.getAgentConfigValue<string>('command', 'node');
        let args = this.getAgentConfigValue<string[]>('args', []);
        const env = this.getAgentConfigValue<Record<string, string>>('env', {});
        
        console.log(`[Configuration] Raw command: ${command}, args:`, args, 'env:', env);
        
        // 处理路径
        if (args.length > 0) {
            args = this.resolveAgentPath(args);
        }
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        const result = { command, args, env, cwd };
        console.log(`[Configuration] Final agent config:`, result);
        
        return result;
    }

    private resolveAgentPath(args: string[]): string[] {
        const firstArg = args[0];
        
        // 检查是否是绝对路径
        if (path.isAbsolute(firstArg) || /^[A-Za-z]:[/\\]/.test(firstArg)) {
            return args;
        }
        
        // 相对路径转绝对路径
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders?.length) {
            const absolutePath = path.resolve(workspaceFolders[0].uri.fsPath, firstArg);
            return [absolutePath, ...args.slice(1)];
        }
        
        return args;
    }

    onDidChangeConfiguration(callback: () => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('acp')) {
                callback();
            }
        });
    }
}