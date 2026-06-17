// storage/ChatHistory.ts
import * as vscode from 'vscode';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}

export class ChatHistory {
    private storage: vscode.Memento;
    private maxMessages = 100;

    constructor(context: vscode.ExtensionContext) {
        this.storage = context.globalState;
    }

    async addMessage(role: ChatMessage['role'], content: string): Promise<void> {
        const messages = await this.getMessages();
        messages.push({
            role,
            content,
            timestamp: Date.now()
        });
        
        // 限制消息数量
        if (messages.length > this.maxMessages) {
            messages.splice(0, messages.length - this.maxMessages);
        }
        
        await this.storage.update('chatHistory', messages);
        console.log(`Message saved: ${role}, length: ${content.length}`);
    }

    async addAssistantMessage(content: string): Promise<void> {
        await this.addMessage('assistant', content);
    }

    async getMessages(): Promise<ChatMessage[]> {
        const messages = this.storage.get<ChatMessage[]>('chatHistory', []);
        console.log(`Loaded ${messages.length} messages from storage`);
        return messages;
    }

    async clear(): Promise<void> {
        await this.storage.update('chatHistory', []);
        console.log('Chat history cleared');
    }

    async export(): Promise<string> {
        const messages = await this.getMessages();
        return JSON.stringify(messages, null, 2);
    }

    async import(data: string): Promise<void> {
        try {
            const messages = JSON.parse(data) as ChatMessage[];
            if (Array.isArray(messages)) {
                await this.storage.update('chatHistory', messages);
                console.log(`Imported ${messages.length} messages`);
            } else {
                throw new Error('Invalid format');
            }
        } catch (error) {
            throw new Error('Failed to import chat history: Invalid JSON format');
        }
    }
}