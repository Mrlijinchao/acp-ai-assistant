import { DOM } from './config.js';
import { escapeHtml, formatJson } from './utils.js';

export function showToolCall(callId, name, args, status) {
    const toolDiv = document.createElement('div');
    toolDiv.className = `tool-call ${status}`;
    const toolId = `tool-${callId}`;
    toolDiv.id = toolId;
    
    const isExpanded = false;
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
                <pre>${escapeHtml(formatJson(args))}</pre>
            </div>
            <div class="tool-result" style="display:none;"></div>
        </div>
    `;
    
    setupToolToggle(toolDiv);
    
    const container = window.currentToolCallsContainer || DOM.messagesDiv;
    container.appendChild(toolDiv);
    DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
    
    if (!window.activeToolCalls) window.activeToolCalls = new Map();
    window.activeToolCalls.set(callId, { 
        div: toolDiv, 
        details: toolDiv.querySelector('.tool-details'), 
        resultDiv: toolDiv.querySelector('.tool-result') 
    });
}

function setupToolToggle(toolDiv) {
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
}

export function updateToolResult(callId, name, result, error, status) {
    const toolData = window.activeToolCalls?.get(callId);
    if (!toolData) return;
    
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
        const resultText = typeof result === 'string' ? result : formatJson(result);
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

export function updateToolProgress(callId, progress) {
    const toolDiv = window.activeToolCalls?.get(callId)?.div;
    if (toolDiv) {
        const statusSpan = toolDiv.querySelector('.tool-status');
        statusSpan.textContent = progress;
    }
}