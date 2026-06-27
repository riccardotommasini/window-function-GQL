export const backends = [
  {
    id: "apoc",
    label: "APOC",
    description: "Rewrites row-window syntax to apoc.window.runRows and executes in Neo4j."
  },
  {
    id: "neo4j-sqlite",
    label: "Neo4j + SQLite",
    description: "Runs the graph binding query in Neo4j, then evaluates the window in in-memory SQLite."
  }
] as const;
