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

// 思考消息相关变量
let currentThoughtDiv = null;
let currentThoughtContent = '';
let currentAssistantDiv = null;
let currentToolCallsContainer = null;

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
    
    toolDiv.innerHTML = `
        <div class="tool-header" data-tool-id="${toolId}">
            <span class="tool-icon">🔧</span>
            <span class="tool-name">${escapeHtml(name)}</span>
            <span class="tool-status ${status}">${status === 'pending' ? '执行中...' : '失败'}</span>
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
            messagesDiv.innerHTML = '';
            currentMsgDiv = null;
            currentAssistantDiv = null;
            currentThoughtDiv = null;
            if (window.activeToolCalls) window.activeToolCalls.clear();
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
    }
});

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
init();

// 通知 VSCode webview 已准备好
vscode.postMessage({ type: 'webviewReady' });