# `apoc.window.*` for Neo4j

This project adds read-only Neo4j procedures named `apoc.window.run`, `apoc.window.runRows`, `apoc.window.runPath`, and `apoc.window.runPathRows` that apply SQL-style window functions to Cypher row sets and path elements.

The current implementation supports:

- functions: `sum`, `rank`, `row_number`
- partition keys over projected scalar, node, relationship, and path values
- path-element windows over path `EDGES` and `NODES`
- `ORDER BY` over projected columns
- frame modes: `ROWS`, `RANGE`, `GROUPS`
- frame boundaries:
  - `UNBOUNDED PRECEDING`
  - `n PRECEDING`
  - `CURRENT ROW`
  - `n FOLLOWING`
  - `UNBOUNDED FOLLOWING`
- exclusion modes:
  - `NO OTHERS`
  - `CURRENT ROW`
  - `GROUP`
  - `TIES`

`rank` and `row_number` use the partition ordering and ignore the frame, as in SQL. `sum` is frame-sensitive.

## Compatibility

- Java 21
- Neo4j `2026.04.x`
- Maven `3.9.4+`

The test suite is built around Neo4j Harness `2026.04.0` and the Neo4j Java driver `6.0.4`.

## Build

```shell
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
./mvnw clean package
```

This produces:

```text
target/procedure-template-1.0.0-SNAPSHOT.jar
```

## Install Into Neo4j

These steps are for a self-managed Neo4j server.

1. Build the JAR with Maven.
2. Copy the JAR into the Neo4j `plugins` directory on every server that should load the procedure.
3. If your Neo4j deployment uses a procedure allowlist, add `apoc.window.*` to `dbms.security.procedures.allowlist` in `conf/neo4j.conf`.
4. `dbms.security.procedures.unrestricted` is not required for this procedure. It uses the standard procedure APIs only.
5. Restart Neo4j.
6. Verify that the procedure is visible.

```shell
cp target/procedure-template-1.0.0-SNAPSHOT.jar $NEO4J_HOME/plugins/
```

```properties
# Only needed if you already use an allowlist
dbms.security.procedures.allowlist=apoc.window.run,apoc.window.*
```

```cypher
SHOW PROCEDURES YIELD name, signature
WHERE name IN ['apoc.window.run', 'apoc.window.runRows', 'apoc.window.runPath', 'apoc.window.runPathRows']
RETURN name, signature;
```

For operational background on custom code and plugin loading, see:

- [Neo4j Java Reference: Customized code](https://neo4j.com/docs/java-reference/current/extending-neo4j/customized-code/)
- [Neo4j Operations Manual: Securing extensions](https://neo4j.com/docs/operations-manual/current/security/securing-extensions/)
- [Neo4j Operations Manual: Docker plugins](https://neo4j.com/docs/operations-manual/current/docker/plugins/)

## Procedure Signatures

```cypher
CALL apoc.window.run(sourceQuery, params, spec, includePartitionId)
YIELD row
RETURN row
```

Arguments:

- `sourceQuery`: Cypher text that returns the binding table to window over.
- `params`: parameter map for `sourceQuery`.
- `spec`: window specification map.
- `includePartitionId`: optional boolean. When `true`, appends `partitionId` to each output row. Defaults to `false`.

Return value:

- `row`: a map containing all columns returned by `sourceQuery` plus one appended output column named by `spec.as`.
- If `includePartitionId` is `true`, `row` also includes `partitionId`, a 1-based identifier assigned in first-seen partition order.

```cypher
CALL apoc.window.runRows(rows, spec, includePartitionId)
YIELD row
RETURN row
```

Arguments:

- `rows`: list of row-binding maps to window over. The first row's keys define the available aliases.
- `spec`: window specification map.
- `includePartitionId`: optional boolean. When `true`, appends `partitionId` to each output row. Defaults to `false`.

Return value:

- `row`: a map containing each supplied binding plus one appended output column named by `spec.as`.
- If `includePartitionId` is `true`, `row` also includes `partitionId`, a 1-based identifier assigned in first-seen partition order.
- Empty `rows` returns no output rows after validating the shape of `spec`.

```cypher
CALL apoc.window.runPath(sourceQuery, params, pathSpec, spec, includePartitionId)
YIELD row
RETURN row
```

```cypher
CALL apoc.window.runPathRows(rows, pathSpec, spec, includePartitionId)
YIELD row
RETURN row
```

Arguments:

- `sourceQuery` or `rows`: source bindings that include a path alias.
- `pathSpec`: path expansion specification map.
- `spec`: window specification map applied after path expansion.
- `includePartitionId`: optional boolean. When `true`, appends `partitionId` to each output row. Defaults to `false`.

Return value:

- `row`: one row per expanded path element. Each row keeps the source binding columns, adds the path element, zero-based position, projected element properties, and the window output.

## `spec` Format

```cypher
{
  function: 'sum' | 'rank' | 'row_number',
  input: 'risk',                // required for aggregate functions
  as: 'cumulRisk',
  partitionBy: ['t'],           // optional
  orderBy: [{column: 'currency', direction: 'ASC'}],
  frame: {
    mode: 'ROWS' | 'RANGE' | 'GROUPS',
    start: 'UNBOUNDED_PRECEDING'
           | 'CURRENT_ROW'
           | {type: 'PRECEDING', value: 5}
           | {type: 'FOLLOWING', value: 2},
    end: 'CURRENT_ROW'
         | 'UNBOUNDED_FOLLOWING'
         | {type: 'PRECEDING', value: 1}
         | {type: 'FOLLOWING', value: 3},
    exclude: 'NO_OTHERS' | 'CURRENT_ROW' | 'GROUP' | 'TIES'
  }
}
```

Rules:

- `partitionBy` and `orderBy` must reference aliases returned by `sourceQuery` or keys in the supplied `rows`.
- `RANGE` offsets require exactly one `orderBy` column.
- Numeric `RANGE` offsets use numeric order keys.
- Temporal `RANGE` offsets use temporal order keys and accept temporal amounts such as `duration('P2D')`.
- If `frame` is omitted, the default is SQL-style `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.

## `pathSpec` Format

```cypher
{
  path: 'p',
  elements: 'EDGES' | 'NODES',
  elementAlias: 'e',
  positionAlias: 'position',
  project: [{property: 'amount', as: 'amount'}]
}
```

Rules:

- `path` must reference a path alias returned by `sourceQuery` or included in `rows`.
- `elements: 'EDGES'` expands one output row per relationship; `elements: 'NODES'` expands one output row per node.
- `positionAlias` is zero-based and ordered from path start to path end.
- `project` copies direct element properties into aliases; arbitrary Cypher expressions are not evaluated inside `pathSpec`.
- Path aliases, element aliases, position aliases, projected aliases, `spec.as`, and `partitionId` must not collide.

## Binding Rows API

Use `apoc.window.runRows` when you want the source Cypher to stay outside the procedure call. Build each binding as a map, order the bindings, collect them, and pass the list into the procedure.

```cypher
MATCH (a:Account)-[t:TRANSFER]->(b:Account)
WITH {a: a, source: a.name, target: b.name, amount: t.amount} AS binding
ORDER BY binding.source, binding.target
WITH collect(binding) AS rows
CALL apoc.window.runRows(
  rows,
  {
    function: 'rank',
    as: 'rankPerSource',
    partitionBy: ['a'],
    orderBy: [{column: 'amount', direction: 'DESC'}]
  }
)
YIELD row
RETURN row.source, row.target, row.amount, row.rankPerSource
ORDER BY row.source, row.target;
```

## PATH-Element Windows

Use `apoc.window.runPathRows` when you want `OVER PATH p EDGES AS e`-style behavior. This example expands transfer relationships and computes a cumulative amount within each path.

```cypher
MATCH p = (s:Account)-[:TRANSFER*1..4]->(t:Account)
WITH {p: p, source: s.name, target: t.name, pathLength: length(p)} AS binding
ORDER BY binding.pathLength, binding.source, binding.target
WITH collect(binding) AS rows
CALL apoc.window.runPathRows(
  rows,
  {
    path: 'p',
    elements: 'EDGES',
    elementAlias: 'e',
    positionAlias: 'position',
    project: [{property: 'amount', as: 'amount'}]
  },
  {
    function: 'sum',
    input: 'amount',
    as: 'cumulativeDistance',
    partitionBy: ['p'],
    orderBy: [{column: 'position', direction: 'ASC'}],
    frame: {
      mode: 'ROWS',
      start: 'UNBOUNDED_PRECEDING',
      end: 'CURRENT_ROW'
    }
  }
)
YIELD row
RETURN row.source, row.target, row.position, row.amount, row.cumulativeDistance
ORDER BY row.source, row.target, row.position;
```

Use `elements: 'NODES'` for node windows. This example projects `score` from each account node and accumulates it along each path.

```cypher
CALL apoc.window.runPath(
  'MATCH p = (s:Account)-[:KNOWS*1..2]->(t:Account)
   RETURN p, s.name AS source, t.name AS target
   ORDER BY source, target',
  {},
  {
    path: 'p',
    elements: 'NODES',
    elementAlias: 'n',
    positionAlias: 'position',
    project: [{property: 'score', as: 'score'}]
  },
  {
    function: 'sum',
    input: 'score',
    as: 'cumulativeScore',
    partitionBy: ['p'],
    orderBy: [{column: 'position', direction: 'ASC'}],
    frame: {
      mode: 'ROWS',
      start: 'UNBOUNDED_PRECEDING',
      end: 'CURRENT_ROW'
    }
  }
)
YIELD row
RETURN row.source, row.target, row.position, row.score, row.cumulativeScore
ORDER BY row.source, row.target, row.position;
```

## Example Data: Transfer Graph

Reset the database first if you want to run the examples exactly as shown:

```cypher
MATCH (n) DETACH DELETE n;
```

Create the transfer, currency, and account data used by the tests:

```cypher
CREATE (alice:Account {name: 'Alice'})
CREATE (bob:Account {name: 'Bob'})
CREATE (carol:Account {name: 'Carol'})
CREATE (dana:Account {name: 'Dana'})
CREATE (eve:Account {name: 'Eve'})
CREATE (eur:Currency {code: 'EUR', risk: 1})
CREATE (usd:Currency {code: 'USD', risk: 2})
CREATE (gbp:Currency {code: 'GBP', risk: 3})
CREATE (alice)-[:TRANSFER {amount: 2500, currency: 'EUR'}]->(bob)
CREATE (bob)-[:TRANSFER {amount: 1200, currency: 'EUR'}]->(carol)
CREATE (carol)-[:TRANSFER {amount: 800, currency: 'EUR'}]->(dana)
CREATE (alice)-[:TRANSFER {amount: 3000, currency: 'USD'}]->(eve)
CREATE (eve)-[:TRANSFER {amount: 1500, currency: 'USD'}]->(dana)
CREATE (eur)-[:ISSUED_FOR]->(bob)
CREATE (eur)-[:ISSUED_FOR]->(carol)
CREATE (usd)-[:ISSUED_FOR]->(carol)
CREATE (eur)-[:ISSUED_FOR]->(dana)
CREATE (gbp)-[:ISSUED_FOR]->(dana)
CREATE (usd)-[:ISSUED_FOR]->(dana)
CREATE (usd)-[:ISSUED_FOR]->(eve);
```

### Rank by source account node

```cypher
CALL apoc.window.run(
  'MATCH (a:Account)-[t:TRANSFER]->(b:Account)
   RETURN a, a.name AS source, b.name AS target, t.amount AS amount
   ORDER BY source, target',
  {},
  {
    function: 'rank',
    as: 'rankPerSource',
    partitionBy: ['a'],
    orderBy: [{column: 'amount', direction: 'DESC'}]
  }
)
YIELD row
RETURN row.source, row.target, row.amount, row.rankPerSource
ORDER BY row.source, row.target;
```

### Cumulative risk by relationship partition

```cypher
CALL apoc.window.run(
  'MATCH (a:Account)-[t:TRANSFER]->(b:Account)
   MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
   RETURN t, a.name AS source, b.name AS target, c.code AS currency, c.risk AS risk
   ORDER BY source, target, currency',
  {},
  {
    function: 'sum',
    input: 'risk',
    as: 'cumulRisk',
    partitionBy: ['t'],
    orderBy: [{column: 'currency', direction: 'ASC'}],
    frame: {
      mode: 'ROWS',
      start: 'UNBOUNDED_PRECEDING',
      end: 'CURRENT_ROW'
    }
  }
)
YIELD row
RETURN row.source, row.target, row.currency, row.risk, row.cumulRisk
ORDER BY row.source, row.target, row.currency;
```

### Path identity as the partition key

```cypher
CALL apoc.window.run(
  'MATCH p = (a:Account)-[:TRANSFER*1..4]->(b:Account)
   MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
   RETURN p,
          a.name AS source,
          b.name AS target,
          length(p) AS pathLength,
          reduce(pathKey = head(nodes(p)).name, n IN tail(nodes(p)) | pathKey + "->" + n.name) AS pathKey,
          c.code AS currency,
          c.risk AS risk
   ORDER BY pathLength, pathKey, currency',
  {},
  {
    function: 'sum',
    input: 'risk',
    as: 'cumulativeRisk',
    partitionBy: ['p'],
    orderBy: [{column: 'currency', direction: 'ASC'}],
    frame: {
      mode: 'ROWS',
      start: 'UNBOUNDED_PRECEDING',
      end: 'CURRENT_ROW'
    }
  }
)
YIELD row
RETURN row.pathKey, row.currency, row.cumulativeRisk
ORDER BY row.pathLength, row.pathKey, row.currency;
```

### Rank path tuples by projected path length

```cypher
CALL apoc.window.run(
  'MATCH p = (a:Account)-[:TRANSFER*1..4]->(b:Account)
   RETURN a.name AS source, b.name AS target, p, length(p) AS pathLength
   ORDER BY source, target, pathLength',
  {},
  {
    function: 'rank',
    as: 'pathLengthRank',
    partitionBy: ['source', 'target'],
    orderBy: [{column: 'pathLength', direction: 'ASC'}]
  }
)
YIELD row
RETURN row.source, row.target, row.pathLength, row.pathLengthRank
ORDER BY row.source, row.target, row.pathLength;
```

## Example Data: Scalar Partitioning

```cypher
MATCH (n) DETACH DELETE n;
```

```cypher
CREATE (alice:Account {name: 'Alice', domain: 'Research', score: 88})
CREATE (bob:Account {name: 'Bob', domain: 'Research', score: 72})
CREATE (carol:Account {name: 'Carol', domain: 'Engineering', score: 91})
CREATE (dana:Account {name: 'Dana', domain: 'Engineering', score: 84})
CREATE (eve:Account {name: 'Eve', domain: 'Sales', score: 60})
CREATE (frank:Account {name: 'Frank', domain: 'Sales', score: 95})
CREATE (alice)-[:KNOWS]->(carol)
CREATE (bob)-[:KNOWS]->(dana)
CREATE (alice)-[:KNOWS]->(bob)
CREATE (dana)-[:KNOWS]->(frank)
CREATE (carol)-[:KNOWS]->(alice)
CREATE (eve)-[:KNOWS]->(carol);
```

```cypher
CALL apoc.window.run(
  'MATCH (u:Account)-[:KNOWS]->(v:Account)
   RETURN u.name AS source, u.domain AS sourceDomain, v.name AS target, v.score AS targetScore
   ORDER BY sourceDomain, source, target',
  {},
  {
    function: 'rank',
    as: 'neighborRank',
    partitionBy: ['sourceDomain'],
    orderBy: [{column: 'targetScore', direction: 'DESC'}]
  }
)
YIELD row
RETURN row.sourceDomain, row.source, row.target, row.targetScore, row.neighborRank
ORDER BY row.sourceDomain, row.source, row.target;
```

## Example Data: Frame Semantics

```cypher
MATCH (n) DETACH DELETE n;
```

```cypher
CREATE (:FrameRow {name: 'r1', ord: 10, amount: 1})
CREATE (:FrameRow {name: 'r2', ord: 10, amount: 2})
CREATE (:FrameRow {name: 'r3', ord: 20, amount: 3})
CREATE (:FrameRow {name: 'r4', ord: 30, amount: 4})
CREATE (:FrameRow {name: 'r5', ord: 35, amount: 5});
```

### `ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING`

```cypher
CALL apoc.window.run(
  'MATCH (f:FrameRow)
   RETURN f.name AS name, f.ord AS ord, f.amount AS amount
   ORDER BY name',
  {},
  {
    function: 'sum',
    input: 'amount',
    as: 'windowSum',
    orderBy: [{column: 'ord', direction: 'ASC'}],
    frame: {
      mode: 'ROWS',
      start: {type: 'PRECEDING', value: 1},
      end: {type: 'FOLLOWING', value: 1}
    }
  }
)
YIELD row
RETURN row.name, row.ord, row.amount, row.windowSum
ORDER BY row.name;
```

### `GROUPS BETWEEN 1 PRECEDING AND CURRENT ROW`

```cypher
CALL apoc.window.run(
  'MATCH (f:FrameRow)
   RETURN f.name AS name, f.ord AS ord, f.amount AS amount
   ORDER BY name',
  {},
  {
    function: 'sum',
    input: 'amount',
    as: 'windowSum',
    orderBy: [{column: 'ord', direction: 'ASC'}],
    frame: {
      mode: 'GROUPS',
      start: {type: 'PRECEDING', value: 1},
      end: 'CURRENT_ROW'
    }
  }
)
YIELD row
RETURN row.name, row.ord, row.amount, row.windowSum
ORDER BY row.name;
```

### Numeric `RANGE BETWEEN 5 PRECEDING AND 5 FOLLOWING`

```cypher
CALL apoc.window.run(
  'MATCH (f:FrameRow)
   RETURN f.name AS name, f.ord AS ord, f.amount AS amount
   ORDER BY name',
  {},
  {
    function: 'sum',
    input: 'amount',
    as: 'windowSum',
    orderBy: [{column: 'ord', direction: 'ASC'}],
    frame: {
      mode: 'RANGE',
      start: {type: 'PRECEDING', value: 5},
      end: {type: 'FOLLOWING', value: 5}
    }
  }
)
YIELD row
RETURN row.name, row.ord, row.amount, row.windowSum
ORDER BY row.name;
```

### `EXCLUDE CURRENT ROW`

```cypher
CALL apoc.window.run(
  'MATCH (f:FrameRow)
   RETURN f.name AS name, f.ord AS ord, f.amount AS amount
   ORDER BY name',
  {},
  {
    function: 'sum',
    input: 'amount',
    as: 'windowSum',
    orderBy: [{column: 'ord', direction: 'ASC'}],
    frame: {
      mode: 'ROWS',
      start: 'UNBOUNDED_PRECEDING',
      end: 'CURRENT_ROW',
      exclude: 'CURRENT_ROW'
    }
  }
)
YIELD row
RETURN row.name, row.windowSum
ORDER BY row.name;
```

### `EXCLUDE GROUP`

```cypher
CALL apoc.window.run(
  'MATCH (f:FrameRow)
   RETURN f.name AS name, f.ord AS ord, f.amount AS amount
   ORDER BY name',
  {},
  {
    function: 'sum',
    input: 'amount',
    as: 'windowSum',
    orderBy: [{column: 'ord', direction: 'ASC'}],
    frame: {
      mode: 'RANGE',
      start: 'UNBOUNDED_PRECEDING',
      end: 'CURRENT_ROW',
      exclude: 'GROUP'
    }
  }
)
YIELD row
RETURN row.name, row.windowSum
ORDER BY row.name;
```

### `EXCLUDE TIES`

```cypher
CALL apoc.window.run(
  'MATCH (f:FrameRow)
   RETURN f.name AS name, f.ord AS ord, f.amount AS amount
   ORDER BY name',
  {},
  {
    function: 'sum',
    input: 'amount',
    as: 'windowSum',
    orderBy: [{column: 'ord', direction: 'ASC'}],
    frame: {
      mode: 'RANGE',
      start: 'UNBOUNDED_PRECEDING',
      end: 'CURRENT_ROW',
      exclude: 'TIES'
    }
  }
)
YIELD row
RETURN row.name, row.windowSum
ORDER BY row.name;
```

## Example Data: Temporal `RANGE`

```cypher
MATCH (n) DETACH DELETE n;
```

```cypher
CREATE (:TemporalFrameRow {name: 'd1', day: date('2026-01-01'), amount: 1})
CREATE (:TemporalFrameRow {name: 'd2', day: date('2026-01-03'), amount: 2})
CREATE (:TemporalFrameRow {name: 'd3', day: date('2026-01-07'), amount: 3})
CREATE (:TemporalFrameRow {name: 'd4', day: date('2026-01-10'), amount: 4});
```

```cypher
CALL apoc.window.run(
  'MATCH (f:TemporalFrameRow)
   RETURN f.name AS name, f.day AS day, f.amount AS amount
   ORDER BY name',
  {},
  {
    function: 'sum',
    input: 'amount',
    as: 'windowSum',
    orderBy: [{column: 'day', direction: 'ASC'}],
    frame: {
      mode: 'RANGE',
      start: {type: 'PRECEDING', value: duration('P2D')},
      end: {type: 'FOLLOWING', value: duration('P2D')}
    }
  }
)
YIELD row
RETURN row.name, row.day, row.amount, row.windowSum
ORDER BY row.name;
```

## Validation Notes

The procedure rejects invalid specifications early. Examples:

- unknown `function`
- missing `input` for aggregate window functions
- `partitionBy` or `orderBy` entries that are not aliases returned by `sourceQuery`
- invalid frame boundary ordering
- `RANGE` offsets with more than one `orderBy` column

The test suite in `src/test/java/apoc/WindowFunctionProcedureTest.java` covers the documented examples and validation behavior.

## Development

Run the full test suite locally with:

```shell
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
./mvnw test
```

## License

Apache License V2, see `LICENSE`.
