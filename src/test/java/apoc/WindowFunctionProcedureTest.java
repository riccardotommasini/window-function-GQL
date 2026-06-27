package apoc;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Session;
import org.neo4j.driver.Value;
import org.neo4j.driver.exceptions.ClientException;
import org.neo4j.harness.Neo4j;
import org.neo4j.harness.Neo4jBuilders;

import java.time.Period;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WindowFunctionProcedureTest {

    private Driver driver;
    private Neo4j embeddedDatabaseServer;

    @BeforeAll
    void initializeNeo4j() {
        this.embeddedDatabaseServer = Neo4jBuilders.newInProcessBuilder()
                .withDisabledServer()
                .withProcedure(WindowFunctionProcedure.class)
                .build();

        this.driver = GraphDatabase.driver(embeddedDatabaseServer.boltURI());
    }

    @AfterAll
    void closeDriver() {
        this.driver.close();
        this.embeddedDatabaseServer.close();
    }

    @AfterEach
    void cleanDb() {
        try (Session session = driver.session()) {
            session.run("MATCH (n) DETACH DELETE n");
        }
    }

    @Test
    void ranksRowsPartitionedByNodeObject() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                    RETURN a, a.name AS source, b.name AS target, t.amount AS amount
                    ORDER BY source, target
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "rankPerSource",
                    null,
                    List.of("a"),
                    List.of(orderBy("amount", "DESC")),
                    null);

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);
            assertThat(lines(rows, "source", "target", "rankPerSource"))
                    .containsExactly(
                            "Alice|Bob|2",
                            "Alice|Eve|1",
                            "Bob|Carol|1",
                            "Carol|Dana|1",
                            "Eve|Dana|1");
        }
    }

    @Test
    void computesRunningSumPartitionedByRelationshipObject() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                    MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
                    RETURN t, a.name AS source, b.name AS target, c.code AS currency, c.risk AS risk
                    ORDER BY source, target, currency
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "cumulRisk",
                    "risk",
                    List.of("t"),
                    List.of(orderBy("currency", "ASC")),
                    rowsFrame());

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);
            assertThat(lines(rows, "source", "target", "currency", "cumulRisk"))
                    .containsExactly(
                            "Alice|Bob|EUR|1",
                            "Alice|Eve|USD|2",
                            "Bob|Carol|EUR|1",
                            "Bob|Carol|USD|3",
                            "Carol|Dana|EUR|1",
                            "Carol|Dana|GBP|4",
                            "Carol|Dana|USD|6",
                            "Eve|Dana|EUR|1",
                            "Eve|Dana|GBP|4",
                            "Eve|Dana|USD|6");
        }
    }

    @Test
    void ranksRowsPartitionedByScalarProperty() {
        try (Session session = driver.session()) {
            createDomainScoreGraph(session);

            String sourceQuery = """
                    MATCH (u:Account)-[:KNOWS]->(v:Account)
                    RETURN u.name AS source, u.domain AS sourceDomain, v.name AS target, v.score AS targetScore
                    ORDER BY sourceDomain, source, target
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "neighborRank",
                    null,
                    List.of("sourceDomain"),
                    List.of(orderBy("targetScore", "DESC")),
                    null);

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);
            assertThat(lines(rows, "sourceDomain", "source", "target", "targetScore", "neighborRank"))
                    .containsExactly(
                            "Engineering|Carol|Alice|88|2",
                            "Engineering|Dana|Frank|95|1",
                            "Research|Alice|Bob|72|3",
                            "Research|Alice|Carol|91|1",
                            "Research|Bob|Dana|84|2",
                            "Sales|Eve|Carol|91|1");
        }
    }

    @Test
    void treatsPathObjectAsAtomicPartitionKey() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH p = (a:Account)-[:TRANSFER*1..4]->(b:Account)
                    MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
                    RETURN p,
                           a.name AS source,
                           b.name AS target,
                           length(p) AS pathLength,
                           reduce(pathKey = head(nodes(p)).name, n IN tail(nodes(p)) | pathKey + '->' + n.name) AS pathKey,
                           c.code AS currency,
                           c.risk AS risk
                    ORDER BY pathLength, pathKey, currency
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "cumulativeRisk",
                    "risk",
                    List.of("p"),
                    List.of(orderBy("currency", "ASC")),
                    rowsFrame());

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);

            Map<String, List<String>> aliceToDana = new LinkedHashMap<>();
            for (Value row : rows) {
                if ("Alice".equals(row.get("source").asString()) && "Dana".equals(row.get("target").asString())) {
                    aliceToDana.computeIfAbsent(row.get("pathKey").asString(), ignored -> new ArrayList<>())
                            .add(row.get("currency").asString() + "|" + row.get("cumulativeRisk").asLong());
                }
            }

            assertThat(aliceToDana)
                    .containsOnlyKeys("Alice->Bob->Carol->Dana", "Alice->Eve->Dana");
            assertThat(aliceToDana.get("Alice->Eve->Dana"))
                    .containsExactly("EUR|1", "GBP|4", "USD|6");
            assertThat(aliceToDana.get("Alice->Bob->Carol->Dana"))
                    .containsExactly("EUR|1", "GBP|4", "USD|6");
        }
    }

    @Test
    void ranksPathTuplesByProjectedPathGlobalValue() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH p = (a:Account)-[:TRANSFER*1..4]->(b:Account)
                    RETURN a.name AS source, b.name AS target, p, length(p) AS pathLength
                    ORDER BY source, target, pathLength
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "pathLengthRank",
                    null,
                    List.of("source", "target"),
                    List.of(orderBy("pathLength", "ASC")),
                    null);

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);
            assertThat(lines(rows, "source", "target", "pathLength", "pathLengthRank"))
                    .containsExactly(
                            "Alice|Bob|1|1",
                            "Alice|Carol|2|1",
                            "Alice|Dana|2|1",
                            "Alice|Dana|3|2",
                            "Alice|Eve|1|1",
                            "Bob|Carol|1|1",
                            "Bob|Dana|2|1",
                            "Carol|Dana|1|1",
                            "Eve|Dana|1|1");
        }
    }

    @Test
    void usesSingleGlobalPartitionWhenPartitionByIsOmitted() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                    RETURN a.name AS source, b.name AS target, t.amount AS amount
                    ORDER BY source, target
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "globalRank",
                    null,
                    List.of(),
                    List.of(orderBy("amount", "DESC")),
                    null);

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);
            assertThat(lines(rows, "source", "target", "globalRank"))
                    .containsExactly(
                            "Alice|Bob|2",
                            "Alice|Eve|1",
                            "Bob|Carol|4",
                            "Carol|Dana|5",
                            "Eve|Dana|3");
        }
    }

    @Test
    void includesPartitionIdWhenRequested() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                    RETURN a, a.name AS source, b.name AS target, t.amount AS amount
                    ORDER BY source, target
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "rankPerSource",
                    null,
                    List.of("a"),
                    List.of(orderBy("amount", "DESC")),
                    null);

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec, true);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);
            assertThat(lines(rows, "source", "target", "partitionId", "rankPerSource"))
                    .containsExactly(
                            "Alice|Bob|1|2",
                            "Alice|Eve|1|1",
                            "Bob|Carol|2|1",
                            "Carol|Dana|3|1",
                            "Eve|Dana|4|1");
        }
    }

    @Test
    void includesSinglePartitionIdForGlobalWindowWhenRequested() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                    RETURN a.name AS source, b.name AS target, t.amount AS amount
                    ORDER BY source, target
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "globalRank",
                    null,
                    List.of(),
                    List.of(orderBy("amount", "DESC")),
                    null);

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec, true);

            assertTuplePreservation(session, sourceQuery, Map.of(), rows);
            assertThat(lines(rows, "source", "target", "partitionId", "globalRank"))
                    .containsExactly(
                            "Alice|Bob|1|2",
                            "Alice|Eve|1|1",
                            "Bob|Carol|1|4",
                            "Carol|Dana|1|5",
                            "Eve|Dana|1|3");
        }
    }

    @Test
    void distinguishesRankFromRowNumberForPeers() {
        try (Session session = driver.session()) {
            createPeerGraph(session);

            String sourceQuery = """
                    MATCH (p:Peer)
                    RETURN p.grp AS grp, p.name AS name, p.score AS score
                    ORDER BY name
                    """;

            Map<String, Object> rankSpec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of("grp"),
                    List.of(orderBy("score", "DESC")),
                    null);

            Map<String, Object> rowNumberSpec = spec(
                    "row_number",
                    "rowNumberValue",
                    null,
                    List.of("grp"),
                    List.of(orderBy("score", "DESC")),
                    null);

            List<Value> rankedRows = runWindow(session, sourceQuery, Map.of(), rankSpec);
            List<Value> numberedRows = runWindow(session, sourceQuery, Map.of(), rowNumberSpec);

            assertTuplePreservation(session, sourceQuery, Map.of(), rankedRows);
            assertTuplePreservation(session, sourceQuery, Map.of(), numberedRows);
            assertThat(lines(rankedRows, "name", "score", "rankValue"))
                    .containsExactly("peer-1|10|1", "peer-2|10|1", "peer-3|5|3");
            assertThat(lines(numberedRows, "name", "score", "rowNumberValue"))
                    .containsExactly("peer-1|10|1", "peer-2|10|2", "peer-3|5|3");
        }
    }

    @Test
    void runRowsSupportsReadmeStyleBindingCypher() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                    RETURN a, a.name AS source, b.name AS target, t.amount AS amount
                    ORDER BY source, target
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "rankPerSource",
                    null,
                    List.of("a"),
                    List.of(orderBy("amount", "DESC")),
                    null);

            List<Value> expected = runWindow(session, sourceQuery, Map.of(), spec);
            List<Value> rows = session.run("""
                            MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                            WITH {a: a, source: a.name, target: b.name, amount: t.amount} AS binding
                            ORDER BY binding.source, binding.target
                            WITH collect(binding) AS rows
                            CALL apoc.window.runRows(rows, $spec)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("spec", spec))
                    .list(record -> record.get("row"));

            assertThat(lines(rows, "source", "target", "amount", "rankPerSource"))
                    .isEqualTo(lines(expected, "source", "target", "amount", "rankPerSource"));
        }
    }

    @Test
    void runRowsMatchesSourceQueryForRelationshipPartitions() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                    MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
                    RETURN t, a.name AS source, b.name AS target, c.code AS currency, c.risk AS risk
                    ORDER BY source, target, currency
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "cumulRisk",
                    "risk",
                    List.of("t"),
                    List.of(orderBy("currency", "ASC")),
                    rowsFrame());

            List<Value> expected = runWindow(session, sourceQuery, Map.of(), spec);
            List<Value> rows = session.run("""
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
                            CALL apoc.window.runRows(rows, $spec)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("spec", spec))
                    .list(record -> record.get("row"));

            assertThat(lines(rows, "source", "target", "currency", "risk", "cumulRisk"))
                    .isEqualTo(lines(expected, "source", "target", "currency", "risk", "cumulRisk"));
        }
    }

    @Test
    void runRowsMatchesSourceQueryForScalarPartitions() {
        try (Session session = driver.session()) {
            createDomainScoreGraph(session);

            String sourceQuery = """
                    MATCH (u:Account)-[:KNOWS]->(v:Account)
                    RETURN u.name AS source, u.domain AS sourceDomain, v.name AS target, v.score AS targetScore
                    ORDER BY sourceDomain, source, target
                    """;

            Map<String, Object> spec = spec(
                    "rank",
                    "neighborRank",
                    null,
                    List.of("sourceDomain"),
                    List.of(orderBy("targetScore", "DESC")),
                    null);

            List<Value> expected = runWindow(session, sourceQuery, Map.of(), spec);
            List<Value> rows = session.run("""
                            MATCH (u:Account)-[:KNOWS]->(v:Account)
                            WITH {
                              source: u.name,
                              sourceDomain: u.domain,
                              target: v.name,
                              targetScore: v.score
                            } AS binding
                            ORDER BY binding.sourceDomain, binding.source, binding.target
                            WITH collect(binding) AS rows
                            CALL apoc.window.runRows(rows, $spec)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("spec", spec))
                    .list(record -> record.get("row"));

            assertThat(lines(rows, "sourceDomain", "source", "target", "targetScore", "neighborRank"))
                    .isEqualTo(lines(expected, "sourceDomain", "source", "target", "targetScore", "neighborRank"));
        }
    }

    @Test
    void runRowsMatchesSourceQueryForPathPartitions() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            String sourceQuery = """
                    MATCH p = (a:Account)-[:TRANSFER*1..4]->(b:Account)
                    MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
                    RETURN p,
                           a.name AS source,
                           b.name AS target,
                           length(p) AS pathLength,
                           reduce(pathKey = head(nodes(p)).name, n IN tail(nodes(p)) | pathKey + '->' + n.name) AS pathKey,
                           c.code AS currency,
                           c.risk AS risk
                    ORDER BY pathLength, pathKey, currency
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "cumulativeRisk",
                    "risk",
                    List.of("p"),
                    List.of(orderBy("currency", "ASC")),
                    rowsFrame());

            List<Value> expected = runWindow(session, sourceQuery, Map.of(), spec);
            List<Value> rows = session.run("""
                            MATCH p = (a:Account)-[:TRANSFER*1..4]->(b:Account)
                            MATCH (b)<-[:ISSUED_FOR]-(c:Currency)
                            WITH {
                              p: p,
                              source: a.name,
                              target: b.name,
                              pathLength: length(p),
                              pathKey: reduce(pathKey = head(nodes(p)).name, n IN tail(nodes(p)) | pathKey + '->' + n.name),
                              currency: c.code,
                              risk: c.risk
                            } AS binding
                            ORDER BY binding.pathLength, binding.pathKey, binding.currency
                            WITH collect(binding) AS rows
                            CALL apoc.window.runRows(rows, $spec)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("spec", spec))
                    .list(record -> record.get("row"));

            assertThat(lines(rows, "source", "target", "pathLength", "pathKey", "currency", "risk", "cumulativeRisk"))
                    .isEqualTo(lines(expected, "source", "target", "pathLength", "pathKey", "currency", "risk", "cumulativeRisk"));
        }
    }

    @Test
    void runRowsIncludesPartitionIdWhenRequested() {
        try (Session session = driver.session()) {
            createTransferAndCurrencyGraph(session);

            Map<String, Object> spec = spec(
                    "rank",
                    "rankPerSource",
                    null,
                    List.of("a"),
                    List.of(orderBy("amount", "DESC")),
                    null);

            List<Value> rows = session.run("""
                            MATCH (a:Account)-[t:TRANSFER]->(b:Account)
                            WITH {a: a, source: a.name, target: b.name, amount: t.amount} AS binding
                            ORDER BY binding.source, binding.target
                            WITH collect(binding) AS rows
                            CALL apoc.window.runRows(rows, $spec, true)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("spec", spec))
                    .list(record -> record.get("row"));

            assertThat(lines(rows, "source", "target", "partitionId", "rankPerSource"))
                    .containsExactly(
                            "Alice|Bob|1|2",
                            "Alice|Eve|1|1",
                            "Bob|Carol|2|1",
                            "Carol|Dana|3|1",
                            "Eve|Dana|4|1");
        }
    }

    @Test
    void runPathRowsComputesCumulativeRelationshipAmountsOverEdges() {
        try (Session session = driver.session()) {
            createPathWindowGraph(session);

            Map<String, Object> pathSpec = pathSpec(
                    "p",
                    "EDGES",
                    "e",
                    "position",
                    List.of(project("amount", "amount")));
            Map<String, Object> spec = spec(
                    "sum",
                    "cumulativeDistance",
                    "amount",
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    rowsFrame());

            List<Value> rows = session.run("""
                            MATCH p = (s:PathAccount {name: 'A'})-[:TRANSFER*1..3]->(t:PathAccount)
                            WITH {p: p, source: s.name, target: t.name} AS binding
                            ORDER BY binding.target
                            WITH collect(binding) AS rows
                            CALL apoc.window.runPathRows(rows, $pathSpec, $spec)
                            YIELD row
                            RETURN row
                            ORDER BY row.target, row.position
                            """,
                    Map.of("pathSpec", pathSpec, "spec", spec))
                    .list(record -> record.get("row"));

            assertThat(lines(rows, "source", "target", "position", "amount", "cumulativeDistance"))
                    .containsExactly(
                            "A|B|0|10|10",
                            "A|C|0|10|10",
                            "A|C|1|20|30",
                            "A|D|0|10|10",
                            "A|D|1|20|30",
                            "A|D|2|30|60");
        }
    }

    @Test
    void runPathComputesCumulativeNodeScoresOverNodes() {
        try (Session session = driver.session()) {
            createPathWindowGraph(session);

            String sourceQuery = """
                    MATCH p = (s:PathAccount {name: 'A'})-[:TRANSFER*2]->(t:PathAccount)
                    RETURN p, s.name AS source, t.name AS target
                    """;
            Map<String, Object> pathSpec = pathSpec(
                    "p",
                    "NODES",
                    "n",
                    "position",
                    List.of(project("score", "score")));
            Map<String, Object> spec = spec(
                    "sum",
                    "cumulativeScore",
                    "score",
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    rowsFrame());

            List<Value> rows = runPath(session, sourceQuery, Map.of(), pathSpec, spec);

            assertThat(lines(rows, "source", "target", "position", "score", "cumulativeScore"))
                    .containsExactly(
                            "A|C|0|1|1",
                            "A|C|1|2|3",
                            "A|C|2|3|6");
        }
    }

    @Test
    void runPathHandlesZeroLengthPathsForEdgesAndNodes() {
        try (Session session = driver.session()) {
            createPathWindowGraph(session);

            String sourceQuery = """
                    MATCH p = (s:PathAccount {name: 'A'})
                    RETURN p, s.name AS source
                    """;
            Map<String, Object> edgePathSpec = pathSpec(
                    "p",
                    "EDGES",
                    "e",
                    "position",
                    List.of(project("amount", "amount")));
            Map<String, Object> edgeSpec = spec(
                    "row_number",
                    "edgeIndex",
                    null,
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    null);

            assertThat(runPath(session, sourceQuery, Map.of(), edgePathSpec, edgeSpec)).isEmpty();

            Map<String, Object> nodePathSpec = pathSpec(
                    "p",
                    "NODES",
                    "n",
                    "position",
                    List.of(project("score", "score")));
            Map<String, Object> nodeSpec = spec(
                    "sum",
                    "nodeTotal",
                    "score",
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    rowsFrame());

            List<Value> rows = runPath(session, sourceQuery, Map.of(), nodePathSpec, nodeSpec);

            assertThat(lines(rows, "source", "position", "score", "nodeTotal"))
                    .containsExactly("A|0|1|1");
        }
    }

    @Test
    void rejectsUnknownFunction() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "dense_rank",
                    "rankValue",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindow(session, "RETURN 1 AS value ORDER BY value", Map.of(), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Unknown window function 'dense_rank'");
        }
    }

    @Test
    void rejectsAggregateSpecWithoutInput() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "sum",
                    "runningTotal",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    rowsFrame());

            assertThatThrownBy(() -> runWindow(session, "RETURN 1 AS value ORDER BY value", Map.of(), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("spec.input must be provided");
        }
    }

    @Test
    void rejectsUnknownPartitionAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of("missingPartition"),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindow(session, "RETURN 1 AS value ORDER BY value", Map.of(), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Unknown alias 'missingPartition' in partitionBy")
                    .hasMessageContaining("project it in sourceQuery");
        }
    }

    @Test
    void rejectsUnknownOrderAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of(),
                    List.of(orderBy("missingOrder", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindow(session, "RETURN 1 AS value ORDER BY value", Map.of(), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Unknown alias 'missingOrder' in orderBy")
                    .hasMessageContaining("project it in sourceQuery");
        }
    }

    @Test
    void rejectsReservedPartitionIdOutputAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "partitionId",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindow(session, "RETURN 1 AS value ORDER BY value", Map.of(), spec, true))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Window output alias 'partitionId' is reserved");
        }
    }

    @Test
    void rejectsSourceQueryThatAlreadyProjectsReservedPartitionIdAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindow(
                    session,
                    "RETURN 1 AS value, 2 AS partitionId ORDER BY value",
                    Map.of(),
                    spec,
                    true))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("sourceQuery already projects reserved alias 'partitionId'");
        }
    }

    @Test
    void runRowsRejectsUnknownAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of("missingPartition"),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindowRows(session, List.of(Map.of("value", 1)), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Unknown alias 'missingPartition' in partitionBy")
                    .hasMessageContaining("include it in rows first");
        }
    }

    @Test
    void runRowsRejectsDuplicateOutputAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "value",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindowRows(session, List.of(Map.of("value", 1)), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Window output alias 'value' already exists in rows");
        }
    }

    @Test
    void runRowsRejectsReservedPartitionIdOutputAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "partitionId",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindowRows(session, List.of(Map.of("value", 1)), spec, true))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Window output alias 'partitionId' is reserved");
        }
    }

    @Test
    void runRowsRejectsRowsThatAlreadyContainReservedPartitionIdAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> runWindowRows(
                    session,
                    List.of(Map.of("value", 1, "partitionId", 99)),
                    spec,
                    true))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("rows already contain reserved alias 'partitionId'");
        }
    }

    @Test
    void runRowsRejectsNullRows() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> session.run("""
                            CALL apoc.window.runRows(null, $spec)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("spec", spec)).list())
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("rows must not be null");
        }
    }

    @Test
    void runRowsRejectsNullRowEntries() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    null);

            assertThatThrownBy(() -> session.run("""
                            CALL apoc.window.runRows([null], $spec)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("spec", spec)).list())
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("rows[0] must not be null");
        }
    }

    @Test
    void runRowsReturnsEmptyStreamForEmptyRows() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "rank",
                    "rankValue",
                    null,
                    List.of("missingPartition"),
                    List.of(orderBy("missingOrder", "ASC")),
                    null);

            List<Value> rows = runWindowRows(session, List.of(), spec);

            assertThat(rows).isEmpty();
        }
    }

    @Test
    void runPathRowsRejectsAliasCollisions() {
        try (Session session = driver.session()) {
            Map<String, Object> pathSpec = pathSpec(
                    "p",
                    "EDGES",
                    "source",
                    "position",
                    List.of());
            Map<String, Object> spec = spec(
                    "row_number",
                    "edgeIndex",
                    null,
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    null);

            assertThatThrownBy(() -> runPathRows(
                    session,
                    List.of(Map.of("p", "not-a-path", "source", "A")),
                    pathSpec,
                    spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("pathSpec alias 'source' already exists in rows");
        }
    }

    @Test
    void runPathRowsRejectsInvalidPathAlias() {
        try (Session session = driver.session()) {
            Map<String, Object> pathSpec = pathSpec(
                    "missingPath",
                    "EDGES",
                    "e",
                    "position",
                    List.of());
            Map<String, Object> spec = spec(
                    "row_number",
                    "edgeIndex",
                    null,
                    List.of("missingPath"),
                    List.of(orderBy("position", "ASC")),
                    null);

            assertThatThrownBy(() -> runPathRows(session, List.of(Map.of("p", "not-a-path")), pathSpec, spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Unknown path alias 'missingPath'")
                    .hasMessageContaining("include it in rows first");
        }
    }

    @Test
    void runPathRowsRejectsNonPathValues() {
        try (Session session = driver.session()) {
            Map<String, Object> pathSpec = pathSpec(
                    "p",
                    "EDGES",
                    "e",
                    "position",
                    List.of());
            Map<String, Object> spec = spec(
                    "row_number",
                    "edgeIndex",
                    null,
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    null);

            assertThatThrownBy(() -> runPathRows(session, List.of(Map.of("p", "not-a-path")), pathSpec, spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Path alias 'p' in rows[0] must contain a path");
        }
    }

    @Test
    void runPathRowsRejectsInvalidElementMode() {
        try (Session session = driver.session()) {
            Map<String, Object> pathSpec = pathSpec(
                    "p",
                    "VERTICES",
                    "e",
                    "position",
                    List.of());
            Map<String, Object> spec = spec(
                    "row_number",
                    "edgeIndex",
                    null,
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    null);

            assertThatThrownBy(() -> runPathRows(session, List.of(), pathSpec, spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("pathSpec.elements must be EDGES or NODES");
        }
    }

    @Test
    void runPathRowsProjectsMissingPropertiesAsNull() {
        try (Session session = driver.session()) {
            createPathWindowGraph(session);

            Map<String, Object> pathSpec = pathSpec(
                    "p",
                    "EDGES",
                    "e",
                    "position",
                    List.of(project("missing", "amount")));
            Map<String, Object> spec = spec(
                    "sum",
                    "cumulativeDistance",
                    "amount",
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    rowsFrame());

            List<Value> rows = session.run("""
                            MATCH p = (s:PathAccount {name: 'A'})-[:TRANSFER*1]->(t:PathAccount)
                            WITH collect({p: p, source: s.name, target: t.name}) AS rows
                            CALL apoc.window.runPathRows(rows, $pathSpec, $spec)
                            YIELD row
                            RETURN row
                            """,
                    Map.of("pathSpec", pathSpec, "spec", spec))
                    .list(record -> record.get("row"));

            assertThat(lines(rows, "target", "position", "amount", "cumulativeDistance"))
                    .containsExactly("B|0|null|null");
        }
    }

    @Test
    void runPathRejectsNonNumericProjectedPropertiesForSum() {
        try (Session session = driver.session()) {
            createPathWindowGraph(session);

            String sourceQuery = """
                    MATCH p = (s:PathAccount {name: 'A'})-[:TRANSFER*1]->(t:PathAccount)
                    RETURN p, s.name AS source, t.name AS target
                    """;
            Map<String, Object> pathSpec = pathSpec(
                    "p",
                    "EDGES",
                    "e",
                    "position",
                    List.of(project("currency", "amount")));
            Map<String, Object> spec = spec(
                    "sum",
                    "cumulativeDistance",
                    "amount",
                    List.of("p"),
                    List.of(orderBy("position", "ASC")),
                    rowsFrame());

            assertThatThrownBy(() -> runPath(session, sourceQuery, Map.of(), pathSpec, spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("Window input 'amount' must be numeric for sum()");
        }
    }

    @Test
    void supportsRowsFrameWithBoundedPrecedingAndFollowing() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    frame("ROWS", boundary("PRECEDING", 1), boundary("FOLLOWING", 1), null));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|3", "r2|6", "r3|9", "r4|12", "r5|9");
        }
    }

    @Test
    void supportsRowsFrameWithFollowingToUnboundedFollowing() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    frame("ROWS", boundary("FOLLOWING", 1), "UNBOUNDED_FOLLOWING", null));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|14", "r2|12", "r3|9", "r4|5", "r5|null");
        }
    }

    @Test
    void supportsGroupsFrameByPeerGroups() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    frame("GROUPS", boundary("PRECEDING", 1), "CURRENT_ROW", null));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|3", "r2|3", "r3|6", "r4|7", "r5|9");
        }
    }

    @Test
    void supportsRangeFrameWithNumericOffsets() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    frame("RANGE", boundary("PRECEDING", 5), boundary("FOLLOWING", 5), null));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|3", "r2|3", "r3|3", "r4|9", "r5|9");
        }
    }

    @Test
    void supportsRangeFrameWithDescendingOrder() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "DESC")),
                    frame("RANGE", boundary("PRECEDING", 5), "CURRENT_ROW", null));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|3", "r2|3", "r3|3", "r4|9", "r5|5");
        }
    }

    @Test
    void supportsRangeFrameWithTemporalOffsets() {
        try (Session session = driver.session()) {
            createTemporalFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:TemporalFrameRow)
                    RETURN f.name AS name, f.day AS day, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("day", "ASC")),
                    frame("RANGE", boundary("PRECEDING", Period.ofDays(2)), boundary("FOLLOWING", Period.ofDays(2)), null));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("d1|3", "d2|3", "d3|3", "d4|4");
        }
    }

    @Test
    void usesSqlDefaultRangeFrameWhenFrameIsOmitted() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    null);

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|3", "r2|3", "r3|6", "r4|10", "r5|15");
        }
    }

    @Test
    void supportsExcludeCurrentRow() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    frame("ROWS", "UNBOUNDED_PRECEDING", "CURRENT_ROW", "CURRENT_ROW"));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|null", "r2|1", "r3|3", "r4|6", "r5|10");
        }
    }

    @Test
    void supportsExcludeGroup() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    frame("RANGE", "UNBOUNDED_PRECEDING", "CURRENT_ROW", "GROUP"));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|null", "r2|null", "r3|3", "r4|6", "r5|10");
        }
    }

    @Test
    void supportsExcludeTies() {
        try (Session session = driver.session()) {
            createFrameRowsGraph(session);

            String sourceQuery = """
                    MATCH (f:FrameRow)
                    RETURN f.name AS name, f.ord AS ord, f.amount AS amount
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "amount",
                    List.of(),
                    List.of(orderBy("ord", "ASC")),
                    frame("RANGE", "UNBOUNDED_PRECEDING", "CURRENT_ROW", "TIES"));

            List<Value> rows = runWindow(session, sourceQuery, Map.of(), spec);

            assertThat(lines(rows, "name", "windowSum"))
                    .containsExactly("r1|1", "r2|2", "r3|6", "r4|10", "r5|15");
        }
    }

    @Test
    void rejectsInvalidFrameBoundaries() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "value",
                    List.of(),
                    List.of(orderBy("value", "ASC")),
                    frame("ROWS", "CURRENT_ROW", boundary("PRECEDING", 1), null));

            assertThatThrownBy(() -> runWindow(session, "RETURN 1 AS value", Map.of(), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("frame.end cannot appear earlier than frame.start");
        }
    }

    @Test
    void rejectsRangeOffsetsWithMultipleOrderColumns() {
        try (Session session = driver.session()) {
            Map<String, Object> spec = spec(
                    "sum",
                    "windowSum",
                    "value",
                    List.of(),
                    List.of(orderBy("value", "ASC"), orderBy("other", "ASC")),
                    frame("RANGE", boundary("PRECEDING", 1), "CURRENT_ROW", null));

            assertThatThrownBy(() -> runWindow(session, "RETURN 1 AS value, 2 AS other", Map.of(), spec))
                    .isInstanceOf(ClientException.class)
                    .hasMessageContaining("RANGE offsets require exactly one orderBy column");
        }
    }

    private void createTransferAndCurrencyGraph(Session session) {
        session.run("""
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
                CREATE (usd)-[:ISSUED_FOR]->(eve)
                """);
    }

    private void createDomainScoreGraph(Session session) {
        session.run("""
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
                CREATE (eve)-[:KNOWS]->(carol)
                """);
    }

    private void createPeerGraph(Session session) {
        session.run("""
                CREATE (:Peer {grp: 'A', name: 'peer-1', score: 10})
                CREATE (:Peer {grp: 'A', name: 'peer-2', score: 10})
                CREATE (:Peer {grp: 'A', name: 'peer-3', score: 5})
                """);
    }

    private void createFrameRowsGraph(Session session) {
        session.run("""
                CREATE (:FrameRow {name: 'r1', ord: 10, amount: 1})
                CREATE (:FrameRow {name: 'r2', ord: 10, amount: 2})
                CREATE (:FrameRow {name: 'r3', ord: 20, amount: 3})
                CREATE (:FrameRow {name: 'r4', ord: 30, amount: 4})
                CREATE (:FrameRow {name: 'r5', ord: 35, amount: 5})
                """);
    }

    private void createTemporalFrameRowsGraph(Session session) {
        session.run("""
                CREATE (:TemporalFrameRow {name: 'd1', day: date('2026-01-01'), amount: 1})
                CREATE (:TemporalFrameRow {name: 'd2', day: date('2026-01-03'), amount: 2})
                CREATE (:TemporalFrameRow {name: 'd3', day: date('2026-01-07'), amount: 3})
                CREATE (:TemporalFrameRow {name: 'd4', day: date('2026-01-10'), amount: 4})
                """);
    }

    private void createPathWindowGraph(Session session) {
        session.run("""
                CREATE (a:PathAccount {name: 'A', score: 1})
                CREATE (b:PathAccount {name: 'B', score: 2})
                CREATE (c:PathAccount {name: 'C', score: 3})
                CREATE (d:PathAccount {name: 'D', score: 4})
                CREATE (a)-[:TRANSFER {amount: 10, currency: 'USD'}]->(b)
                CREATE (b)-[:TRANSFER {amount: 20, currency: 'EUR'}]->(c)
                CREATE (c)-[:TRANSFER {amount: 30, currency: 'GBP'}]->(d)
                """);
    }

    private List<Value> runWindow(Session session, String sourceQuery, Map<String, Object> params, Map<String, Object> spec) {
        return runWindow(session, sourceQuery, params, spec, false);
    }

    private List<Value> runWindow(
            Session session,
            String sourceQuery,
            Map<String, Object> params,
            Map<String, Object> spec,
            boolean includePartitionId) {
        return session.run("""
                        CALL apoc.window.run($sourceQuery, $params, $spec, $includePartitionId)
                        YIELD row
                        RETURN row
                        """,
                Map.of(
                        "sourceQuery", sourceQuery,
                        "params", params,
                        "spec", spec,
                        "includePartitionId", includePartitionId))
                .list(record -> record.get("row"));
    }

    private List<Value> runWindowRows(Session session, List<Map<String, Object>> rows, Map<String, Object> spec) {
        return runWindowRows(session, rows, spec, false);
    }

    private List<Value> runWindowRows(
            Session session,
            List<Map<String, Object>> rows,
            Map<String, Object> spec,
            boolean includePartitionId) {
        return session.run("""
                        CALL apoc.window.runRows($rows, $spec, $includePartitionId)
                        YIELD row
                        RETURN row
                        """,
                Map.of(
                        "rows", rows,
                        "spec", spec,
                        "includePartitionId", includePartitionId))
                .list(record -> record.get("row"));
    }

    private List<Value> runPath(
            Session session,
            String sourceQuery,
            Map<String, Object> params,
            Map<String, Object> pathSpec,
            Map<String, Object> spec) {
        return runPath(session, sourceQuery, params, pathSpec, spec, false);
    }

    private List<Value> runPath(
            Session session,
            String sourceQuery,
            Map<String, Object> params,
            Map<String, Object> pathSpec,
            Map<String, Object> spec,
            boolean includePartitionId) {
        return session.run("""
                        CALL apoc.window.runPath($sourceQuery, $params, $pathSpec, $spec, $includePartitionId)
                        YIELD row
                        RETURN row
                        """,
                Map.of(
                        "sourceQuery", sourceQuery,
                        "params", params,
                        "pathSpec", pathSpec,
                        "spec", spec,
                        "includePartitionId", includePartitionId))
                .list(record -> record.get("row"));
    }

    private List<Value> runPathRows(
            Session session,
            List<Map<String, Object>> rows,
            Map<String, Object> pathSpec,
            Map<String, Object> spec) {
        return runPathRows(session, rows, pathSpec, spec, false);
    }

    private List<Value> runPathRows(
            Session session,
            List<Map<String, Object>> rows,
            Map<String, Object> pathSpec,
            Map<String, Object> spec,
            boolean includePartitionId) {
        return session.run("""
                        CALL apoc.window.runPathRows($rows, $pathSpec, $spec, $includePartitionId)
                        YIELD row
                        RETURN row
                        """,
                Map.of(
                        "rows", rows,
                        "pathSpec", pathSpec,
                        "spec", spec,
                        "includePartitionId", includePartitionId))
                .list(record -> record.get("row"));
    }

    private void assertTuplePreservation(Session session, String sourceQuery, Map<String, Object> params, List<Value> rows) {
        assertThat(rows).hasSize(session.run(sourceQuery, params).list().size());
    }

    private Map<String, Object> spec(
            String function,
            String as,
            String input,
            List<String> partitionBy,
            List<Map<String, Object>> orderBy,
            Map<String, Object> frame) {
        LinkedHashMap<String, Object> spec = new LinkedHashMap<>();
        spec.put("function", function);
        spec.put("as", as);
        if (input != null) {
            spec.put("input", input);
        }
        if (partitionBy != null && !partitionBy.isEmpty()) {
            spec.put("partitionBy", partitionBy);
        }
        spec.put("orderBy", orderBy);
        if (frame != null) {
            spec.put("frame", frame);
        }
        return spec;
    }

    private Map<String, Object> pathSpec(
            String path,
            String elements,
            String elementAlias,
            String positionAlias,
            List<Map<String, Object>> project) {
        LinkedHashMap<String, Object> pathSpec = new LinkedHashMap<>();
        pathSpec.put("path", path);
        pathSpec.put("elements", elements);
        pathSpec.put("elementAlias", elementAlias);
        pathSpec.put("positionAlias", positionAlias);
        if (project != null && !project.isEmpty()) {
            pathSpec.put("project", project);
        }
        return pathSpec;
    }

    private Map<String, Object> project(String property, String as) {
        return Map.of("property", property, "as", as);
    }

    private Map<String, Object> orderBy(String column, String direction) {
        return Map.of("column", column, "direction", direction);
    }

    private Map<String, Object> rowsFrame() {
        return frame("ROWS", "UNBOUNDED_PRECEDING", "CURRENT_ROW", null);
    }

    private Map<String, Object> frame(String mode, Object start, Object end, String exclude) {
        LinkedHashMap<String, Object> frame = new LinkedHashMap<>();
        if (mode != null) {
            frame.put("mode", mode);
        }
        if (start != null) {
            frame.put("start", start);
        }
        if (end != null) {
            frame.put("end", end);
        }
        if (exclude != null) {
            frame.put("exclude", exclude);
        }
        return frame;
    }

    private Map<String, Object> boundary(String type, Object value) {
        return Map.of("type", type, "value", value);
    }

    private List<String> lines(List<Value> rows, String... columns) {
        return rows.stream()
                .map(row -> line(row, columns))
                .toList();
    }

    private String line(Value row, String... columns) {
        List<String> parts = new ArrayList<>(columns.length);
        for (String column : columns) {
            parts.add(String.valueOf(row.get(column).asObject()));
        }
        return String.join("|", parts);
    }
}
