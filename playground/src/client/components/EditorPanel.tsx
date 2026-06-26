import { Braces } from "lucide-react";

interface EditorPanelProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

export function EditorPanel({ value, onChange, disabled }: EditorPanelProps) {
  return (
    <section className="panel editor-panel" aria-labelledby="syntax-title">
      <div className="panel-header">
        <div className="panel-title">
          <Braces aria-hidden="true" size={17} />
          <h2 id="syntax-title">New Syntax</h2>
        </div>
      </div>
      <textarea
        className="code-editor"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label="New syntax query editor"
      />
    </section>
  );
}
