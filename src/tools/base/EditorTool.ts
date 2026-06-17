import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';

export class EditorTool {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('EditorTool');
    }

    getCurrentFile(): { path: string; content: string; languageId: string } | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return null;
        
        return {
            path: editor.document.uri.fsPath,
            content: editor.document.getText(),
            languageId: editor.document.languageId
        };
    }

    getSelection(): string | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return null;
        
        return editor.document.getText(editor.selection);
    }

    async replaceSelection(text: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor');
        
        await editor.edit(editBuilder => {
            editBuilder.replace(editor.selection, text);
        });
    }

    async insertText(text: string, line?: number, character?: number): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor');
        
        let position: vscode.Position;
        if (line !== undefined && character !== undefined) {
            position = new vscode.Position(line, character);
        } else {
            position = editor.selection.active;
        }
        
        await editor.edit(editBuilder => {
            editBuilder.insert(position, text);
        });
    }

    async formatDocument(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor');
        
        await vscode.commands.executeCommand('editor.action.formatDocument');
    }

    async openFile(filePath: string, line?: number): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        
        if (line !== undefined) {
            const position = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        }
    }

    async getDiagnostics(filePath?: string): Promise<any[]> {
        if (filePath) {
            const uri = vscode.Uri.file(filePath);
            return vscode.languages.getDiagnostics(uri);
        }
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) return [];
        
        return vscode.languages.getDiagnostics(editor.document.uri);
    }
}