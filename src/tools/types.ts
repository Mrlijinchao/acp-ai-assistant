// 工具定义
export interface Tool {
    name: string;
    description: string;
    inputSchema: ToolInputSchema;
}

export interface ToolInputSchema {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
}

export interface PropertySchema {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    enum?: string[];
    items?: PropertySchema;
    default?: any;  // 添加 default 属性
}

// 工具调用
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface ToolResult {
    toolCallId: string;
    content: string;
    isError?: boolean;
}

// 内置工具定义
export const BUILTIN_TOOLS: Tool[] = [
    // 文件系统工具
    {
        name: 'read_file_mcp',
        description: 'Read the complete contents of a file',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file (absolute or relative to workspace)'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'write_file_mcp',
        description: 'Write content to a file (creates parent directories if needed)',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file'
                },
                content: {
                    type: 'string',
                    description: 'Content to write'
                }
            },
            required: ['path', 'content']
        }
    },
    {
        name: 'create_directory',
        description: 'Create a new directory',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the directory'
                },
                recursive: {
                    type: 'boolean',
                    description: 'Create parent directories if needed',
                    default: true
                }
            },
            required: ['path']
        }
    },
    {
        name: 'delete_file',
        description: 'Delete a file or empty directory',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file/directory'
                },
                force: {
                    type: 'boolean',
                    description: 'Force delete without confirmation',
                    default: false
                }
            },
            required: ['path']
        }
    },
    {
        name: 'list_directory',
        description: 'List contents of a directory',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the directory',
                    default: '.'
                },
                recursive: {
                    type: 'boolean',
                    description: 'List recursively',
                    default: false
                }
            }
        }
    },
    {
        name: 'move_file',
        description: 'Move or rename a file/directory',
        inputSchema: {
            type: 'object',
            properties: {
                source: {
                    type: 'string',
                    description: 'Source path'
                },
                destination: {
                    type: 'string',
                    description: 'Destination path'
                }
            },
            required: ['source', 'destination']
        }
    },
    
    // 搜索工具
    {
        name: 'search_files',
        description: 'Search for files using glob pattern',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Glob pattern (e.g., "**/*.ts")'
                },
                exclude: {
                    type: 'string',
                    description: 'Pattern to exclude (e.g., "node_modules/**")'
                }
            },
            required: ['pattern']
        }
    },
    {
        name: 'search_content',
        description: 'Search for text content in files',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Text or regex pattern to search'
                },
                filePattern: {
                    type: 'string',
                    description: 'File pattern to search in',
                    default: '**/*'
                },
                caseSensitive: {
                    type: 'boolean',
                    description: 'Case sensitive search',
                    default: false
                }
            },
            required: ['query']
        }
    },
    
    // 编辑器工具
    {
        name: 'get_current_file',
        description: 'Get the currently open file path and content',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_selection',
        description: 'Get the currently selected text',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'replace_selection',
        description: 'Replace the currently selected text',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text to replace selection with'
                }
            },
            required: ['text']
        }
    },
    {
        name: 'insert_text',
        description: 'Insert text at cursor position',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'Text to insert'
                },
                line: {
                    type: 'number',
                    description: 'Line number (0-indexed)'
                },
                character: {
                    type: 'number',
                    description: 'Character position'
                }
            },
            required: ['text']
        }
    },
    {
        name: 'format_document',
        description: 'Format the current document',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    
    // 终端工具
    {
        name: 'execute_command',
        description: 'Execute a terminal command',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'Command to execute'
                },
                cwd: {
                    type: 'string',
                    description: 'Working directory'
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds',
                    default: 30000
                }
            },
            required: ['command']
        }
    },
    {
        name: 'create_terminal',
        description: 'Create a new terminal session',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Terminal name'
                },
                cwd: {
                    type: 'string',
                    description: 'Working directory'
                }
            }
        }
    },
    {
        name: 'open_file',
        description: 'Open a file in the editor',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to the file to open'
                },
                line: {
                    type: 'number',
                    description: 'Line number to jump to'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'get_diagnostics',
        description: 'Get diagnostic errors/warnings for the current file',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path (defaults to current file)'
                }
            }
        }
    },
    
    // 项目工具
    {
        name: 'get_project_structure',
        description: 'Get the project folder structure',
        inputSchema: {
            type: 'object',
            properties: {
                depth: {
                    type: 'number',
                    description: 'Directory depth',
                    default: 2
                }
            }
        }
    },
    {
        name: 'install_package',
        description: 'Install an npm package',
        inputSchema: {
            type: 'object',
            properties: {
                packageName: {
                    type: 'string',
                    description: 'Package name to install'
                },
                dev: {
                    type: 'boolean',
                    description: 'Install as dev dependency',
                    default: false
                }
            },
            required: ['packageName']
        }
    },
    // 添加工作区工具
    {
        name: 'get_workspace_info',
        description: 'Get information about the current workspace (folders, paths, etc.)',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_current_file',
        description: 'Get information about the currently open file',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'list_workspace_files',
        description: 'List files in the current workspace',
        inputSchema: {
            type: 'object',
            properties: {
                depth: {
                    type: 'number',
                    description: 'Directory depth to explore',
                    default: 2
                }
            }
        }
    }
];