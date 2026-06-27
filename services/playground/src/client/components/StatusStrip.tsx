import type { ReactNode } from "react";

interface StatusStripProps {
  icon: ReactNode;
  text: string;
}

export function StatusStrip({ icon, text }: StatusStripProps) {
  return (
    <div className="status-strip">
      {icon}
      <span>{text}</span>
    </div>
  );
}
