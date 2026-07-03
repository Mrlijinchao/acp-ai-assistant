import { DOM } from './config.js';

export function updateAgentStatus(status, text, startBtnDisabled = false) {
    DOM.statusDot.className = `status-dot ${status}`;
    DOM.statusText.innerText = text;
    DOM.startBtn.disabled = startBtnDisabled;
}

export function updateInputState(enabled) {
    DOM.input.disabled = !enabled;
    DOM.sendBtn.disabled = !enabled;
}

export function showAgentReady() {
    updateAgentStatus('running', 'Agent running', false);
    updateInputState(true);
}

export function showAgentStopped() {
    updateAgentStatus('stopped', 'Agent not started', false);
    updateInputState(false);
}

export function showAgentStarting() {
    updateAgentStatus('starting', 'Agent starting...', true);
    updateInputState(false);
}

export function showAgentError() {
    updateAgentStatus('stopped', 'Agent start failed', false);
    updateInputState(false);
}