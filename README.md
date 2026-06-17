# ACP AI Assistant

AI Programming Assistant using Agent Communication Protocol (ACP).

## Features

- 🤖 **AI Agent Integration** - Connect to any ACP-compatible AI agent
- 💬 **Chat Interface** - Interactive chat with your AI assistant
- 📝 **Code Understanding** - Get AI help with your code
- 🔧 **Code Refactoring** - Improve your code with AI suggestions
- 📊 **Session Management** - Multiple conversation sessions support
- 💾 **Chat History** - Save and load conversation history

## Usage

1. **Start the Agent**: Click the "Start" button in the chat panel
2. **Send Messages**: Type your message and press Enter
3. **Use Commands**: Right-click on selected code for AI actions
4. **Keyboard Shortcuts**:
   - `Ctrl+Alt+S` (Mac: `Cmd+Alt+S`) - Send selected code
   - `Ctrl+Alt+E` (Mac: `Cmd+Alt+E`) - Explain selected code

## Configuration

Configure the extension in VSCode settings:

```json
{
    "acp.agent.command": "node",
    "acp.agent.args": ["path/to/agent/server.js"],
    "acp.agent.env": {
        "API_KEY": "your-api-key"
    },
    "acp.debug": true
}