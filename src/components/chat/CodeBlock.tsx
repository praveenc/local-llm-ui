import React from 'react';
import { CodeView } from '@cloudscape-design/code-view';
import { CopyToClipboard } from '@cloudscape-design/components';

// Import common language highlighters
import javascriptHighlight from '@cloudscape-design/code-view/highlight/javascript';
import typescriptHighlight from '@cloudscape-design/code-view/highlight/typescript';
import pythonHighlight from '@cloudscape-design/code-view/highlight/python';
import jsonHighlight from '@cloudscape-design/code-view/highlight/json';
import yamlHighlight from '@cloudscape-design/code-view/highlight/yaml';
import cssHighlight from '@cloudscape-design/code-view/highlight/css';
import htmlHighlight from '@cloudscape-design/code-view/highlight/html';
import shHighlight from '@cloudscape-design/code-view/highlight/sh';

interface CodeBlockProps {
    code: string;
    language?: string;
}

const getHighlighter = (language?: string) => {
    if (!language) return undefined;

    const lang = language.toLowerCase();

    const highlighterMap: Record<string, (code: string) => React.ReactNode> = {
        javascript: javascriptHighlight,
        js: javascriptHighlight,
        typescript: typescriptHighlight,
        ts: typescriptHighlight,
        tsx: typescriptHighlight,
        jsx: javascriptHighlight,
        python: pythonHighlight,
        py: pythonHighlight,
        json: jsonHighlight,
        yaml: yamlHighlight,
        yml: yamlHighlight,
        css: cssHighlight,
        scss: cssHighlight,
        html: htmlHighlight,
        xml: htmlHighlight,
        bash: shHighlight,
        sh: shHighlight,
        shell: shHighlight,
        zsh: shHighlight,
    };

    return highlighterMap[lang];
};

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
    const highlighter = getHighlighter(language);

    return (
        <CodeView
            content={code}
            highlight={highlighter}
            lineNumbers
            actions={
                <CopyToClipboard
                    copyButtonAriaLabel="Copy code"
                    copyErrorText="Failed to copy"
                    copySuccessText="Code copied"
                    textToCopy={code}
                    variant="icon"
                />
            }
        />
    );
};

export default CodeBlock;
