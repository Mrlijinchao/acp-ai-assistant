import { DOM } from './config.js';
import { escapeHtml, getFileName } from './utils.js';

// 获取DOM元素
// 新建会话 - 直接创建，不需要弹窗
// if (DOM.newSessionBtn) {
//     DOM.newSessionBtn.addEventListener('click', function() {
//         console.log('📝 创建新会话');
//         vscode.postMessage({ type: 'createSession' });
//     });
// } else {
//     console.warn('DOM.newSessionBtn not found');
// }

// export function toggleSessionList() {
//     DOM.isSessionListExpanded = !DOM.isSessionListExpanded;
//     if (DOM.lisSessionListExpanded) {
//         DOM.sessionListWrapper.classList.add('expanded');
//         DOM.sessionToggle.classList.remove('collapsed');
//     } else {
//         DOM.sessionListWrapper.classList.remove('expanded');
//         DOM.sessionToggle.classList.add('collapsed');
//     }
// }

export function initSessionHandlers() {
    console.log('🔧 [SessionHandler] Initializing...');
    
    // 新建会话
    if (DOM.newSessionBtn) {
        DOM.newSessionBtn.addEventListener('click', function() {
            console.log('📝 创建新会话');
            vscode.postMessage({ type: 'createSession' });
        });
    } else {
        console.warn('⚠️ DOM.newSessionBtn not found');
    }

    // 会话头部点击事件 - 添加安全检查
    if (DOM.sessionHeader) {
        DOM.sessionHeader.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            toggleSessionList();
        });
        console.log('✅ Session header event attached');
    } else {
        console.warn('⚠️ DOM.sessionHeader not found');
    }

    // 初始化时确保会话列表状态正确
    if (DOM.sessionListWrapper && DOM.sessionToggle) {
        // 默认展开
        DOM.sessionListWrapper.classList.add('expanded');
        DOM.sessionToggle.classList.remove('collapsed');
        DOM.isSessionListExpanded = true;
    }
}

export function toggleSessionList() {
    // 检查必要的 DOM 元素
    if (!DOM.sessionListWrapper || !DOM.sessionToggle) {
        console.warn('⚠️ Session toggle elements not ready, skipping');
        return;
    }
    
    DOM.isSessionListExpanded = !DOM.isSessionListExpanded;
    if (DOM.isSessionListExpanded) {
        DOM.sessionListWrapper.classList.add('expanded');
        DOM.sessionToggle.classList.remove('collapsed');
    } else {
        DOM.sessionListWrapper.classList.remove('expanded');
        DOM.sessionToggle.classList.add('collapsed');
    }
}


// 更新会话列表
export function updateSessions(sessionData, vscode) {

       // 检查必要的 DOM 元素
    if (!DOM.sessionList || !DOM.sessionCount) {
        console.warn('⚠️ Session DOM elements not ready');
        return;
    }
    

    DOM.sessions = sessionData.sessions || [];
    DOM.currentSessionId = sessionData.currentSessionId;
    
    // 更新会话数量
    DOM.sessionCount.textContent = DOM.sessions.length;
    
    if (!DOM.sessionList) return;
    
    if (DOM.sessions.length === 0) {
        DOM.sessionList.innerHTML = '<div class="session-empty">暂无会话，点击 "+新建" 创建</div>';
        return;
    }
    
    DOM.sessionList.innerHTML = '';
    DOM.sessions.forEach(session => {
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
            console.log('🔄 切换会话1:', session.name);
            if (!session.isActive) {
                console.log('🔄 切换会话:', session.name);
                vscode.postMessage({ 
                    type: 'switchSession', 
                    sessionId: session.id 
                });
            }
        });
        
        DOM.sessionList.appendChild(item);
    });
}


export function handleSessionCreated(session) {
    // 清空消息
    // clearMessages();
    // 更新会话列表
    const updatedSessions = [session, ...DOM.sessions.filter(s => s.id !== session.id)];
    updateSessions({
        sessions: updatedSessions,
        currentSessionId: session.id
    });
}

function bindChangeEvents(vscode) {
    DOM.changesList.querySelectorAll('.accept-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'acceptSingleChange', filePath: btn.dataset.path });
        };
    });
}

// 确保导出一个初始化函数
export function init() {
    initSessionHandlers();
}
