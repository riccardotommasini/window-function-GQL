package example;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Record;
import org.neo4j.driver.Session;
import org.neo4j.driver.Value;
import org.neo4j.driver.types.Node;
import org.neo4j.driver.types.Path;
import org.neo4j.driver.types.Relationship;
import org.neo4j.harness.Neo4j;
import org.neo4j.harness.Neo4jBuilders;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.temporal.TemporalAccessor;
import java.time.temporal.TemporalAmount;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WindowFunctionProcedureSQLiteParityTest {

    private static final String SQLITE_URL = "jdbc:sqlite::memory:";

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
    void matchesSqliteRankForNodePartitions() throws SQLException {
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

            List<ColumnDef> sourceColumns = List.of(
                    new ColumnDef("a", "TEXT"),
                    new ColumnDef("source", "TEXT"),
                    new ColumnDef("target", "TEXT"),
                    new ColumnDef("amount", "INTEGER"));

            String oracleSql = """
                    SELECT a,
                           source,
                           target,
                           amount,
                           RANK() OVER (
                               PARTITION BY a
                               ORDER BY amount DESC
                           ) AS rankPerSource
                    FROM source_rows
                    ORDER BY input_row_index
                    """;

            List<LinkedHashMap<String, Object>> rows = assertSqliteParity(
                    session,
                    sourceQuery,
                    Map.of(),
                    spec,
                    sourceColumns,
                    oracleSql,
                    List.of("a", "source", "target", "amount", "rankPerSource"));

            assertThat(rows).hasSize(5);
        }
    }

    @Test
    void matchesSqliteRowNumberForPeerRows() throws SQLException {
        try (Session session = driver.session()) {
            createPeerGraph(session);

            String sourceQuery = """
                    MATCH (p:Peer)
                    RETURN p.grp AS grp, p.name AS name, p.score AS score
                    ORDER BY name
                    """;

            Map<String, Object> spec = spec(
                    "row_number",
                    "rowNumberValue",
                    null,
                    List.of("grp"),
                    List.of(orderBy("score", "DESC")),
                    null);

            List<ColumnDef> sourceColumns = List.of(
                    new ColumnDef("grp", "TEXT"),
                    new ColumnDef("name", "TEXT"),
                    new ColumnDef("score", "INTEGER"));

            String oracleSql = """
                    SELECT grp,
                           name,
                           score,
                           ROW_NUMBER() OVER (
                               PARTITION BY grp
                               ORDER BY score DESC, input_row_index ASC
                           ) AS rowNumberValue
                    FROM source_rows
                    ORDER BY input_row_index
                    """;

            List<LinkedHashMap<String, Object>> rows = assertSqliteParity(
                    session,
                    sourceQuery,
                    Map.of(),
                    spec,
                    sourceColumns,
                    oracleSql,
                    List.of("grp", "name", "score", "rowNumberValue"));

            assertThat(rows)
                    .containsExactly(
                            row("grp", "A", "name", "peer-1", "score", "10", "rowNumberValue", "1"),
                            row("grp", "A", "name", "peer-2", "score", "10", "rowNumberValue", "2"),
                            row("grp", "A", "name", "peer-3", "score", "5", "rowNumberValue", "3"));
        }
    }

    @Test
    void matchesSqliteRunningSumForRelationshipPartitions() throws SQLException {
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

            List<ColumnDef> sourceColumns = List.of(
                    new ColumnDef("t", "TEXT"),
                    new ColumnDef("source", "TEXT"),
                    new ColumnDef("target", "TEXT"),
                    new ColumnDef("currency", "TEXT"),
                    new ColumnDef("risk", "INTEGER"));

            String oracleSql = """
                    SELECT t,
                           source,
                           target,
                           currency,
                           risk,
                           SUM(risk) OVER (
                               PARTITION BY t
                               ORDER BY currency ASC, input_row_index ASC
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                           ) AS cumulRisk
                    FROM source_rows
                    ORDER BY input_row_index
                    """;

            List<LinkedHashMap<String, Object>> rows = assertSqliteParity(
                    session,
                    sourceQuery,
                    Map.of(),
                    spec,
                    sourceColumns,
                    oracleSql,
                    List.of("t", "source", "target", "currency", "risk", "cumulRisk"));

            assertThat(rows).hasSize(10);
        }
    }

    @Test
    void matchesSqliteRunningSumForPathPartitions() throws SQLException {
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

            List<ColumnDef> sourceColumns = List.of(
                    new ColumnDef("p", "TEXT"),
                    new ColumnDef("source", "TEXT"),
                    new ColumnDef("target", "TEXT"),
                    new ColumnDef("pathLength", "INTEGER"),
                    new ColumnDef("pathKey", "TEXT"),
                    new ColumnDef("currency", "TEXT"),
                    new ColumnDef("risk", "INTEGER"));

            String oracleSql = """
                    SELECT p,
                           source,
                           target,
                           pathLength,
                           pathKey,
                           currency,
                           risk,
                           SUM(risk) OVER (
                               PARTITION BY p
                               ORDER BY currency ASC, input_row_index ASC
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                           ) AS cumulativeRisk
                    FROM source_rows
                    ORDER BY input_row_index
                    """;

            List<LinkedHashMap<String, Object>> rows = assertSqliteParity(
                    session,
                    sourceQuery,
                    Map.of(),
                    spec,
                    sourceColumns,
                    oracleSql,
                    List.of("p", "source", "target", "pathLength", "pathKey", "currency", "risk", "cumulativeRisk"));

            List<Object> aliceToDanaPaths = rows.stream()
                    .filter(row -> "Alice".equals(row.get("source")) && "Dana".equals(row.get("target")))
                    .map(row -> row.get("p"))
                    .distinct()
                    .toList();

            assertThat(aliceToDanaPaths).hasSize(2);
            assertThat(rows.stream()
                    .filter(row -> "Alice".equals(row.get("source")) && "Dana".equals(row.get("target")))
                    .map(row -> row.get("pathKey"))
                    .toList())
                    .containsExactly(
                            "Alice->Eve->Dana",
                            "Alice->Eve->Dana",
                            "Alice->Eve->Dana",
                            "Alice->Bob->Carol->Dana",
                            "Alice->Bob->Carol->Dana",
                            "Alice->Bob->Carol->Dana");
        }
    }

    private List<LinkedHashMap<String, Object>> assertSqliteParity(
            Session session,
            String sourceQuery,
            Map<String, Object> params,
            Map<String, Object> spec,
            List<ColumnDef> sourceColumns,
            String oracleSql,
            List<String> resultColumns) throws SQLException {
        List<LinkedHashMap<String, Object>> sourceRows = session.run(sourceQuery, params).list(record ->
                normalizeRecord(record, sourceColumns.stream().map(ColumnDef::name).toList(), this::normalizeForStorage));

        List<LinkedHashMap<String, Object>> apocRows = runWindow(session, sourceQuery, params, spec).stream()
                .map(row -> normalizeValueRow(row, resultColumns, this::normalizeForComparison))
                .toList();

        try (Connection connection = DriverManager.getConnection(SQLITE_URL)) {
            createSourceRowsTable(connection, sourceColumns);
            insertSourceRows(connection, sourceColumns, sourceRows);

            List<LinkedHashMap<String, Object>> sqliteRows = runSqliteOracle(connection, oracleSql, resultColumns);
            assertThat(apocRows).containsExactlyElementsOf(sqliteRows);
        }

        return apocRows;
    }

    private void createSourceRowsTable(Connection connection, List<ColumnDef> sourceColumns) throws SQLException {
        List<String> definitions = new ArrayList<>();
        definitions.add(quoteIdentifier("input_row_index") + " INTEGER NOT NULL");
        for (ColumnDef column : sourceColumns) {
            definitions.add(quoteIdentifier(column.name()) + " " + column.sqlType());
        }

        try (Statement statement = connection.createStatement()) {
            statement.execute("CREATE TABLE source_rows (" + String.join(", ", definitions) + ")");
        }
    }

    private void insertSourceRows(
            Connection connection,
            List<ColumnDef> sourceColumns,
            List<LinkedHashMap<String, Object>> rows) throws SQLException {
        List<String> columnNames = new ArrayList<>();
        columnNames.add("input_row_index");
        sourceColumns.stream().map(ColumnDef::name).forEach(columnNames::add);

        String placeholders = String.join(", ", columnNames.stream().map(ignored -> "?").toList());
        String sql = "INSERT INTO source_rows (" +
                String.join(", ", columnNames.stream().map(this::quoteIdentifier).toList()) +
                ") VALUES (" + placeholders + ")";

        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
                statement.setInt(1, rowIndex);

                LinkedHashMap<String, Object> row = rows.get(rowIndex);
                for (int columnIndex = 0; columnIndex < sourceColumns.size(); columnIndex++) {
                    statement.setObject(columnIndex + 2, row.get(sourceColumns.get(columnIndex).name()));
                }
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    private List<LinkedHashMap<String, Object>> runSqliteOracle(
            Connection connection,
            String oracleSql,
            List<String> resultColumns) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(oracleSql)) {
            List<LinkedHashMap<String, Object>> rows = new ArrayList<>();
            while (resultSet.next()) {
                LinkedHashMap<String, Object> row = new LinkedHashMap<>();
                for (String column : resultColumns) {
                    row.put(column, normalizeForComparison(resultSet.getObject(column)));
                }
                rows.add(row);
            }
            return rows;
        }
    }

    private LinkedHashMap<String, Object> normalizeRecord(
            Record record,
            List<String> columns,
            Function<Object, Object> normalizer) {
        return normalizeColumns(columns, column -> normalizer.apply(record.get(column).asObject()));
    }

    private LinkedHashMap<String, Object> normalizeValueRow(
            Value row,
            List<String> columns,
            Function<Object, Object> normalizer) {
        return normalizeColumns(columns, column -> normalizer.apply(row.get(column).asObject()));
    }

    private LinkedHashMap<String, Object> normalizeColumns(
            List<String> columns,
            Function<String, Object> valueProvider) {
        LinkedHashMap<String, Object> normalized = new LinkedHashMap<>();
        for (String column : columns) {
            normalized.put(column, valueProvider.apply(column));
        }
        return normalized;
    }

    private Object normalizeForStorage(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Node node) {
            return "node:" + node.elementId();
        }
        if (value instanceof Relationship relationship) {
            return "relationship:" + relationship.elementId();
        }
        if (value instanceof Path path) {
            return pathJson(path);
        }
        if (value instanceof TemporalAccessor || value instanceof TemporalAmount) {
            return value.toString();
        }
        return value;
    }

    private Object normalizeForComparison(Object value) {
        Object normalized = normalizeForStorage(value);
        if (normalized instanceof Number number) {
            return new BigDecimal(number.toString()).stripTrailingZeros().toPlainString();
        }
        return normalized;
    }

    private String pathJson(Path path) {
        List<String> tokens = new ArrayList<>();
        tokens.add("node:" + path.start().elementId());
        for (Path.Segment segment : path) {
            tokens.add("rel:" + segment.relationship().elementId());
            tokens.add("node:" + segment.end().elementId());
        }
        return jsonArray(tokens);
    }

    private String jsonArray(List<String> values) {
        List<String> parts = new ArrayList<>(values.size());
        for (String value : values) {
            parts.add(jsonString(value));
        }
        return "[" + String.join(",", parts) + "]";
    }

    private String jsonString(String value) {
        StringBuilder builder = new StringBuilder(value.length() + 2);
        builder.append('"');
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            switch (ch) {
                case '"' -> builder.append("\\\"");
                case '\\' -> builder.append("\\\\");
                case '\b' -> builder.append("\\b");
                case '\f' -> builder.append("\\f");
                case '\n' -> builder.append("\\n");
                case '\r' -> builder.append("\\r");
                case '\t' -> builder.append("\\t");
                default -> {
                    if (ch < 0x20) {
                        builder.append(String.format("\\u%04x", (int) ch));
                    } else {
                        builder.append(ch);
                    }
                }
            }
        }
        builder.append('"');
        return builder.toString();
    }

    private String quoteIdentifier(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }

    private LinkedHashMap<String, Object> row(Object... entries) {
        LinkedHashMap<String, Object> row = new LinkedHashMap<>();
        for (int i = 0; i < entries.length; i += 2) {
            row.put((String) entries[i], entries[i + 1]);
        }
        return row;
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

    private void createPeerGraph(Session session) {
        session.run("""
                CREATE (:Peer {grp: 'A', name: 'peer-1', score: 10})
                CREATE (:Peer {grp: 'A', name: 'peer-2', score: 10})
                CREATE (:Peer {grp: 'A', name: 'peer-3', score: 5})
                """);
    }

    private List<Value> runWindow(Session session, String sourceQuery, Map<String, Object> params, Map<String, Object> spec) {
        return session.run("""
                        CALL apoc.window.run($sourceQuery, $params, $spec)
                        YIELD row
                        RETURN row
                        """,
                Map.of(
                        "sourceQuery", sourceQuery,
                        "params", params,
                        "spec", spec))
                .list(record -> record.get("row"));
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

    private record ColumnDef(String name, String sqlType) {
    }
}
