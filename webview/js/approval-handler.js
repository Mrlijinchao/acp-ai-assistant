import { DOM } from './config.js';
import { escapeHtml, formatJson } from './utils.js';

export function showAutoApproveBanner(vscode) {
    const container = window.currentToolCallsContainer || DOM.messagesDiv;
    
    let banner = container.querySelector('.auto-approve-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'auto-approve-banner';
        banner.innerHTML = `
            <span class="banner-icon">✅</span>
            <span class="banner-text">Auto-approval enabled for this task - all tools will be automatically approved</span>
            <button class="banner-disable-btn" title="Disable auto-approval">✕</button>
        `;
        
        const disableBtn = banner.querySelector('.banner-disable-btn');
        disableBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'disableAutoApprove' });
            banner.remove();
            window.isAutoApproveEnabled = false;
            updateApprovalStatus(false);
        });
        
        container.appendChild(banner);
        DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
    }
}

export function removeAutoApproveBanner() {
    const banner = document.querySelector('.auto-approve-banner');
    if (banner) banner.remove();
}

export function updateToolAutoApproveStatus(isEnabled) {
    window.isAutoApproveEnabled = isEnabled;
    
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
            if (badge) badge.remove();
        }
    });
}

export function updateApprovalStatus(autoApprove) {
    const statusSpan = DOM.autoApproveStatus;
    const disableBtn = DOM.disableAutoApprove;
    
    if (autoApprove) {
        statusSpan.innerHTML = '✅ Auto-Approved';
        statusSpan.className = 'auto-approve-enabled';
        if (disableBtn) disableBtn.style.display = 'inline-block';
    } else {
        statusSpan.innerHTML = '🔒 Manual';
        statusSpan.className = 'auto-approve-disabled';
        if (disableBtn) disableBtn.style.display = 'none';
    }
}

export function showApprovalRequest(callId, toolName, args) {
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
                <pre>${escapeHtml(formatJson(args))}</pre>
            </div>
            <div class="tool-approval">
                <button class="approve-btn">✅ 批准</button>
                <button class="deny-btn">❌ 拒绝</button>
            </div>
        </div>
    `;
    
    const approveBtn = div.querySelector('.approve-btn');
    const denyBtn = div.querySelector('.deny-btn');
    
    // 需要传入 vscode 实例
    return div;
}