// js/config.js
import { initMarkdownIt } from './markdown.js';

// DOM 缓存
export const DOM = {};

// 记录缺失的元素
export const MISSING_ELEMENTS = [];

export function initDomCache() {
    console.log('🔧 [Config] Initializing DOM cache...');
    
    // 主要元素
    DOM.startBtn = getElement('startBtn');
    DOM.stopBtn = getElement('stopBtn');
    DOM.clearBtn = getElement('clearBtn');
    DOM.sendBtn = getElement('sendBtn');
    DOM.input = getElement('input');
    DOM.messagesDiv = getElement('messages');
    DOM.statusDot = getElement('statusDot');
    DOM.statusText = getElement('statusText');
    DOM.agentSelect = getElement('agentSelect');

    DOM.newSessionBtn = document.getElementById('newSessionBtn', true);
    DOM.sessionList = document.getElementById('sessionList', true);
    DOM.sessionCount = document.getElementById('sessionCount', true);
    DOM.sessionHeader = document.getElementById('sessionHeader', true);
    DOM.sessionToggle = document.getElementById('sessionToggle', true);
    DOM.sessionListWrapper = document.getElementById('sessionListWrapper', true);
    DOM.sessions = [];
    DOM.currentSessionId = null;
    DOM.isSessionListExpanded = true;
    
    // 修改面板相关
    DOM.changesList = getElement('changesList');
    DOM.changesPanel = getElement('changesPanel');
    DOM.showChangesBtn = getElement('showChangesBtn');
    DOM.commitAllBtn = getElement('commitAllBtn');
    DOM.rollbackAllBtn = getElement('rollbackAllBtn');
    DOM.refreshChangesBtn = getElement('refreshChangesBtn');
    DOM.changeIndicator = getElement('changeIndicator');
    DOM.changeCount = getElement('changeCount');
    
    // 审批状态 - 可能需要动态创建
    DOM.autoApproveStatus = getElement('autoApproveStatus', true); // 允许创建
    DOM.disableAutoApprove = getElement('disableAutoApprove', true); // 允许创建
    
    // 工具栏按钮（可能在 HTML 中不存在）
    DOM.showChangesBtn = getElement('showChangesBtn', true);
    
    // 验证关键元素
    validateCriticalElements();
    
    // 如果缺少审批状态元素，创建它们
    ensureApprovalElements();
    
    console.log('✅ [Config] DOM cache initialized');
    if (MISSING_ELEMENTS.length > 0) {
        console.warn('⚠️ [Config] Missing elements:', MISSING_ELEMENTS);
    }
}

// 安全的获取元素函数
function getElement(id, allowCreate = false) {
    const element = document.getElementById(id);
    if (!element && !allowCreate) {
        MISSING_ELEMENTS.push(id);
        console.warn(`⚠️ [Config] Element not found: #${id}`);
    }
    return element;
}

// 验证关键元素是否存在
function validateCriticalElements() {
    const critical = [
        'messagesDiv',
        'statusDot', 
        'statusText',
        'input',
        'sendBtn',
        'startBtn',
        'stopBtn'
    ];
    
    const missing = critical.filter(key => !DOM[key]);
    if (missing.length > 0) {
        console.error('❌ [Config] Critical missing elements:', missing);
        // 可以在这里显示错误提示
        showMissingElementsError(missing);
    }
}

// 在页面上显示错误提示
function showMissingElementsError(missing) {
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: #e74c3c;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 99999;
        font-size: 12px;
        max-width: 80%;
        text-align: center;
    `;
    div.textContent = `⚠️ Missing elements: ${missing.join(', ')}`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 5000);
}

// 确保审批相关元素存在
function ensureApprovalElements() {
    // 检查审批状态容器是否存在
    let approvalContainer = document.querySelector('.approval-status');
    
    if (!approvalContainer) {
        console.log('🔧 [Config] Creating approval-status container');
        const statusBar = document.querySelector('.status-bar');
        if (statusBar) {
            approvalContainer = document.createElement('div');
            approvalContainer.className = 'approval-status';
            approvalContainer.innerHTML = `
                <span id="autoApproveStatus">🔒 Manual</span>
                <button id="disableAutoApprove" style="display:none;">Disable Auto-Approve</button>
            `;
            statusBar.appendChild(approvalContainer);
            console.log('✅ [Config] Created approval-status container');
        } else {
            console.warn('⚠️ [Config] No .status-bar found, creating fallback');
            // 创建备用容器
            const fallback = document.createElement('div');
            fallback.className = 'status-bar';
            fallback.id = 'fallback-status-bar';
            fallback.style.cssText = 'display:none;';
            document.body.appendChild(fallback);
            
            approvalContainer = document.createElement('div');
            approvalContainer.className = 'approval-status';
            approvalContainer.innerHTML = `
                <span id="autoApproveStatus">🔒 Manual</span>
                <button id="disableAutoApprove" style="display:none;">Disable Auto-Approve</button>
            `;
            fallback.appendChild(approvalContainer);
        }
    }
    
    // 重新获取元素（确保是最新的）
    DOM.autoApproveStatus = document.getElementById('autoApproveStatus');
    DOM.disableAutoApprove = document.getElementById('disableAutoApprove');
    
    // 如果还是不存在，直接在 body 中创建
    if (!DOM.autoApproveStatus) {
        console.warn('⚠️ [Config] autoApproveStatus still missing, creating fallback');
        const el = document.createElement('span');
        el.id = 'autoApproveStatus';
        el.style.display = 'none';
        document.body.appendChild(el);
        DOM.autoApproveStatus = el;
    }
    
    if (!DOM.disableAutoApprove) {
        console.warn('⚠️ [Config] disableAutoApprove still missing, creating fallback');
        const el = document.createElement('button');
        el.id = 'disableAutoApprove';
        el.style.display = 'none';
        document.body.appendChild(el);
        DOM.disableAutoApprove = el;
    }
}

// 检查 DOM 是否完整
export function isDOMReady() {
    const required = ['messagesDiv', 'statusDot', 'statusText'];
    return required.every(key => DOM[key] !== null);
}

// 等待 DOM 完全加载
export function waitForDOM(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(selector)) {
            resolve(document.querySelector(selector));
            return;
        }
        
        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for: ${selector}`));
        }, timeout);
    });
}

export function initVSCode() {
    try {
        return acquireVsCodeApi();
    } catch (error) {
        console.error('❌ [Config] Failed to acquire VSCode API:', error);
        // 返回一个模拟对象用于测试
        return {
            postMessage: (msg) => console.log('📤 [Mock] postMessage:', msg),
            getState: () => ({}),
            setState: () => {}
        };
    }
}

export function initApp() {
    console.log('🚀 [Config] Initializing app...');
    
    // 检查 document 是否已加载
    if (document.readyState === 'loading') {
        console.log('⏳ [Config] Waiting for DOM to load...');
        document.addEventListener('DOMContentLoaded', () => {
            initDomCache();
            initMarkdownIt();
            console.log('✅ [Config] App initialized (DOMContentLoaded)');
        });
    } else {
        initDomCache();
        initMarkdownIt();
        console.log('✅ [Config] App initialized');
    }
}

// 导出调试信息
export function getDOMStatus() {
    const status = {};
    for (const [key, value] of Object.entries(DOM)) {
        status[key] = !!value;
    }
    return status;
}