const vscode = acquireVsCodeApi();
let currentMsgDiv = null;
let activeToolCalls = new Map();

// DOM 元素
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const sendBtn = document.getElementById('sendBtn');
const input = document.getElementById('input');
const messagesDiv = document.getElementById('messages');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const newSessionBtn = document.getElementById('newSessionBtn');
const sessionList = document.getElementById('sessionList');
const sessionCount = document.getElementById('sessionCount');
const sessionHeader = document.getElementById('sessionHeader');
const sessionToggle = document.getElementById('sessionToggle');
const sessionListWrapper = document.getElementById('sessionListWrapper');



// 事件监听
startBtn.onclick = () => {
    // 防止重复启动
    if (statusDot.classList.contains('running')) {
        console.log('Agent already starting or running');
        return;
    }
    
    // 更新 UI 为启动中状态
    statusDot.className = 'status-dot starting';
    statusText.innerText = 'Agent starting...';
    startBtn.disabled = true;  // 禁用启动按钮

    const agentSelect = document.getElementById('agentSelect');

    const selectedAgent = agentSelect.value;
    if (!selectedAgent) {
        // statusDiv.innerHTML = '⚠️ 请先选择一个 Agent';
        //     setTimeout(() => {
        //         if (statusDiv.innerHTML === '⚠️ 请先选择一个 Agent') {
        //             statusDiv.innerHTML = '⚪ Agent 未启动';
        //         }
        //     }, 2000);
        return;
    }
    
    // 发送启动消息
    vscode.postMessage({ type: 'startAgent', agentName: selectedAgent});
};

stopBtn.onclick = () => vscode.postMessage({ type: 'stopAgent' });
clearBtn.onclick = () => vscode.postMessage({ type: 'clearHistory' });
sendBtn.onclick = sendMessage;
input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };



// ========== 获取 DOM 元素 ==========
// 修改面板相关
const changesList = document.getElementById('changesList');
const changesPanel = document.getElementById('changesPanel');
const showChangesBtn = document.getElementById('showChangesBtn');
const commitAllBtn = document.getElementById('commitAllBtn');
const rollbackAllBtn = document.getElementById('rollbackAllBtn');
const refreshChangesBtn = document.getElementById('refreshChangesBtn');
const changeIndicator = document.getElementById('changeIndicator');
const changeCount = document.getElementById('changeCount');

let currentChanges = [];
let isChangesPanelVisible = false;

// ========== 事件绑定 ==========
showChangesBtn.onclick = () => toggleChangesPanel();

commitAllBtn.onclick = () => {
    if (currentChanges.length === 0) {
        vscode.window.showInformationMessage('没有待提交的修改');
        return;
    }
    vscode.postMessage({ type: 'commitAllChanges' });
};

rollbackAllBtn.onclick = () => {
    if (currentChanges.length === 0) {
        vscode.window.showInformationMessage('没有待提交的修改');
        return;
    }
    vscode.postMessage({ type: 'rollbackAllChanges' });
};

refreshChangesBtn.onclick = () => {
    vscode.postMessage({ type: 'getPendingChanges' });
};

function toggleChangesPanel() {
    isChangesPanelVisible = !isChangesPanelVisible;
    changesPanel.classList.toggle('visible', isChangesPanelVisible);
    showChangesBtn.textContent = isChangesPanelVisible ? '📝 隐藏修改' : `📝 待确认修改 (${currentChanges.length})`;
    if (isChangesPanelVisible) {
        vscode.postMessage({ type: 'getPendingChanges' });
    }
}

// ========== ⭐ 更新修改列表 ==========
function updateChangesPanel(changes) {
    console.log('[updateChangesPanel] Called with:', changes);
    
    currentChanges = changes || [];
    
    if (currentChanges.length === 0) {
        changesList.innerHTML = '<div class="changes-empty">✅ 没有待确认的修改</div>';
        changeIndicator.style.display = 'none';
        showChangesBtn.style.display = 'none';
        changesPanel.classList.toggle('visible', false);
        return;
    }

    changeIndicator.style.display = 'flex';
    changeCount.textContent = currentChanges.length;
    showChangesBtn.style.display = 'inline-block';
    showChangesBtn.textContent = isChangesPanelVisible ? '📝 隐藏修改' : `📝 待确认修改 (${currentChanges.length})`;

    let html = '';
    for (const change of currentChanges) {
        const typeIcon = change.type === 'create' ? '📄' : change.type === 'modify' ? '✏️' : '🗑️';
        const typeLabel = change.type === 'create' ? '创建' : change.type === 'modify' ? '修改' : '删除';
        const fileName = change.filePath.split(/[\/\\]/).pop() || change.filePath;

        html += `
            <div class="change-item" data-path="${change.filePath}">
                <span class="change-icon">${typeIcon}</span>
                <span class="change-type ${change.type}">${typeLabel}</span>
                <span class="change-file" title="${escapeHtml(change.filePath)}">${escapeHtml(fileName)}</span>
                <span class="change-status pending">⏳ 待确认</span>
                <span class="change-actions">
                    <button class="diff-btn" data-path="${change.filePath}" title="查看差分">📊</button>
                    <button class="accept-btn" data-path="${change.filePath}" title="接受">✅</button>
                    <button class="reject-btn" data-path="${change.filePath}" title="拒绝">❌</button>
                </span>
            </div>
        `;
    }

    changesList.innerHTML = html;

    // 绑定事件
    changesList.querySelectorAll('.accept-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const filePath = btn.dataset.path;
            vscode.postMessage({ type: 'acceptSingleChange', filePath });
        };
    });

    changesList.querySelectorAll('.reject-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const filePath = btn.dataset.path;
            vscode.postMessage({ type: 'rejectSingleChange', filePath });
        };
    });

    // 绑定 diff 按钮事件
    changesList.querySelectorAll('.diff-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const filePath = btn.dataset.path;
            console.log('[updateChangesPanel] Diff button clicked for:', filePath);
            // ⭐ 发送 showFileDiff 消息
            vscode.postMessage({ type: 'showFileDiff', filePath });
        };
    });

    // 点击整个修改项也查看差分
    changesList.querySelectorAll('.change-item').forEach(item => {
        item.onclick = (e) => {
            if (e.target.closest('button')) return;
            const filePath = item.dataset.path;
            console.log('[updateChangesPanel] Change item clicked:', filePath);
            vscode.postMessage({ type: 'showFileDiff', filePath });
        };
    });

}



// 思考消息相关变量
let currentThoughtDiv = null;
let currentThoughtContent = '';
let currentAssistantDiv = null;
let currentToolCallsContainer = null;

let isSessionListExpanded = true;

// 初始化 markdown-it 实例
let md = null;

function initMarkdownIt() {
    if (typeof markdownit !== 'undefined' && !md) {
        md = markdownit({
            html: false,        // 禁用 HTML 标签，防止 XSS
            xhtmlOut: false,    // 使用闭合标签
            breaks: true,       // 转换换行符为 <br>
            linkify: true,      // 自动识别 URL 并转为链接
            typographer: true,  // 启用智能引号等排版功能
            highlight: function(code, lang) {
                // 代码高亮处理
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        const highlighted = hljs.highlight(code, { language: lang }).value;
                        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
                    } catch (err) {
                        console.error('Highlight error:', err);
                    }
                }
                // 无法识别语言时的降级方案
                return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
            }
        });
        
        // 添加可选插件（如果需要任务列表等功能）
        // 注意：需要额外引入 markdown-it-task-lists 等插件
        
        console.log('✅ Markdown-it initialized with highlight.js');
    }
    return md;
}

// Markdown 渲染函数
function renderMarkdown(text) {
    if (!text) return '';
    
    try {
        // 确保 markdown-it 已初始化
        if (!md) {
            initMarkdownIt();
        }
        
        if (!md) {
            console.warn('Markdown-it not available, using plain text');
            return escapeHtml(text);
        }
        
        // 渲染 markdown
        const html = md.render(text);
        return html;
    } catch (err) {
        console.error('Markdown parse error:', err);
        return escapeHtml(text);
    }
}

// 高亮所有代码块（用于动态添加的内容）
function highlightCodeBlocks(element) {
    if (typeof hljs !== 'undefined' && element) {
        // 找到所有未高亮的代码块
        const codeBlocks = element.querySelectorAll('pre code:not(.hljs)');
        codeBlocks.forEach((block) => {
            try {
                hljs.highlightElement(block);
            } catch (err) {
                console.error('Highlight.js error:', err);
            }
        });
    }
}

// 添加消息函数
async function addMessage(role, content) {
    if (role === 'user') {
        currentAssistantDiv = null;
        currentToolCallsContainer = null;
        if (window.activeToolCalls) window.activeToolCalls.clear();
        currentMsgDiv = null;
    }
    
    const div = document.createElement('div');
    div.className = 'message ' + role;
    
    if (role === 'assistant') {
        // 渲染 Markdown（同步执行，markdown-it 是同步的）
        const renderedContent = renderMarkdown(content);
        div.innerHTML = `
            <div class="message-header">Assistant</div>
            <div class="tool-calls-container"></div>
            <div class="message-content">${renderedContent}</div>
        `;
        currentToolCallsContainer = div.querySelector('.tool-calls-container');
        currentAssistantDiv = div;
        currentMsgDiv = div.querySelector('.message-content');
        
        // 确保代码块高亮
        highlightCodeBlocks(currentMsgDiv);
    } else {
        div.innerHTML = `
            <div class="message-header">${role === 'user' ? 'You' : 'System'}</div>
            <div class="message-content">${escapeHtml(content)}</div>
        `;
    }
    
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    currentThoughtDiv = null;
    currentThoughtContent = '';
    
    return div;
}

// 更新助手消息（流式输出）
function updateAssistantMessage(content) {
    if (currentMsgDiv) {
        const renderedContent = renderMarkdown(content);
        currentMsgDiv.innerHTML = renderedContent;
        
        // 高亮新增的代码块
        highlightCodeBlocks(currentMsgDiv);
        
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

// 开始新的助手消息
function startAssistantMessage() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
        <div class="message-header">Assistant</div>
        <div class="tool-calls-container"></div>
        <div class="message-content"></div>
    `;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    currentAssistantDiv = div;
    currentToolCallsContainer = div.querySelector('.tool-calls-container');
    currentMsgDiv = div.querySelector('.message-content');
    return currentMsgDiv;
}

// 显示思考消息
function showThoughtMessage(chunk, fullThought) {
    if (!currentThoughtDiv) {
        currentThoughtDiv = document.createElement('div');
        currentThoughtDiv.className = 'message thought';
        currentThoughtDiv.innerHTML = `
            <div class="message-header">
                <span class="thought-icon">💭</span> Thinking...
            </div>
            <div class="message-content thought-content"></div>
        `;
        messagesDiv.appendChild(currentThoughtDiv);
        currentThoughtContent = '';
    }
    
    currentThoughtContent += chunk;
    const contentDiv = currentThoughtDiv.querySelector('.message-content');
    contentDiv.innerHTML = escapeHtml(currentThoughtContent);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 发送消息
function sendMessage() {
    const text = input.value.trim();
    if (text) {
        vscode.postMessage({ type: 'sendMessage', text });
        input.value = '';
    }
}

// 工具调用相关函数
function showToolCall(callId, name, args, status) {
    const toolDiv = document.createElement('div');
    toolDiv.className = `tool-call ${status}`;
    const toolId = `tool-${callId}`;
    toolDiv.id = toolId;
    
    const isExpanded = false;
    
    // 检查是否处于自动批准模式
    const isAutoApprove = window.isAutoApproveEnabled || false;
    
    toolDiv.innerHTML = `
        <div class="tool-header" data-tool-id="${toolId}">
            <span class="tool-icon">🔧</span>
            <span class="tool-name">${escapeHtml(name)}</span>
            <span class="tool-status ${status}">${status === 'pending' ? '执行中...' : '失败'}</span>
            ${isAutoApprove ? '<span class="approval-badge auto-approved">✅ Auto-Approved</span>' : ''}
            <span class="tool-toggle ${isExpanded ? '' : 'collapsed'}">▼</span>
        </div>
        <div class="tool-details ${isExpanded ? '' : 'collapsed'}">
            <div class="tool-args">
                <strong>参数:</strong>
                <pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre>
            </div>
            <div class="tool-result" style="display:none;"></div>
        </div>
    `;
    
    const header = toolDiv.querySelector('.tool-header');
    const details = toolDiv.querySelector('.tool-details');
    const toggle = header.querySelector('.tool-toggle');
    
    header.addEventListener('click', () => {
        const isCollapsed = details.classList.contains('collapsed');
        if (isCollapsed) {
            details.classList.remove('collapsed');
            toggle.classList.remove('collapsed');
        } else {
            details.classList.add('collapsed');
            toggle.classList.add('collapsed');
        }
    });
    
    if (currentToolCallsContainer) {
        currentToolCallsContainer.appendChild(toolDiv);
    } else {
        messagesDiv.appendChild(toolDiv);
    }
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    if (!window.activeToolCalls) window.activeToolCalls = new Map();
    window.activeToolCalls.set(callId, { div: toolDiv, details, resultDiv: toolDiv.querySelector('.tool-result') });
}

// 添加一个函数来显示自动批准状态横幅（在工具调用区域）
function showAutoApproveBanner() {
    // 在当前工具调用容器中显示横幅
    const container = currentToolCallsContainer || messagesDiv;
    
    // 检查是否已经存在横幅
    let banner = container.querySelector('.auto-approve-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'auto-approve-banner';
        banner.innerHTML = `
            <span class="banner-icon">✅</span>
            <span class="banner-text">Auto-approval enabled for this task - all tools will be automatically approved</span>
            <button class="banner-disable-btn" title="Disable auto-approval">✕</button>
        `;
        
        // 添加禁用按钮事件
        const disableBtn = banner.querySelector('.banner-disable-btn');
        disableBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'disableAutoApprove' });
            // 移除横幅
            banner.remove();
            window.isAutoApproveEnabled = false;
            updateApprovalStatus(false);
        });
        
        container.appendChild(banner);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

// 移除自动批准横幅
function removeAutoApproveBanner() {
    const banner = document.querySelector('.auto-approve-banner');
    if (banner) {
        banner.remove();
    }
}

// 更新工具调用中的自动批准状态
function updateToolAutoApproveStatus(isEnabled) {
    window.isAutoApproveEnabled = isEnabled;
    
    // 更新所有已有的工具调用
    document.querySelectorAll('.tool-call .tool-header').forEach(header => {
        const badge = header.querySelector('.approval-badge');
        if (isEnabled) {
            if (!badge) {
                const statusSpan = header.querySelector('.tool-status');
                const newBadge = document.createElement('span');
                newBadge.className = 'approval-badge auto-approved';
                newBadge.textContent = '✅ Auto-Approved';
                statusSpan.after(newBadge);
            }
        } else {
            if (badge) {
                badge.remove();
            }
        }
    });
}


function updateToolResult(callId, name, result, error, status) {
    const toolData = window.activeToolCalls?.get(callId);
    if (toolData) {
        const { div, details, resultDiv } = toolData;
        const newClass = status === 'completed' ? 'completed' : 'failed';
        div.className = `tool-call ${newClass}`;
        
        const statusSpan = div.querySelector('.tool-status');
        statusSpan.className = `tool-status ${newClass}`;
        statusSpan.textContent = status === 'completed' ? '已完成' : '失败';
        
        if (status === 'failed') {
            resultDiv.innerHTML = `
                <div class="tool-error">
                    <strong>❌ 错误:</strong>
                    <pre>${escapeHtml(error)}</pre>
                </div>
            `;
        } else {
            const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            resultDiv.innerHTML = `
                <div class="result-header">✓ 结果:</div>
                <pre>${escapeHtml(resultText)}</pre>
            `;
        }
        
        resultDiv.style.display = 'block';
        
        setTimeout(() => {
            if (details && !details.classList.contains('collapsed')) {
                details.classList.add('collapsed');
                const toggle = div.querySelector('.tool-toggle');
                if (toggle) toggle.classList.add('collapsed');
            }
        }, 3000);
    }
}

function updateToolProgress(callId, progress) {
    const toolDiv = window.activeToolCalls?.get(callId)?.div;
    if (toolDiv) {
        const statusSpan = toolDiv.querySelector('.tool-status');
        statusSpan.textContent = progress;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 初始化
function init() {
    initMarkdownIt();
    console.log('✅ Chat view initialized with markdown-it + highlight.js');
    // 请求加载会话列表
    // vscode.postMessage({ type: 'webviewReady' });
}

// 添加状态显示元素
const statusDiv = document.createElement('div');
statusDiv.className = 'approval-status';
statusDiv.innerHTML = `
    <span id="autoApproveStatus">🔒 Manual Approval</span>
    <button id="disableAutoApprove" style="display:none;font-size:11px;padding:2px 8px;">Disable Auto-Approve</button>
`;
document.querySelector('.status-bar').appendChild(statusDiv);

// 添加禁用自动批准按钮事件
document.getElementById('disableAutoApprove')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'disableAutoApprove' });
});

// 显示差分预览
// 显示差分预览（在独立窗口中）
function showDiffPreview(filePath, diffHtml) {
    // 在 VS Code 中创建一个新的 Webview 面板
    // 实际上，这个功能已经由 AgentManager.showFileDiff 处理了
    // 这里只需要显示一个提示
    vscode.window.showInformationMessage(`📊 正在打开差分预览: ${filePath}`);
}

// 处理审批状态更新
function updateApprovalStatus(autoApprove, approvedTools = []) {
    const statusSpan = document.getElementById('autoApproveStatus');
    const disableBtn = document.getElementById('disableAutoApprove');
    
    if (autoApprove) {
        statusSpan.innerHTML = '✅ Auto-Approved';
        statusSpan.className = 'auto-approve-enabled';
        disableBtn.style.display = 'inline-block';
    } else {
        statusSpan.innerHTML = '🔒 Manual';
        statusSpan.className = 'auto-approve-disabled';
        disableBtn.style.display = 'none';
    }
}

// 会话管理相关变量
let sessions = [];
let currentSessionId = null;

// 获取DOM元素
// 新建会话 - 直接创建，不需要弹窗
if (newSessionBtn) {
    newSessionBtn.addEventListener('click', function() {
        console.log('📝 创建新会话');
        vscode.postMessage({ type: 'createSession' });
    });
} else {
    console.warn('newSessionBtn not found');
}

function toggleSessionList() {
    isSessionListExpanded = !isSessionListExpanded;
    if (isSessionListExpanded) {
        sessionListWrapper.classList.add('expanded');
        sessionToggle.classList.remove('collapsed');
    } else {
        sessionListWrapper.classList.remove('expanded');
        sessionToggle.classList.add('collapsed');
    }
}

sessionHeader.addEventListener('click', (e) => {
    // 如果点击的是按钮，不触发折叠
    if (e.target.closest('button')) return;
    toggleSessionList();
});

// 更新会话列表
function updateSessions(sessionData) {
    sessions = sessionData.sessions || [];
    currentSessionId = sessionData.currentSessionId;
    
    // 更新会话数量
    sessionCount.textContent = sessions.length;
    
    if (!sessionList) return;
    
    if (sessions.length === 0) {
        sessionList.innerHTML = '<div class="session-empty">暂无会话，点击 "+新建" 创建</div>';
        return;
    }
    
    sessionList.innerHTML = '';
    sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = `session-item${session.isActive ? ' active' : ''}`;
        
        // 名称
        const nameSpan = document.createElement('span');
        nameSpan.className = 'session-name';
        nameSpan.textContent = session.name;
        
        // 消息数
        const infoSpan = document.createElement('span');
        infoSpan.className = 'session-info';
        infoSpan.textContent = `${session.messageCount}条`;
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'session-delete';
        deleteBtn.textContent = '✕';
        deleteBtn.title = '删除会话';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            vscode.postMessage({ 
                type: 'deleteSession', 
                sessionId: session.id,
                sessionName: session.name  // 传递会话名称用于显示
            });
        });
        
        item.appendChild(nameSpan);
        item.appendChild(infoSpan);
        item.appendChild(deleteBtn);
        
        // 双击重命名
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const currentName = nameSpan.textContent;
            const input = document.createElement('input');
            input.className = 'session-rename-input';
            input.value = currentName;
            input.maxLength = 50;
            
            nameSpan.replaceWith(input);
            input.focus();
            input.select();
            
            const finishRename = () => {
                const newName = input.value.trim() || currentName;
                if (newName !== currentName) {
                    vscode.postMessage({
                        type: 'renameSession',
                        sessionId: session.id,
                        newName: newName
                    });
                }
                input.replaceWith(nameSpan);
                nameSpan.textContent = newName;
            };
            
            input.addEventListener('blur', finishRename);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') input.blur();
                else if (e.key === 'Escape') {
                    input.value = currentName;
                    input.blur();
                }
            });
        });
        
        // 点击切换会话
        item.addEventListener('click', () => {
            if (!session.isActive) {
                console.log('🔄 切换会话:', session.name);
                vscode.postMessage({ 
                    type: 'switchSession', 
                    sessionId: session.id 
                });
            }
        });
        
        sessionList.appendChild(item);
    });
}


function handleSessionCreated(session) {
    // 清空消息
    clearMessages();
    // 更新会话列表
    const updatedSessions = [session, ...sessions.filter(s => s.id !== session.id)];
    updateSessions({
        sessions: updatedSessions,
        currentSessionId: session.id
    });
}

// 消息处理
window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
        case 'agentReady':
            statusDot.className = 'status-dot running';
            statusText.innerText = 'Agent running';
            startBtn.disabled = false;  // 恢复按钮
            input.disabled = false;
            sendBtn.disabled = false;
            break;
        case 'agentStopped':
            statusDot.className = 'status-dot stopped';
            statusText.innerText = 'Agent not started';
            startBtn.disabled = false;  // 恢复按钮
            input.disabled = true;
            sendBtn.disabled = true;
            break;
        case 'agentError':  // 如果后端返回错误
            statusDot.className = 'status-dot stopped';
            statusText.innerText = 'Agent start failed';
            startBtn.disabled = false;
            break;
        case 'addMessage':
            addMessage(msg.role, msg.content);
            break;
        case 'startAssistantMessage':
            startAssistantMessage();
            break;
        case 'updateAssistantMessage':
            updateAssistantMessage(msg.content);
            break;
        case 'toolCall':
            showToolCall(msg.callId, msg.name, msg.args, msg.status);
            break;
        case 'toolResult':
            updateToolResult(msg.callId, msg.name, msg.result, msg.error, msg.status);
            break;
        case 'toolProgress':
            updateToolProgress(msg.callId, msg.progress);
            break;
        case 'clearMessages':
            // messagesDiv.innerHTML = '';
            // currentMsgDiv = null;
            // currentAssistantDiv = null;
            // currentThoughtDiv = null;
            // if (window.activeToolCalls) window.activeToolCalls.clear();
            // // 如果自动批准已启用，重新显示横幅
            // if (window.isAutoApproveEnabled) {
            //     // 创建一个新的消息容器来放横幅
            //     const container = document.createElement('div');
            //     container.className = 'auto-approve-container';
            //     messagesDiv.appendChild(container);
            //     currentToolCallsContainer = container;
            //     showAutoApproveBanner();
            // }
            clearMessages();
            break;
        case 'thoughtChunk':
            showThoughtMessage(msg.content, msg.fullThought);
            break;
        case 'toolApprovalRequest':
            showApprovalRequest(msg.callId, msg.toolName, msg.args);
            break;
        case 'toolApprovalResult':
            // 更新审批状态
            const approvalDiv = document.getElementById(`approval-${msg.callId}`);
            if (approvalDiv) {
                const statusSpan = approvalDiv.querySelector('.tool-status');
                statusSpan.textContent = msg.approved ? '✅ 已批准' : '❌ 已拒绝';
                statusSpan.className = `tool-status ${msg.approved ? 'approved' : 'denied'}`;
                // 禁用按钮
                approvalDiv.querySelectorAll('button').forEach(btn => btn.disabled = true);
            }
            break;
        case 'autoApproveEnabled':
            window.isAutoApproveEnabled = true;
            // 显示横幅在当前工具调用区域
            showAutoApproveBanner();
            // 更新所有已存在的工具调用
            updateToolAutoApproveStatus(true);
            // 更新状态栏
            updateApprovalStatus(true);
            break;

        case 'autoApproveDisabled':
            window.isAutoApproveEnabled = false;
            // 移除横幅
            removeAutoApproveBanner();
            // 更新所有已存在的工具调用
            updateToolAutoApproveStatus(false);
            // 更新状态栏
            updateApprovalStatus(false);
            break;

        case 'toolAutoApproved':
            // 工具被自动批准，在工具调用上显示标记
            // 这个事件会在工具调用时触发，showToolCall 已经处理了
            break;

        case 'startAssistantMessage':
            // 重置工具调用容器，但保留自动批准状态
            const div = startAssistantMessage();
            // 如果自动批准已启用，在新消息中显示横幅
            if (window.isAutoApproveEnabled) {
                setTimeout(() => showAutoApproveBanner(), 0);
            }
            break;
        case 'updateSessions':
            console.log('📋 更新会话列表:', msg.sessions.length, '个会话');
            updateSessions(msg);
            break;
            
        case 'sessionCreated':
            console.log('✅ 会话已创建:', msg.session.name);
            clearMessages();
            // 会话列表会在 updateSessions 中更新
            break;
            
        case 'currentSession':
            currentSessionId = msg.sessionId;
            break;
         case 'updateChanges':
            updateChangesPanel(msg.changes);
            break;

        case 'changesCommitted':
            vscode.window.showInformationMessage('✅ 所有修改已提交');
            updateChangesPanel([]);
            break;

        case 'changesRolledBack':
            vscode.window.showInformationMessage('❌ 所有修改已放弃');
            updateChangesPanel([]);
            break;
    }
});

function clearMessages() {
    messagesDiv.innerHTML = '';
    currentMsgDiv = null;
    currentAssistantDiv = null;
    currentThoughtDiv = null;
    currentToolCallsContainer = null;
    if (window.activeToolCalls) window.activeToolCalls.clear();
    // 如果自动批准已启用，重新显示横幅
    if (window.isAutoApproveEnabled) {
        setTimeout(() => showAutoApproveBanner(), 0);
    }
}

// 初始化状态
updateApprovalStatus(false);

function showApprovalRequest(callId, toolName, args) {
    const div = document.createElement('div');
    div.className = 'tool-call pending-approval';
    div.id = `approval-${callId}`;
    
    div.innerHTML = `
        <div class="tool-header">
            <span class="tool-icon">⏳</span>
            <span class="tool-name">${escapeHtml(toolName)}</span>
            <span class="tool-status pending">等待审批...</span>
        </div>
        <div class="tool-details">
            <div class="tool-args">
                <strong>参数:</strong>
                <pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre>
            </div>
            <div class="tool-approval">
                <button class="approve-btn">✅ 批准</button>
                <button class="deny-btn">❌ 拒绝</button>
            </div>
        </div>
    `;
    
    // 添加审批按钮事件
    const approveBtn = div.querySelector('.approve-btn');
    const denyBtn = div.querySelector('.deny-btn');
    
    approveBtn.onclick = () => {
        vscode.postMessage({ type: 'approveTool', callId });
    };
    
    denyBtn.onclick = () => {
        vscode.postMessage({ type: 'denyTool', callId });
    };
    
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}




// 初始化
// 启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// 通知 VSCode webview 已准备好
vscode.postMessage({ type: 'webviewReady' });