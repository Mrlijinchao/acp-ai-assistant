import { DOM } from './config.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { escapeHtml } from './utils.js';

// 状态变量
let currentMsgDiv = null;
let currentAssistantDiv = null;
let currentThoughtDiv = null;
let currentThoughtContent = '';

// export function addMessage(role, content) {
//     if (role === 'user') {
//         currentAssistantDiv = null;
//         if (window.activeToolCalls) window.activeToolCalls.clear();
//         currentMsgDiv = null;
//     }
    
//     const div = document.createElement('div');
//     div.className = 'message ' + role;
    
//     if (role === 'assistant') {
//         const renderedContent = renderMarkdown(content);
//         div.innerHTML = `
//             <div class="message-header">Assistant</div>
//             <div class="tool-calls-container"></div>
//             <div class="message-content">${renderedContent}</div>
//         `;
//         window.currentToolCallsContainer = div.querySelector('.tool-calls-container');
//         currentAssistantDiv = div;
//         currentMsgDiv = div.querySelector('.message-content');
//         highlightCodeBlocks(currentMsgDiv);
//     } else {
//         div.innerHTML = `
//             <div class="message-header">${role === 'user' ? 'You' : 'System'}</div>
//             <div class="message-content">${escapeHtml(content)}</div>
//         `;
//     }
//     console.log("role: " + role)
//     console.log(content)
//     console.log("DOM1:")
//     console.log(DOM.messagesDiv)
//     console.log("DIV:")
//     console.log(div)
//     DOM.messagesDiv.appendChild(div);
//     DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
//     console.log("DOM2:")
//     console.log(DOM.messagesDiv)
//     currentThoughtDiv = null;
//     currentThoughtContent = '';
    
//     return div;
// }


// message-handler.js

export function addMessage(role, content) {
    // 使用 document.getElementById 直接获取
    const messagesDiv = document.getElementById('messages');
    
    if (!messagesDiv) {
        console.error('❌ messagesDiv not found!');
        return null;
    }
    
    // 验证 messagesDiv 是否在 DOM 树中
    console.log('📝 messagesDiv parent:', messagesDiv.parentElement);
    console.log('📝 messagesDiv is connected:', messagesDiv.isConnected);
    
    // 如果不在 DOM 树中，尝试重新获取
    if (!messagesDiv.isConnected) {
        console.warn('⚠️ messagesDiv is not connected to DOM, trying to find it again');
        const newMessagesDiv = document.getElementById('messages');
        if (newMessagesDiv) {
            console.log('✅ Found new messagesDiv:', newMessagesDiv);
            // 使用新的引用继续
            return addMessageWithDiv(role, content, newMessagesDiv);
        }
    }
    
    return addMessageWithDiv(role, content, messagesDiv);
}

function addMessageWithDiv(role, content, messagesDiv) {
    if (role === 'user') {
        window.currentAssistantDiv = null;
        if (window.activeToolCalls) window.activeToolCalls.clear();
        window.currentMsgDiv = null;
    }
    
    const div = document.createElement('div');
    div.className = 'message ' + role;
    
    if (role === 'assistant') {
        const renderedContent = renderMarkdown(content);
        div.innerHTML = `
            <div class="message-header">Assistant</div>
            <div class="tool-calls-container"></div>
            <div class="message-content">${renderedContent}</div>
        `;
        window.currentToolCallsContainer = div.querySelector('.tool-calls-container');
        window.currentAssistantDiv = div;
        window.currentMsgDiv = div.querySelector('.message-content');
        highlightCodeBlocks(window.currentMsgDiv);
    } else {
        div.innerHTML = `
            <div class="message-header">${role === 'user' ? 'You' : 'System'}</div>
            <div class="message-content">${escapeHtml(content)}</div>
        `;
    }
    
    // 使用 appendChild 并验证是否成功
    console.log('📝 Before appendChild, messagesDiv children:', messagesDiv.children.length);
    messagesDiv.appendChild(div);
    console.log('📝 After appendChild, messagesDiv children:', messagesDiv.children.length);
    console.log('📝 New div parent:', div.parentElement);
    console.log('📝 New div is connected:', div.isConnected);
    console.log(messagesDiv.children[0])
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    window.currentThoughtDiv = null;
    window.currentThoughtContent = '';

    return div;
}

export function startAssistantMessage() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
        <div class="message-header">Assistant</div>
        <div class="tool-calls-container"></div>
        <div class="message-content"></div>
    `;
    DOM.messagesDiv.appendChild(div);
    DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
    
    currentAssistantDiv = div;
    window.currentToolCallsContainer = div.querySelector('.tool-calls-container');
    currentMsgDiv = div.querySelector('.message-content');
    return currentMsgDiv;
}

export function updateAssistantMessage(content) {
    if (currentMsgDiv) {
        const renderedContent = renderMarkdown(content);
        currentMsgDiv.innerHTML = renderedContent;
        highlightCodeBlocks(currentMsgDiv);
        if (DOM.messagesDiv.scrollTop + DOM.messagesDiv.clientHeight >= DOM.messagesDiv.scrollHeight - 5) {
            DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
        }
    }
}

export function showThoughtMessage(chunk) {
    if (!currentThoughtDiv) {
        currentThoughtDiv = document.createElement('div');
        currentThoughtDiv.className = 'message thought';
        currentThoughtDiv.innerHTML = `
            <div class="message-header">
                <span class="thought-icon">💭</span> Thinking...
            </div>
            <div class="message-content thought-content"></div>
        `;
        DOM.messagesDiv.appendChild(currentThoughtDiv);
        currentThoughtContent = '';
    }
    
    currentThoughtContent += chunk;
    const contentDiv = currentThoughtDiv.querySelector('.message-content');
    contentDiv.innerHTML = escapeHtml(currentThoughtContent);
    DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
}

export function clearMessages() {
    DOM.messagesDiv.innerHTML = '';
    currentMsgDiv = null;
    currentAssistantDiv = null;
    currentThoughtDiv = null;
    if (window.activeToolCalls) window.activeToolCalls.clear();
}

export function getCurrentMsgDiv() { return currentMsgDiv; }
export function getCurrentToolCallsContainer() { return window.currentToolCallsContainer; }