import { useCallback, useRef, type UIEvent } from "react";
import { Braces } from "lucide-react";
import { SyntaxCode } from "./SyntaxCode";

interface EditorPanelProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

export function EditorPanel({ value, onChange, disabled }: EditorPanelProps) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const syncHighlightScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    if (!highlightRef.current) {
      return;
    }
    highlightRef.current.scrollTop = event.currentTarget.scrollTop;
    highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
  }, []);

  return (
    <section className="panel editor-panel" aria-labelledby="syntax-title">
      <div className="panel-header">
        <div className="panel-title">
          <Braces aria-hidden="true" size={17} />
          <h2 id="syntax-title">New Syntax</h2>
        </div>
      </div>
      <div className="editor-surface">
        <SyntaxCode
          ref={highlightRef}
          value={value}
          language="gql"
          className="code-highlight editor-highlight"
          ariaHidden
          padTrailingLine
        />
        <textarea
          className="code-editor"
          spellCheck={false}
          wrap="off"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncHighlightScroll}
          aria-label="New syntax query editor"
        />
      </div>
    </section>
  );
}
