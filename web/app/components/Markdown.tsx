'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({children}) => <h1 className="text-xl font-semibold text-gray-100 mt-6 mb-3">{children}</h1>,
          h2: ({children}) => <h2 className="text-lg font-semibold text-gray-100 mt-6 mb-3">{children}</h2>,
          h3: ({children}) => <h3 className="text-base font-semibold text-gray-100 mt-4 mb-2">{children}</h3>,
          p: ({children}) => <p className="text-gray-300 leading-relaxed mb-4">{children}</p>,
          ul: ({children}) => <ul className="list-disc list-inside text-gray-300 mb-4 space-y-1 ml-2">{children}</ul>,
          ol: ({children}) => <ol className="list-decimal list-inside text-gray-300 mb-4 space-y-1 ml-2">{children}</ol>,
          li: ({children}) => <li className="text-gray-300">{children}</li>,
          a: ({href, children}) => <a href={href} className="text-blue-400 hover:underline">{children}</a>,
          strong: ({children}) => <strong className="text-gray-200 font-semibold">{children}</strong>,
          em: ({children}) => <em className="italic">{children}</em>,
          code: ({children, className}) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return <code className={className}>{children}</code>;
            }
            return <code className="bg-gray-800 px-1.5 py-0.5 rounded text-sm text-green-400">{children}</code>;
          },
          pre: ({children}) => <pre className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4 overflow-x-auto text-sm">{children}</pre>,
          blockquote: ({children}) => <blockquote className="border-l-4 border-blue-500 pl-4 my-4 text-gray-400 italic">{children}</blockquote>,
          hr: () => <hr className="my-6 border-gray-700" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
