import { fixUnclosedCodeBlocks } from './markdown-fix.js';
// 需要引入 utils 的 escapeHtml
import { escapeHtml } from './utils.js';

let md = null;

export function initMarkdownIt() {
    if (typeof markdownit !== 'undefined' && !md) {
        md = markdownit({
            html: false,
            xhtmlOut: false,
            breaks: true,
            linkify: true,
            typographer: true,
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        const highlighted = hljs.highlight(code, { language: lang }).value;
                        return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
                    } catch (err) {
                        console.error('Highlight error:', err);
                    }
                }
                return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`;
            }
        });
        console.log('✅ Markdown-it initialized');
    }
    return md;
}

export function renderMarkdown(text) {
    if (!text) return '';
    try {
        if (!md) initMarkdownIt();
        if (!md) return escapeHtml(text);

        // ⭐ 关键：在渲染前修复未闭合的代码块
        const fixedText = fixUnclosedCodeBlocks(text);
        console.log("===============================");
        console.log(fixedText);
        console.log("===============================");
        
        // 如果修复了文本，记录日志（用于调试）
        if (fixedText !== text) {
            console.log('📝 [Markdown] Fixed unclosed code blocks');
        }
        
        return md.render(fixedText);

        // return md.render(text);
    } catch (err) {
        console.error('Markdown parse error:', err);
        return escapeHtml(text);
    }
}

export function highlightCodeBlocks(element) {
    if (typeof hljs !== 'undefined' && element) {
        const codeBlocks = element.querySelectorAll('pre code:not(.hljs)');
        codeBlocks.forEach((block) => {
            try {
                hljs.highlightElement(block);
            } catch (err) {
                console.error('Highlight.js error:', err);
            }
        });
    }
}
