# Add Row-Binding Window Procedure

## Summary
Add a second procedure that keeps the Cypher query outside the APOC-style call. Callers will build the binding table in normal Cypher, collect it as row maps, and pass it into the window engine.

## Public API
- Keep `apoc.window.run(sourceQuery, params, spec, includePartitionId)` unchanged.
- Add `apoc.window.runRows(rows, spec, includePartitionId = false)`.
- Example shape:

```cypher
MATCH (a:Account)-[t:TRANSFER]->(b:Account)
WITH {a: a, source: a.name, target: b.name, amount: t.amount} AS binding
ORDER BY binding.source, binding.target
WITH collect(binding) AS rows
CALL apoc.window.runRows(rows, {
  function: 'rank',
  as: 'rankPerSource',
  partitionBy: ['a'],
  orderBy: [{column: 'amount', direction: 'DESC'}]
})
YIELD row
RETURN row.source, row.target, row.amount, row.rankPerSource;
```

## Implementation Changes
- In [WindowFunctionProcedure.java](/Users/rictomm/_Projects/GWL/src/main/java/example/WindowFunctionProcedure.java), add a new `@Procedure(name = "apoc.window.runRows", mode = Mode.READ)` method accepting `List<Map<String,Object>> rows`.
- Extract the shared windowing path so both procedures use the same `WindowSpec` parsing, column validation, `RowState` creation, `applyWindow`, and result-row generation.
- Infer available columns for `runRows` from the first row’s map keys. Empty `rows` returns an empty stream after validating that `spec` is present and structurally valid.
- Preserve input row order exactly as received in the collected list; callers control that order with `ORDER BY` before `collect`.
- Keep reserved alias behavior the same: duplicate `spec.as` is rejected, and `partitionId` conflicts are rejected when `includePartitionId` is true.

## Tests
- Add tests in [WindowFunctionProcedureTest.java](/Users/rictomm/_Projects/GWL/src/test/java/example/WindowFunctionProcedureTest.java) proving `runRows` matches existing `run` output for node, relationship, scalar, and path partition examples.
- Add coverage for `includePartitionId`, unknown aliases, duplicate output alias, reserved `partitionId`, null rows, and empty rows.
- Add at least one README-style Cypher test where the query is outside the procedure and the procedure receives `collect(binding)`.
- Run `./mvnw test`.

## Docs
- Update [README.md](/Users/rictomm/_Projects/GWL/README.md) with a new “Binding Rows API” section.
- Add equivalent examples to [02-window-examples.cypher](/Users/rictomm/_Projects/GWL/neo4j/examples/02-window-examples.cypher), showing the query-outside/procedure-receives-binding pattern.

## Assumptions
- The new API name is `apoc.window.runRows`.
- The binding is passed explicitly as `List<Map<String,Object>>`; no hidden access to the surrounding Cypher row stream is assumed.
- Empty row bindings produce no output rather than requiring a separate `columns` argument.
