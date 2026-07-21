import * as vscode from 'vscode';
import { AgentManager } from './agent/AgentManager';
import { Configuration } from './config/Configuration';
import { ChatViewProvider } from './webview/ChatViewProvider';
import { CommandManager } from './commands';
import { Logger } from './utils/logger';

let agentManager: AgentManager;
let configuration: Configuration;
let commandManager: CommandManager;
let logger: Logger;

export async function activate(context: vscode.ExtensionContext) {
    logger = new Logger('ACP');
    logger.info('Extension activating...');

    // 初始化模块
    configuration = new Configuration();
    agentManager = new AgentManager(configuration);
    commandManager = new CommandManager(agentManager);
    
    // 注册 Webview View Provider
    const chatProvider = new ChatViewProvider(
        context.extensionUri,
        agentManager
    );

    // 预加载 HTML
    await chatProvider.loadHtml();
    
    const chatView = vscode.window.registerWebviewViewProvider(
        'acp-chat-view',
        chatProvider
    );
    
    // 注册命令
    commandManager.registerCommands(context);
    
    context.subscriptions.push(chatView);

    // 监听配置变化
    configuration.onDidChangeConfiguration(() => {
        logger.info('Configuration changed');
        if (agentManager.isRunning()) {
            vscode.window.showWarningMessage(
                '⚠️ Agent configuration changed. Please restart the agent for changes to take effect.'
            );
        }
    });

    logger.info('Extension activated');
}

export function deactivate() {
    if (agentManager) {
        agentManager.stop();
    }
    logger.info('Extension deactivated');
}