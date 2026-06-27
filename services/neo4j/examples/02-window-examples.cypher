SHOW PROCEDURES YIELD name, signature
WHERE name IN ['apoc.window.run', 'apoc.window.runRows', 'apoc.window.runPath', 'apoc.window.runPathRows']
RETURN name, signature;

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

MATCH (a:Account)-[t:TRANSFER]->(b:Account)
MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
WITH {
  t: t,
  source: a.name,
  target: b.name,
  currency: c.code,
  risk: c.risk
} AS binding
ORDER BY binding.source, binding.target, binding.currency
WITH collect(binding) AS rows
CALL apoc.window.runRows(
  rows,
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

MATCH p = (s:Account)-[:TRANSFER*1..4]->(t:Account)
WITH {
  p: p,
  source: s.name,
  target: t.name,
  pathLength: length(p),
  pathKey: reduce(pathKey = head(nodes(p)).name, n IN tail(nodes(p)) | pathKey + "->" + n.name)
} AS binding
ORDER BY binding.pathLength, binding.pathKey
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
RETURN row.source, row.target, row.pathKey, row.position, row.amount, row.cumulativeDistance
ORDER BY row.source, row.target, row.pathLength, row.pathKey, row.position;

CALL apoc.window.runPath(
  'MATCH p = (s:Account)-[:KNOWS*1..2]->(t:Account)
   RETURN p,
          s.name AS source,
          t.name AS target,
          length(p) AS pathLength,
          reduce(pathKey = head(nodes(p)).name, n IN tail(nodes(p)) | pathKey + "->" + n.name) AS pathKey
   ORDER BY source, target, pathLength, pathKey',
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
RETURN row.source, row.target, row.pathKey, row.position, row.score, row.cumulativeScore
ORDER BY row.source, row.target, row.pathLength, row.pathKey, row.position;

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
