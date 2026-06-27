export type SyntaxLanguage = "gql" | "cypher" | "sql";

export type SyntaxTokenKind =
  | "plain"
  | "comment"
  | "function"
  | "keyword"
  | "number"
  | "operator"
  | "procedure"
  | "string";

export interface SyntaxToken {
  kind: SyntaxTokenKind;
  value: string;
}

const gqlKeywords = new Set([
  "AND",
  "AS",
  "ASC",
  "BETWEEN",
  "BY",
  "CALL",
  "CASE",
  "CURRENT",
  "CURRENT_ROW",
  "DESC",
  "DISTINCT",
  "EDGES",
  "ELSE",
  "END",
  "EXCLUDE",
  "FOLLOWING",
  "FROM",
  "GROUP",
  "GROUPS",
  "IN",
  "IS",
  "MATCH",
  "NO",
  "NODE",
  "NODES",
  "NOT",
  "NULL",
  "OR",
  "ORDER",
  "OTHERS",
  "OVER",
  "PARTITION",
  "PATH",
  "PRECEDING",
  "RANGE",
  "RETURN",
  "ROW",
  "ROWS",
  "THEN",
  "TIES",
  "UNBOUNDED",
  "WHEN",
  "WHERE",
  "WITH"
]);

const sqlKeywords = new Set([
  "AND",
  "AS",
  "ASC",
  "BETWEEN",
  "BY",
  "CASE",
  "CURRENT",
  "DESC",
  "DISTINCT",
  "EXCLUDE",
  "FOLLOWING",
  "FROM",
  "GROUP",
  "GROUPS",
  "IN",
  "IS",
  "NOT",
  "NULL",
  "OR",
  "ORDER",
  "OVER",
  "PARTITION",
  "PRECEDING",
  "RANGE",
  "ROW",
  "ROWS",
  "SELECT",
  "TIES",
  "UNBOUNDED",
  "WHERE",
  "WINDOW"
]);

const functions = new Set([
  "coalesce",
  "collect",
  "count",
  "date",
  "datetime",
  "duration",
  "head",
  "length",
  "nodes",
  "position",
  "rank",
  "reduce",
  "relationships",
  "row_number",
  "sum",
  "tail",
  "time"
]);

export function tokenizeSyntax(input: string, language: SyntaxLanguage): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];

    if (/\s/.test(char)) {
      const end = readWhile(input, index, (value) => /\s/.test(value));
      pushToken(tokens, "plain", input.slice(index, end));
      index = end;
      continue;
    }

    if ((char === "/" && next === "/") || (language === "sql" && char === "-" && next === "-")) {
      const end = readUntilLineEnd(input, index);
      pushToken(tokens, "comment", input.slice(index, end));
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const end = input.indexOf("*/", index + 2);
      const commentEnd = end === -1 ? input.length : end + 2;
      pushToken(tokens, "comment", input.slice(index, commentEnd));
      index = commentEnd;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      const end = readQuoted(input, index, char);
      pushToken(tokens, "string", input.slice(index, end));
      index = end;
      continue;
    }

    const procedure = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/);
    if (procedure) {
      pushToken(tokens, "procedure", procedure[0]);
      index += procedure[0].length;
      continue;
    }

    const number = input.slice(index).match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      pushToken(tokens, "number", number[0]);
      index += number[0].length;
      continue;
    }

    const word = input.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const value = word[0];
      pushToken(tokens, classifyWord(input, index, value, language), value);
      index += value.length;
      continue;
    }

    if (/[-+*/%=<>!|.,:;()[\]{}]/.test(char)) {
      pushToken(tokens, "operator", char);
      index += 1;
      continue;
    }

    pushToken(tokens, "plain", char);
    index += 1;
  }

  return tokens;
}

function classifyWord(input: string, index: number, value: string, language: SyntaxLanguage): SyntaxTokenKind {
  const upper = value.toUpperCase();
  const keywordSet = language === "sql" ? sqlKeywords : gqlKeywords;
  if (keywordSet.has(upper)) {
    return "keyword";
  }

  const lower = value.toLowerCase();
  const nextNonWhitespace = input.slice(index + value.length).match(/^\s*(.)/)?.[1];
  if (functions.has(lower) || nextNonWhitespace === "(") {
    return "function";
  }

  return "plain";
}

function readQuoted(input: string, start: number, quote: string) {
  let index = start + 1;
  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) {
      if ((quote === "'" || quote === '"') && next === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return input.length;
}

function readUntilLineEnd(input: string, start: number) {
  const end = input.indexOf("\n", start);
  return end === -1 ? input.length : end;
}

function readWhile(input: string, start: number, predicate: (value: string) => boolean) {
  let index = start;
  while (index < input.length && predicate(input[index])) {
    index += 1;
  }
  return index;
}

function pushToken(tokens: SyntaxToken[], kind: SyntaxTokenKind, value: string) {
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === kind) {
    previous.value += value;
    return;
  }
  tokens.push({ kind, value });
}
