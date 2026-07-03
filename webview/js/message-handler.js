import { DOM } from './config.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { escapeHtml } from './utils.js';

// 状态变量
let currentMsgDiv = null;
let currentAssistantDiv = null;
let currentThoughtDiv = null;
let currentThoughtContent = '';

export function addMessage(role, content) {
    if (role === 'user') {
        currentAssistantDiv = null;
        if (window.activeToolCalls) window.activeToolCalls.clear();
        currentMsgDiv = null;
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
        currentAssistantDiv = div;
        currentMsgDiv = div.querySelector('.message-content');
        highlightCodeBlocks(currentMsgDiv);
    } else {
        div.innerHTML = `
            <div class="message-header">${role === 'user' ? 'You' : 'System'}</div>
            <div class="message-content">${escapeHtml(content)}</div>
        `;
    }
    
    DOM.messagesDiv.appendChild(div);
    DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
    
    currentThoughtDiv = null;
    currentThoughtContent = '';
    
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