import { DOM } from './config.js';
import { escapeHtml, getFileName } from './utils.js';

let currentChanges = [];
let isChangesPanelVisible = false;

export function toggleChangesPanel(vscode) {
    isChangesPanelVisible = !isChangesPanelVisible;
    DOM.changesPanel.classList.toggle('visible', isChangesPanelVisible);
    DOM.showChangesBtn.textContent = isChangesPanelVisible ? '📝 隐藏修改' : `📝 待确认修改 (${currentChanges.length})`;
    if (isChangesPanelVisible) {
        vscode.postMessage({ type: 'getPendingChanges' });
    }
}

export function updateChangesPanel(changes, vscode) {
    console.log('[updateChangesPanel] Called with:', changes);
    
    currentChanges = changes || [];
    
    if (currentChanges.length === 0) {
        DOM.changesList.innerHTML = '<div class="changes-empty">✅ 没有待确认的修改</div>';
        DOM.changeIndicator.style.display = 'none';
        return;
    }

    DOM.changeIndicator.style.display = 'flex';
    DOM.changeCount.textContent = currentChanges.length;
    DOM.showChangesBtn.style.display = 'inline-block';
    DOM.showChangesBtn.textContent = isChangesPanelVisible ? '📝 隐藏修改' : `📝 待确认修改 (${currentChanges.length})`;

    let html = '';
    for (const change of currentChanges) {
        const typeIcon = change.type === 'created' ? '📄' : change.type === 'modified' ? '✏️' : '🗑️';
        const typeLabel = change.type === 'created' ? '创建' : change.type === 'modified' ? '修改' : '删除';
        const fileName = getFileName(change.filePath);

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

    DOM.changesList.innerHTML = html;
    bindChangeEvents(vscode);
}

function bindChangeEvents(vscode) {
    DOM.changesList.querySelectorAll('.accept-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'acceptSingleChange', filePath: btn.dataset.path });
        };
    });

    DOM.changesList.querySelectorAll('.reject-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'rejectSingleChange', filePath: btn.dataset.path });
        };
    });

    DOM.changesList.querySelectorAll('.diff-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            console.log('[updateChangesPanel] Diff button clicked for:', btn.dataset.path);
            vscode.postMessage({ type: 'showFileDiff', filePath: btn.dataset.path });
        };
    });

    DOM.changesList.querySelectorAll('.change-item').forEach(item => {
        item.onclick = (e) => {
            if (e.target.closest('button')) return;
            console.log('[updateChangesPanel] Change item clicked:', item.dataset.path);
            vscode.postMessage({ type: 'showFileDiff', filePath: item.dataset.path });
        };
    });
}

export function getCurrentChanges() { return currentChanges; }