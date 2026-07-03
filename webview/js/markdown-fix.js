/**
 * 修复未闭合的代码块
 * 核心思路：确保代码块标记（```）成对出现
 */
export function fixUnclosedCodeBlocks(text) {
    if (!text || typeof text !== 'string') return text;
    
    // 如果文本中没有代码块标记，直接返回
    if (!text.includes('```')) {
        return text;
    }
    
    // 分割成行
    const lines = text.split('\n');
    let fixedLines = [];
    let codeBlockCount = 0;
    let insideCodeBlock = false;
    let lastFenceIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmedLine = line.trim();
        
        // 检查这一行是否是代码块标记
        // 匹配：``` 或 ```language
        const isCodeFence = /^```(\w*)$/.test(trimmedLine);

        if (isCodeFence && codeBlockCount === 0){
            line = line.replace('```','~~~')
        }
        
        if (isCodeFence) {
            lastFenceIndex = i;
            codeBlockCount++;
            // 如果当前在代码块内，遇到标记就退出
            // 如果不在代码块内，遇到标记就进入
            insideCodeBlock = !insideCodeBlock;
            fixedLines.push(line);
        } else {
            // 普通行，直接添加
            fixedLines.push(line);
        }
    }
    
    // 如果代码块标记是奇数个（未闭合），在末尾补一个结束标记
    if (codeBlockCount % 2 === 1) {
        fixedLines.push('~~~');
        console.log('🔧 [MarkdownFix] Added missing closing code block');
    } else if (lastFenceIndex != 0) {
        // fixedLines[lastFenceIndex] = fixedLines[lastFenceIndex].replace('```','~~~');
        const line = fixedLines[lastFenceIndex];
        const lastIndex = line.lastIndexOf('```');
        if (lastIndex !== -1) {
            fixedLines[lastFenceIndex] = line.slice(0, lastIndex) + '~~~' + line.slice(lastIndex + 3);
        }
    }
    
    return fixedLines.join('\n');
}

/**
 * 增强版：更智能的修复（处理嵌套和特殊情况）
 */
export function fixUnclosedCodeBlocksAdvanced(text) {
    if (!text || typeof text !== 'string') return text;
    
    // 如果文本中没有代码块标记，直接返回
    if (!text.includes('```')) {
        return text;
    }
    
    const lines = text.split('\n');
    let result = [];
    let openCount = 0;
    let i = 0;
    
    while (i < lines.length) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // 检查是否是代码块标记（更精确的匹配）
        // 匹配：``` 或 ```language 或 ```language 后面有空格
        const codeFenceMatch = trimmedLine.match(/^```(\w*)\s*$/);
        
        if (codeFenceMatch) {
            openCount++;
            result.push(line);
            
            // 如果这是第奇数个标记（进入代码块）
            if (openCount % 2 === 1) {
                // 检查后续是否有内容，如果有，确保它们被正确处理
                // 这里不需要额外操作
            }
        } else {
            result.push(line);
        }
        
        i++;
    }
    
    // 如果代码块未闭合
    if (openCount % 2 === 1) {
        result.push('```');
        console.log('🔧 [MarkdownFix] Added missing closing code block');
    }
    
    return result.join('\n');
}

/**
 * 检查代码块是否完整（不修改文本，仅检测）
 */
export function hasUnclosedCodeBlock(text) {
    if (!text || typeof text !== 'string') return false;
    
    // 统计代码块标记数量
    const matches = text.match(/```/g);
    if (!matches) return false;
    
    // 如果标记数量是奇数，说明有未闭合的代码块
    return matches.length % 2 === 1;
}

/**
 * 获取代码块状态（用于调试）
 */
export function getCodeBlockStatus(text) {
    if (!text || typeof text !== 'string') {
        return { totalFences: 0, isUnclosed: false, openBlocks: 0 };
    }
    
    const matches = text.match(/```/g);
    const totalFences = matches ? matches.length : 0;
    const isUnclosed = totalFences % 2 === 1;
    
    // 统计打开的代码块数量
    let openBlocks = 0;
    const lines = text.split('\n');
    for (const line of lines) {
        if (/^```(\w*)$/.test(line.trim())) {
            openBlocks++;
        }
    }
    
    return {
        totalFences,
        isUnclosed,
        openBlocks: Math.ceil(openBlocks / 2)
    };
}