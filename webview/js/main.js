import { initApp, initVSCode, isDOMReady, DOM, getDOMStatus } from './config.js';
import * as MessageHandler from './message-handler.js';
import * as ToolHandler from './tool-handler.js';
import * as ChangesHandler from './changes-handler.js';
import * as ApprovalHandler from './approval-handler.js';
import * as UIManager from './ui-manager.js';
import * as SessionHandler from './session-handler.js';

// 初始化
const vscode = initVSCode();
initApp();

// ========== 全局状态 ==========
window.activeToolCalls = new Map();
window.isAutoApproveEnabled = false;
window.currentToolCallsContainer = null;


// 等待 DOM 准备好
function waitForDOMReady() {
    return new Promise((resolve) => {
        if (isDOMReady()) {
            resolve();
            return;
        }
        
        const checkInterval = setInterval(() => {
            if (isDOMReady()) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 100);
        
        // 超时处理
        setTimeout(() => {
            clearInterval(checkInterval);
            console.warn('⚠️ DOM not fully ready after timeout, continuing anyway');
            resolve();
        }, 5000);
    });
}

// 主初始化
async function init() {
    console.log('🚀 [Main] Starting initialization...');
    
    // 等待 DOM 准备
    await waitForDOMReady();
    
    // 检查 DOM 状态
    const status = getDOMStatus();
    console.log('📊 [Main] DOM Status:', status);
    
    // 初始化审批状态
    ApprovalHandler.updateApprovalStatus(false);
    
    // 设置事件监听
    bindEvents();
    setupMessageListener();

    // 初始化各个模块的事件监听
    SessionHandler.initSessionHandlers(); // 添加这一行
    
    // 发送 webviewReady
    // const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'webviewReady' });
    
    console.log('✅ [Main] Initialization complete');
}


// ========== 事件绑定 ==========
function bindEvents() {
    // 主按钮事件
    DOM.startBtn.onclick = handleStartAgent;
    DOM.stopBtn.onclick = () => vscode.postMessage({ type: 'stopAgent' });
    DOM.clearBtn.onclick = () => vscode.postMessage({ type: 'clearHistory' });
    DOM.sendBtn.onclick = handleSendMessage;
    DOM.input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    // 修改面板事件
    DOM.showChangesBtn.onclick = () => ChangesHandler.toggleChangesPanel(vscode);
    DOM.commitAllBtn.onclick = () => {
        const changes = ChangesHandler.getCurrentChanges();
        if (changes.length === 0) {
            vscode.window.showInformationMessage('没有待提交的修改');
            return;
        }
        vscode.postMessage({ type: 'commitAllChanges' });
    };
    DOM.rollbackAllBtn.onclick = () => {
        const changes = ChangesHandler.getCurrentChanges();
        if (changes.length === 0) {
            vscode.window.showInformationMessage('没有待提交的修改');
            return;
        }
        vscode.postMessage({ type: 'rollbackAllChanges' });
    };
    DOM.refreshChangesBtn.onclick = () => {
        vscode.postMessage({ type: 'getPendingChanges' });
    };

    // 禁用自动批准按钮
    DOM.disableAutoApprove?.addEventListener('click', () => {
        vscode.postMessage({ type: 'disableAutoApprove' });
    });

    DOM.newSessionBtn.onclick = () => {
        console.log('📝 创建新会话');
        vscode.postMessage({ type: 'createSession' });
    }

}

// ========== 事件处理函数 ==========
function handleStartAgent() {
    if (DOM.statusDot.classList.contains('running')) {
        console.log('Agent already starting or running');
        return;
    }
    
    UIManager.showAgentStarting();
    
    const selectedAgent = DOM.agentSelect.value;
    if (!selectedAgent) {
        UIManager.showAgentStopped();
        return;
    }
    
    vscode.postMessage({ type: 'startAgent', agentName: selectedAgent });
}

function handleSendMessage() {
    const text = DOM.input.value.trim();
    if (text) {
        vscode.postMessage({ type: 'sendMessage', text });
        DOM.input.value = '';
    }
}

// ========== 消息处理 ==========
function setupMessageListener() {
    console.warn('🔧 [MAIN] Setting up message listener...');
    window.addEventListener('message', event => {
        const msg = event.data;
        
        // ⭐ 1. 首先记录所有收到的消息
        console.log('📨 [MAIN] Raw message received:', {
            event: event,
            data: event.data,
            type: event.data?.type,
            timestamp: new Date().toISOString()
        });

        switch (msg.type) {
            case 'agentReady':
                console.warn("agentReady: ")
                UIManager.showAgentReady();
                break;
                
            case 'agentStopped':
                UIManager.showAgentStopped();
                break;
                
            case 'agentError':
                UIManager.showAgentError();
                break;
                
            case 'addMessage':
                MessageHandler.addMessage(msg.role, msg.content);
                break;
                
            case 'startAssistantMessage':
                MessageHandler.startAssistantMessage();
                // 如果自动批准已启用，在新消息中显示横幅
                if (window.isAutoApproveEnabled) {
                    setTimeout(() => ApprovalHandler.showAutoApproveBanner(vscode), 0);
                }
                break;
                
            case 'updateAssistantMessage':
                MessageHandler.updateAssistantMessage(msg.content);
                break;
            // 如果需要消息完成事件（可选）
            case 'assistantMessageComplete':
                MessageHandler.finishAssistantMessage();
                break;
                
            case 'thoughtChunk':
                MessageHandler.showThoughtMessage(msg.content);
                break;
                
            case 'toolCall':
                ToolHandler.showToolCall(msg.callId, msg.name, msg.args, msg.status);
                break;
                
            case 'toolResult':
                ToolHandler.updateToolResult(msg.callId, msg.name, msg.result, msg.error, msg.status);
                break;
                
            case 'toolProgress':
                ToolHandler.updateToolProgress(msg.callId, msg.progress);
                break;
                
            case 'clearMessages':
                MessageHandler.clearMessages();
                if (window.isAutoApproveEnabled) {
                    const container = document.createElement('div');
                    container.className = 'auto-approve-container';
                    DOM.messagesDiv.appendChild(container);
                    window.currentToolCallsContainer = container;
                    ApprovalHandler.showAutoApproveBanner(vscode);
                }
                break;
                
            case 'toolApprovalRequest':
                const approvalDiv = ApprovalHandler.showApprovalRequest(msg.callId, msg.toolName, msg.args);
                DOM.messagesDiv.appendChild(approvalDiv);
                DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
                break;
                
            case 'toolApprovalResult':
                const approvalDiv2 = document.getElementById(`approval-${msg.callId}`);
                if (approvalDiv2) {
                    const statusSpan = approvalDiv2.querySelector('.tool-status');
                    statusSpan.textContent = msg.approved ? '✅ 已批准' : '❌ 已拒绝';
                    statusSpan.className = `tool-status ${msg.approved ? 'approved' : 'denied'}`;
                    approvalDiv2.querySelectorAll('button').forEach(btn => btn.disabled = true);
                }
                break;
                
            case 'autoApproveEnabled':
                window.isAutoApproveEnabled = true;
                ApprovalHandler.showAutoApproveBanner(vscode);
                ApprovalHandler.updateToolAutoApproveStatus(true);
                ApprovalHandler.updateApprovalStatus(true);
                break;
                
            case 'autoApproveDisabled':
                window.isAutoApproveEnabled = false;
                ApprovalHandler.removeAutoApproveBanner();
                ApprovalHandler.updateToolAutoApproveStatus(false);
                ApprovalHandler.updateApprovalStatus(false);
                break;
            case 'updateSessions':
                console.log('📋 更新会话列表:', msg.sessions.length, '个会话');
                console.log(msg.sessions);
                SessionHandler.updateSessions(msg, vscode);
                break;
            case 'sessionCreated':
                console.log('✅ 会话已创建:', msg.session.name);
                clearMessages();
                // 会话列表会在 updateSessions 中更新
                break;
            case 'currentSession':
                DOM.currentSessionId = msg.sessionId;
                break;    
            case 'updateChanges':
                ChangesHandler.updateChangesPanel(msg.changes, vscode);
                break;
                
            case 'changesCommitted':
                vscode.window.showInformationMessage('✅ 所有修改已提交');
                ChangesHandler.updateChangesPanel([], vscode);
                break;
                
            case 'changesRolledBack':
                vscode.window.showInformationMessage('❌ 所有修改已放弃');
                ChangesHandler.updateChangesPanel([], vscode);
                break;
        }
    });
}

function clearMessages() {
    messagesDiv.innerHTML = '';
    DOM.currentMsgDiv = null;
    DOM.currentAssistantDiv = null;
    DOM.currentThoughtDiv = null;
    DOM.currentToolCallsContainer = null;
    if (window.activeToolCalls) window.activeToolCalls.clear();
    // 如果自动批准已启用，重新显示横幅
    if (window.isAutoApproveEnabled) {
        setTimeout(() => ApprovalHandler.showAutoApproveBanner(), 0);
    }
}

// // ========== 初始化 ==========
// bindEvents();
// setupMessageListener();

// // 初始化审批状态
// ApprovalHandler.updateApprovalStatus(false);

// // 通知 VSCode webview 已准备好
// vscode.postMessage({ type: 'webviewReady' });

console.log('✅ =========================');

// 启动
init().catch(error => {
    console.error('❌ [Main] Init failed:', error);
});

console.log('✅ Chat view initialized with modular architecture');
