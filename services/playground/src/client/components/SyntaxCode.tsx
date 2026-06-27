import { Fragment, forwardRef, useMemo } from "react";
import { tokenizeSyntax, type SyntaxLanguage } from "../syntaxHighlight";

interface SyntaxCodeProps {
  value: string;
  language: SyntaxLanguage;
  className?: string;
  ariaLabel?: string;
  ariaHidden?: boolean;
  padTrailingLine?: boolean;
}

export const SyntaxCode = forwardRef<HTMLPreElement, SyntaxCodeProps>(function SyntaxCode(
  { value, language, className, ariaLabel, ariaHidden = false, padTrailingLine = false },
  ref
) {
  const displayValue = padTrailingLine && value.endsWith("\n") ? `${value} ` : value;
  const tokens = useMemo(() => tokenizeSyntax(displayValue, language), [displayValue, language]);

  return (
    <pre
      ref={ref}
      className={["syntax-code", `syntax-${language}`, className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden || undefined}
    >
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          <Fragment key={`${token.kind}-${index}`}>{token.value}</Fragment>
        ) : (
          <span key={`${token.kind}-${index}`} className={`tok tok-${token.kind}`}>
            {token.value}
          </span>
        )
      )}
    </pre>
  );
});
