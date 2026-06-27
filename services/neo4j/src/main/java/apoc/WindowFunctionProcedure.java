package apoc;

import org.neo4j.graphdb.Node;
import org.neo4j.graphdb.Path;
import org.neo4j.graphdb.Relationship;
import org.neo4j.graphdb.Result;
import org.neo4j.graphdb.Transaction;
import org.neo4j.procedure.Context;
import org.neo4j.procedure.Description;
import org.neo4j.procedure.Mode;
import org.neo4j.procedure.Name;
import org.neo4j.procedure.Procedure;

import java.math.BigDecimal;
import java.time.temporal.Temporal;
import java.time.temporal.TemporalAmount;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

public class WindowFunctionProcedure {

    private static final String RANGE_MODE = "RANGE";
    private static final String ROWS_MODE = "ROWS";
    private static final String GROUPS_MODE = "GROUPS";
    private static final String UNBOUNDED_PRECEDING = "UNBOUNDED_PRECEDING";
    private static final String CURRENT_ROW = "CURRENT_ROW";
    private static final String UNBOUNDED_FOLLOWING = "UNBOUNDED_FOLLOWING";
    private static final String PARTITION_ID_COLUMN = "partitionId";
    private static final PartitionKey GLOBAL_PARTITION = new PartitionKey(List.of("__GLOBAL__"));

    @Context
    public Transaction tx;

    @Procedure(name = "apoc.window.run", mode = Mode.READ)
    @Description("apoc.window.run(sourceQuery, params, spec, includePartitionId = false) executes a query and appends a window-function result to each row.")
    public Stream<WindowRowResult> run(
            @Name("sourceQuery") String sourceQuery,
            @Name("params") Map<String, Object> params,
            @Name("spec") Map<String, Object> spec,
            @Name(value = "includePartitionId", defaultValue = "false") Boolean includePartitionId) {
        if (sourceQuery == null || sourceQuery.isBlank()) {
            throw new IllegalArgumentException("sourceQuery must not be blank");
        }

        WindowSpec windowSpec = WindowSpec.from(spec);
        Map<String, Object> effectiveParams = params == null ? Map.of() : params;
        boolean emitPartitionId = Boolean.TRUE.equals(includePartitionId);

        try (Result result = tx.execute(sourceQuery, effectiveParams)) {
            List<String> columns = List.copyOf(result.columns());
            windowSpec.validateAgainstColumns(columns, emitPartitionId, ColumnSource.SOURCE_QUERY);

            List<Map<String, Object>> sourceRows = new ArrayList<>();
            while (result.hasNext()) {
                sourceRows.add(result.next());
            }

            return windowRows(sourceRows, columns, windowSpec, emitPartitionId, ColumnSource.SOURCE_QUERY);
        }
    }

    @Procedure(name = "apoc.window.runRows", mode = Mode.READ)
    @Description("apoc.window.runRows(rows, spec, includePartitionId = false) appends a window-function result to each supplied row binding.")
    public Stream<WindowRowResult> runRows(
            @Name("rows") List<Map<String, Object>> sourceRows,
            @Name("spec") Map<String, Object> spec,
            @Name(value = "includePartitionId", defaultValue = "false") Boolean includePartitionId) {
        if (sourceRows == null) {
            throw new IllegalArgumentException("rows must not be null");
        }

        WindowSpec windowSpec = WindowSpec.from(spec);
        boolean emitPartitionId = Boolean.TRUE.equals(includePartitionId);
        List<String> columns = columnsFromRows(sourceRows);
        if (sourceRows.isEmpty()) {
            windowSpec.validateEmptyRows(emitPartitionId);
            return Stream.empty();
        }

        return windowRows(sourceRows, columns, windowSpec, emitPartitionId, ColumnSource.ROWS);
    }

    @Procedure(name = "apoc.window.runPath", mode = Mode.READ)
    @Description("apoc.window.runPath(sourceQuery, params, pathSpec, spec, includePartitionId = false) expands paths into element rows and appends a window-function result.")
    public Stream<WindowRowResult> runPath(
            @Name("sourceQuery") String sourceQuery,
            @Name("params") Map<String, Object> params,
            @Name("pathSpec") Map<String, Object> pathSpec,
            @Name("spec") Map<String, Object> spec,
            @Name(value = "includePartitionId", defaultValue = "false") Boolean includePartitionId) {
        if (sourceQuery == null || sourceQuery.isBlank()) {
            throw new IllegalArgumentException("sourceQuery must not be blank");
        }

        PathSpec parsedPathSpec = PathSpec.from(pathSpec);
        WindowSpec windowSpec = WindowSpec.from(spec);
        Map<String, Object> effectiveParams = params == null ? Map.of() : params;
        boolean emitPartitionId = Boolean.TRUE.equals(includePartitionId);

        try (Result result = tx.execute(sourceQuery, effectiveParams)) {
            List<String> columns = List.copyOf(result.columns());
            parsedPathSpec.validateAgainstColumns(columns, ColumnSource.SOURCE_QUERY);

            List<Map<String, Object>> sourceRows = new ArrayList<>();
            while (result.hasNext()) {
                sourceRows.add(result.next());
            }

            return windowPathRows(sourceRows, columns, parsedPathSpec, windowSpec, emitPartitionId, ColumnSource.SOURCE_QUERY);
        }
    }

    @Procedure(name = "apoc.window.runPathRows", mode = Mode.READ)
    @Description("apoc.window.runPathRows(rows, pathSpec, spec, includePartitionId = false) expands supplied path bindings into element rows and appends a window-function result.")
    public Stream<WindowRowResult> runPathRows(
            @Name("rows") List<Map<String, Object>> sourceRows,
            @Name("pathSpec") Map<String, Object> pathSpec,
            @Name("spec") Map<String, Object> spec,
            @Name(value = "includePartitionId", defaultValue = "false") Boolean includePartitionId) {
        if (sourceRows == null) {
            throw new IllegalArgumentException("rows must not be null");
        }

        PathSpec parsedPathSpec = PathSpec.from(pathSpec);
        WindowSpec windowSpec = WindowSpec.from(spec);
        boolean emitPartitionId = Boolean.TRUE.equals(includePartitionId);
        parsedPathSpec.validateAgainstWindowSpec(windowSpec, emitPartitionId);
        List<String> columns = columnsFromRows(sourceRows);
        if (sourceRows.isEmpty()) {
            windowSpec.validateEmptyRows(emitPartitionId);
            return Stream.empty();
        }

        return windowPathRows(sourceRows, columns, parsedPathSpec, windowSpec, emitPartitionId, ColumnSource.ROWS);
    }

    private static Stream<WindowRowResult> windowRows(
            List<Map<String, Object>> sourceRows,
            List<String> columns,
            WindowSpec windowSpec,
            boolean emitPartitionId,
            ColumnSource columnSource) {
        windowSpec.validateAgainstColumns(columns, emitPartitionId, columnSource);

        List<RowState> rows = new ArrayList<>(sourceRows.size());
        for (int sourceIndex = 0; sourceIndex < sourceRows.size(); sourceIndex++) {
            rows.add(RowState.from(sourceIndex, sourceRows.get(sourceIndex), windowSpec));
        }

        applyWindow(rows, windowSpec);
        return rows.stream()
                .map(row -> row.resultRow(windowSpec.outputAlias, emitPartitionId))
                .map(WindowRowResult::new);
    }

    private static Stream<WindowRowResult> windowPathRows(
            List<Map<String, Object>> sourceRows,
            List<String> sourceColumns,
            PathSpec pathSpec,
            WindowSpec windowSpec,
            boolean emitPartitionId,
            ColumnSource columnSource) {
        pathSpec.validateAgainstWindowSpec(windowSpec, emitPartitionId);
        List<String> expandedColumns = pathSpec.expandedColumns(sourceColumns, columnSource);
        if (sourceRows.isEmpty()) {
            windowSpec.validateAgainstColumns(expandedColumns, emitPartitionId, columnSource);
            return Stream.empty();
        }

        List<Map<String, Object>> expandedRows = expandPathRows(sourceRows, pathSpec);
        if (expandedRows.isEmpty()) {
            windowSpec.validateAgainstColumns(expandedColumns, emitPartitionId, columnSource);
            return Stream.empty();
        }

        return windowRows(expandedRows, expandedColumns, windowSpec, emitPartitionId, columnSource);
    }

    private static List<Map<String, Object>> expandPathRows(List<Map<String, Object>> sourceRows, PathSpec pathSpec) {
        List<Map<String, Object>> expandedRows = new ArrayList<>();
        for (int rowIndex = 0; rowIndex < sourceRows.size(); rowIndex++) {
            Map<String, Object> sourceRow = requireRow(sourceRows.get(rowIndex), rowIndex);
            Path path = pathSpec.requirePath(sourceRow, rowIndex);
            int position = 0;
            for (Object element : pathSpec.elements.elements(path)) {
                LinkedHashMap<String, Object> expandedRow = new LinkedHashMap<>(sourceRow);
                expandedRow.put(pathSpec.elementAlias, element);
                expandedRow.put(pathSpec.positionAlias, position++);
                for (PathProjection projection : pathSpec.projections) {
                    expandedRow.put(projection.alias, projectedProperty(element, projection.property));
                }
                expandedRows.add(expandedRow);
            }
        }
        return expandedRows;
    }

    private static Object projectedProperty(Object element, String property) {
        if (element instanceof Node node) {
            return node.getProperty(property, null);
        }
        if (element instanceof Relationship relationship) {
            return relationship.getProperty(property, null);
        }
        throw new IllegalArgumentException("path elements must be nodes or relationships");
    }

    private static List<String> columnsFromRows(List<Map<String, Object>> sourceRows) {
        if (sourceRows.isEmpty()) {
            return List.of();
        }

        Map<String, Object> firstRow = requireRow(sourceRows.getFirst(), 0);
        List<String> columns = List.copyOf(firstRow.keySet());
        Set<String> expectedColumns = new LinkedHashSet<>(columns);
        for (int index = 1; index < sourceRows.size(); index++) {
            Map<String, Object> row = requireRow(sourceRows.get(index), index);
            if (!new LinkedHashSet<>(row.keySet()).equals(expectedColumns)) {
                throw new IllegalArgumentException("rows must use the same keys as the first row");
            }
        }
        return columns;
    }

    private static Map<String, Object> requireRow(Map<String, Object> row, int index) {
        if (row == null) {
            throw new IllegalArgumentException("rows[" + index + "] must not be null");
        }
        return row;
    }

    private static void applyWindow(List<RowState> rows, WindowSpec windowSpec) {
        Map<PartitionKey, List<RowState>> partitions = new LinkedHashMap<>();
        for (RowState row : rows) {
            partitions.computeIfAbsent(row.partitionKey, ignored -> new ArrayList<>()).add(row);
        }

        Comparator<RowState> comparator = comparatorFor(windowSpec.orderBy);
        long partitionId = 1L;
        for (List<RowState> partition : partitions.values()) {
            for (RowState row : partition) {
                row.partitionId = partitionId;
            }
            List<RowState> orderedRows = new ArrayList<>(partition);
            orderedRows.sort(comparator);
            applyWindowToPartition(orderedRows, windowSpec);
            partitionId++;
        }
    }

    private static void applyWindowToPartition(List<RowState> orderedRows, WindowSpec windowSpec) {
        switch (windowSpec.function) {
            case RANK -> applyRank(orderedRows, windowSpec);
            case ROW_NUMBER -> applyRowNumber(orderedRows);
            case SUM -> applyWindowedSum(orderedRows, windowSpec);
        }
    }

    private static void applyRank(List<RowState> orderedRows, WindowSpec windowSpec) {
        RowState previous = null;
        long currentRank = 0;

        for (int i = 0; i < orderedRows.size(); i++) {
            RowState current = orderedRows.get(i);
            if (previous == null || !sameOrderKey(previous, current, windowSpec.orderBy)) {
                currentRank = i + 1L;
            }
            current.output = currentRank;
            previous = current;
        }
    }

    private static void applyRowNumber(List<RowState> orderedRows) {
        for (int i = 0; i < orderedRows.size(); i++) {
            orderedRows.get(i).output = i + 1L;
        }
    }

    private static void applyWindowedSum(List<RowState> orderedRows, WindowSpec windowSpec) {
        PartitionContext context = PartitionContext.from(orderedRows, windowSpec.orderBy);

        for (int currentIndex = 0; currentIndex < orderedRows.size(); currentIndex++) {
            NumericAccumulator accumulator = new NumericAccumulator();
            boolean hasValues = false;

            for (RowState frameRow : frameRows(context, currentIndex, windowSpec.frame)) {
                Object value = frameRow.values.get(windowSpec.inputColumn);
                if (value != null && !(value instanceof Number)) {
                    throw new IllegalArgumentException("Window input '" + windowSpec.inputColumn + "' must be numeric for sum()");
                }

                if (value instanceof Number number) {
                    accumulator.add(number);
                    hasValues = true;
                }
            }

            orderedRows.get(currentIndex).output = hasValues ? accumulator.value() : null;
        }
    }

    private static List<RowState> frameRows(PartitionContext context, int currentIndex, FrameSpec frame) {
        IndexRange baseRange = frameRange(context, currentIndex, frame);
        if (baseRange.isEmpty()) {
            return List.of();
        }

        PeerGroup peerGroup = context.peerGroupFor(currentIndex);
        List<RowState> rows = new ArrayList<>();
        for (int index = baseRange.startIndex; index <= baseRange.endIndex; index++) {
            if (shouldExclude(index, currentIndex, peerGroup, frame.exclusion)) {
                continue;
            }
            rows.add(context.orderedRows.get(index));
        }
        return rows;
    }

    private static boolean shouldExclude(int rowIndex, int currentIndex, PeerGroup peerGroup, FrameExclusion exclusion) {
        return switch (exclusion) {
            case NO_OTHERS -> false;
            case CURRENT_ROW -> rowIndex == currentIndex;
            case GROUP -> rowIndex >= peerGroup.startIndex && rowIndex <= peerGroup.endIndex;
            case TIES -> rowIndex != currentIndex && rowIndex >= peerGroup.startIndex && rowIndex <= peerGroup.endIndex;
        };
    }

    private static IndexRange frameRange(PartitionContext context, int currentIndex, FrameSpec frame) {
        int startIndex = resolveBoundaryIndex(context, currentIndex, frame.mode, frame.start, BoundaryRole.START);
        int endIndex = resolveBoundaryIndex(context, currentIndex, frame.mode, frame.end, BoundaryRole.END);

        startIndex = Math.max(0, startIndex);
        endIndex = Math.min(context.orderedRows.size() - 1, endIndex);
        if (startIndex > endIndex || startIndex >= context.orderedRows.size() || endIndex < 0) {
            return IndexRange.empty();
        }
        return new IndexRange(startIndex, endIndex);
    }

    private static int resolveBoundaryIndex(
            PartitionContext context,
            int currentIndex,
            FrameMode mode,
            FrameBoundary boundary,
            BoundaryRole role) {
        return switch (mode) {
            case ROWS -> resolveRowsBoundaryIndex(context, currentIndex, boundary);
            case GROUPS -> resolveGroupsBoundaryIndex(context, currentIndex, boundary, role);
            case RANGE -> resolveRangeBoundaryIndex(context, currentIndex, boundary, role);
        };
    }

    private static int resolveRowsBoundaryIndex(PartitionContext context, int currentIndex, FrameBoundary boundary) {
        return switch (boundary.type) {
            case UNBOUNDED_PRECEDING -> 0;
            case PRECEDING -> currentIndex - boundary.integerOffset("ROWS");
            case CURRENT_ROW -> currentIndex;
            case FOLLOWING -> currentIndex + boundary.integerOffset("ROWS");
            case UNBOUNDED_FOLLOWING -> context.orderedRows.size() - 1;
        };
    }

    private static int resolveGroupsBoundaryIndex(
            PartitionContext context,
            int currentIndex,
            FrameBoundary boundary,
            BoundaryRole role) {
        int currentGroupIndex = context.groupIndexFor(currentIndex);
        int targetGroupIndex = switch (boundary.type) {
            case UNBOUNDED_PRECEDING -> 0;
            case PRECEDING -> Math.max(0, currentGroupIndex - boundary.integerOffset("GROUPS"));
            case CURRENT_ROW -> currentGroupIndex;
            case FOLLOWING -> Math.min(context.peerGroups.size() - 1, currentGroupIndex + boundary.integerOffset("GROUPS"));
            case UNBOUNDED_FOLLOWING -> context.peerGroups.size() - 1;
        };

        PeerGroup targetGroup = context.peerGroups.get(targetGroupIndex);
        return role == BoundaryRole.START ? targetGroup.startIndex : targetGroup.endIndex;
    }

    private static int resolveRangeBoundaryIndex(
            PartitionContext context,
            int currentIndex,
            FrameBoundary boundary,
            BoundaryRole role) {
        if (!boundary.usesOffset()) {
            return switch (boundary.type) {
                case UNBOUNDED_PRECEDING -> 0;
                case CURRENT_ROW -> {
                    PeerGroup peerGroup = context.peerGroupFor(currentIndex);
                    yield role == BoundaryRole.START ? peerGroup.startIndex : peerGroup.endIndex;
                }
                case UNBOUNDED_FOLLOWING -> context.orderedRows.size() - 1;
                default -> throw new IllegalArgumentException("RANGE boundary type " + boundary.type + " is not supported");
            };
        }

        OrderSpec order = context.singleRangeOrder();
        Object currentValue = context.orderedRows.get(currentIndex).values.get(order.column);
        int boundaryIndex = role == BoundaryRole.START ? context.orderedRows.size() : -1;
        for (int candidateIndex = 0; candidateIndex < context.orderedRows.size(); candidateIndex++) {
            Object candidateValue = context.orderedRows.get(candidateIndex).values.get(order.column);
            if (!rangeBoundaryMatches(candidateValue, currentValue, boundary.value, order.direction, boundary.type, role)) {
                continue;
            }

            if (role == BoundaryRole.START) {
                return candidateIndex;
            }
            boundaryIndex = candidateIndex;
        }
        return boundaryIndex;
    }

    private static boolean rangeBoundaryMatches(
            Object candidateValue,
            Object currentValue,
            Object offset,
            SortDirection direction,
            BoundaryType boundaryType,
            BoundaryRole role) {
        if (candidateValue instanceof Number && currentValue instanceof Number && offset instanceof Number) {
            BigDecimal candidate = new BigDecimal(candidateValue.toString());
            BigDecimal current = new BigDecimal(currentValue.toString());
            BigDecimal threshold = switch (direction) {
                case ASC -> boundaryType == BoundaryType.PRECEDING ? current.subtract(numericOffset(offset)) : current.add(numericOffset(offset));
                case DESC -> boundaryType == BoundaryType.PRECEDING ? current.add(numericOffset(offset)) : current.subtract(numericOffset(offset));
            };

            return switch (direction) {
                case ASC -> {
                    int comparison = candidate.compareTo(threshold);
                    yield role == BoundaryRole.START ? comparison >= 0 : comparison <= 0;
                }
                case DESC -> {
                    int comparison = candidate.compareTo(threshold);
                    yield role == BoundaryRole.START ? comparison <= 0 : comparison >= 0;
                }
            };
        }

        if (candidateValue instanceof Temporal candidate && currentValue instanceof Temporal current && offset instanceof TemporalAmount amount) {
            Object threshold = temporalThreshold(current, amount, direction, boundaryType);
            int comparison = compareValues(candidate, threshold);
            return switch (direction) {
                case ASC -> role == BoundaryRole.START ? comparison >= 0 : comparison <= 0;
                case DESC -> role == BoundaryRole.START ? comparison <= 0 : comparison >= 0;
            };
        }

        return compareValues(candidateValue, currentValue) == 0;
    }

    private static Comparator<RowState> comparatorFor(List<OrderSpec> orderBy) {
        return (left, right) -> {
            for (OrderSpec spec : orderBy) {
                int comparison = compareValues(left.values.get(spec.column), right.values.get(spec.column));
                if (comparison != 0) {
                    return spec.direction == SortDirection.ASC ? comparison : -comparison;
                }
            }
            return Integer.compare(left.sourceIndex, right.sourceIndex);
        };
    }

    private static boolean sameOrderKey(RowState left, RowState right, List<OrderSpec> orderBy) {
        for (OrderSpec spec : orderBy) {
            if (compareValues(left.values.get(spec.column), right.values.get(spec.column)) != 0) {
                return false;
            }
        }
        return true;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static int compareValues(Object left, Object right) {
        if (left == right) {
            return 0;
        }
        if (left == null) {
            return -1;
        }
        if (right == null) {
            return 1;
        }
        if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
            return new BigDecimal(leftNumber.toString()).compareTo(new BigDecimal(rightNumber.toString()));
        }
        if (left instanceof Node leftNode && right instanceof Node rightNode) {
            return leftNode.getElementId().compareTo(rightNode.getElementId());
        }
        if (left instanceof Relationship leftRelationship && right instanceof Relationship rightRelationship) {
            return leftRelationship.getElementId().compareTo(rightRelationship.getElementId());
        }
        if (left instanceof Path leftPath && right instanceof Path rightPath) {
            return pathSignature(leftPath).compareTo(pathSignature(rightPath));
        }
        if (left instanceof Temporal && right instanceof Temporal && left instanceof Comparable comparableLeft) {
            return comparableLeft.compareTo(right);
        }
        if (left instanceof Comparable comparableLeft && left.getClass().isInstance(right)) {
            return comparableLeft.compareTo(right);
        }
        return canonicalValue(left).toString().compareTo(canonicalValue(right).toString());
    }

    private static Object canonicalValue(Object value) {
        if (value instanceof Node node) {
            return "node:" + node.getElementId();
        }
        if (value instanceof Relationship relationship) {
            return "relationship:" + relationship.getElementId();
        }
        if (value instanceof Path path) {
            return pathSignature(path);
        }
        if (value instanceof Number number) {
            return new BigDecimal(number.toString()).stripTrailingZeros();
        }
        if (value instanceof List<?> list) {
            return list.stream().map(WindowFunctionProcedure::canonicalValue).toList();
        }
        if (value instanceof Map<?, ?> map) {
            LinkedHashMap<Object, Object> normalized = new LinkedHashMap<>();
            map.forEach((key, entryValue) -> normalized.put(key, canonicalValue(entryValue)));
            return normalized;
        }
        return value;
    }

    private static String pathSignature(Path path) {
        List<String> elements = new ArrayList<>();
        elements.add("node:" + path.startNode().getElementId());
        for (Relationship relationship : path.relationships()) {
            elements.add("rel:" + relationship.getElementId());
            elements.add("node:" + relationship.getEndNode().getElementId());
        }
        return String.join("|", elements);
    }

    private static String normalizeToken(String value) {
        return value.trim().replace(' ', '_').toUpperCase(Locale.ROOT);
    }

    private static BigDecimal numericOffset(Object rawValue) {
        if (!(rawValue instanceof Number number)) {
            throw new IllegalArgumentException("RANGE offsets for numeric ORDER BY values must be non-negative numbers");
        }

        BigDecimal offset = new BigDecimal(number.toString());
        if (offset.signum() < 0) {
            throw new IllegalArgumentException("RANGE offsets must be non-negative");
        }
        return offset;
    }

    private static Object temporalThreshold(
            Temporal current,
            TemporalAmount offset,
            SortDirection direction,
            BoundaryType boundaryType) {
        try {
            return switch (direction) {
                case ASC -> boundaryType == BoundaryType.PRECEDING ? current.minus(offset) : current.plus(offset);
                case DESC -> boundaryType == BoundaryType.PRECEDING ? current.plus(offset) : current.minus(offset);
            };
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("RANGE temporal offsets must be compatible with the ORDER BY value type", exception);
        }
    }

    public static class WindowRowResult {
        public final Map<String, Object> row;

        public WindowRowResult(Map<String, Object> row) {
            this.row = row;
        }
    }

    private static final class RowState {
        private final int sourceIndex;
        private final Map<String, Object> values;
        private final PartitionKey partitionKey;
        private long partitionId;
        private Object output;

        private RowState(int sourceIndex, Map<String, Object> values, PartitionKey partitionKey) {
            this.sourceIndex = sourceIndex;
            this.values = values;
            this.partitionKey = partitionKey;
        }

        private static RowState from(int sourceIndex, Map<String, Object> sourceRow, WindowSpec spec) {
            LinkedHashMap<String, Object> values = new LinkedHashMap<>(sourceRow);
            return new RowState(sourceIndex, values, partitionKeyFor(values, spec.partitionBy));
        }

        private Map<String, Object> resultRow(String outputAlias, boolean includePartitionId) {
            LinkedHashMap<String, Object> row = new LinkedHashMap<>(values);
            row.put(outputAlias, output);
            if (includePartitionId) {
                row.put(PARTITION_ID_COLUMN, partitionId);
            }
            return row;
        }
    }

    private static PartitionKey partitionKeyFor(Map<String, Object> row, List<String> partitionBy) {
        if (partitionBy.isEmpty()) {
            return GLOBAL_PARTITION;
        }

        List<Object> values = new ArrayList<>(partitionBy.size());
        for (String column : partitionBy) {
            values.add(canonicalValue(row.get(column)));
        }
        return new PartitionKey(values);
    }

    private record PartitionKey(List<Object> values) {
    }

    private enum ColumnSource {
        SOURCE_QUERY("sourceQuery", "already projects", "project it in sourceQuery first"),
        ROWS("rows", "already contain", "include it in rows first");

        private final String label;
        private final String reservedAliasVerb;
        private final String missingAliasHint;

        ColumnSource(String label, String reservedAliasVerb, String missingAliasHint) {
            this.label = label;
            this.reservedAliasVerb = reservedAliasVerb;
            this.missingAliasHint = missingAliasHint;
        }
    }

    private record PathSpec(
            String pathAlias,
            PathElements elements,
            String elementAlias,
            String positionAlias,
            List<PathProjection> projections) {

        private static PathSpec from(Map<String, Object> pathSpec) {
            if (pathSpec == null || pathSpec.isEmpty()) {
                throw new IllegalArgumentException("pathSpec must not be empty");
            }

            PathSpec parsed = new PathSpec(
                    requiredPathString(pathSpec, "path"),
                    PathElements.from(pathSpec.get("elements")),
                    requiredPathString(pathSpec, "elementAlias"),
                    requiredPathString(pathSpec, "positionAlias"),
                    pathProjections(pathSpec.get("project")));
            parsed.validateUniqueAliases();
            return parsed;
        }

        private void validateAgainstColumns(List<String> sourceColumns, ColumnSource columnSource) {
            if (!sourceColumns.contains(pathAlias)) {
                throw new IllegalArgumentException(
                        "Unknown path alias '" + pathAlias + "'; " + columnSource.missingAliasHint);
            }

            Set<String> columns = new LinkedHashSet<>(sourceColumns);
            for (String alias : outputAliases()) {
                if (columns.contains(alias)) {
                    throw new IllegalArgumentException(
                            "pathSpec alias '" + alias + "' already exists in " + columnSource.label);
                }
            }
        }

        private void validateAgainstWindowSpec(WindowSpec windowSpec, boolean includePartitionId) {
            for (String alias : outputAliases()) {
                if (alias.equals(windowSpec.outputAlias())) {
                    throw new IllegalArgumentException(
                            "Window output alias '" + alias + "' already exists in pathSpec output aliases");
                }
                if (includePartitionId && PARTITION_ID_COLUMN.equals(alias)) {
                    throw new IllegalArgumentException("pathSpec alias '" + PARTITION_ID_COLUMN + "' is reserved");
                }
            }
        }

        private List<String> expandedColumns(List<String> sourceColumns, ColumnSource columnSource) {
            validateAgainstColumns(sourceColumns, columnSource);
            LinkedHashSet<String> columns = new LinkedHashSet<>(sourceColumns);
            columns.addAll(outputAliases());
            return List.copyOf(columns);
        }

        private Path requirePath(Map<String, Object> row, int rowIndex) {
            Object pathValue = row.get(pathAlias);
            if (!(pathValue instanceof Path path)) {
                throw new IllegalArgumentException(
                        "Path alias '" + pathAlias + "' in rows[" + rowIndex + "] must contain a path");
            }
            return path;
        }

        private List<String> outputAliases() {
            List<String> aliases = new ArrayList<>(2 + projections.size());
            aliases.add(elementAlias);
            aliases.add(positionAlias);
            for (PathProjection projection : projections) {
                aliases.add(projection.alias);
            }
            return aliases;
        }

        private void validateUniqueAliases() {
            Set<String> aliases = new LinkedHashSet<>();
            for (String alias : outputAliases()) {
                if (!aliases.add(alias)) {
                    throw new IllegalArgumentException("pathSpec aliases must be unique; duplicate alias '" + alias + "'");
                }
            }
        }
    }

    private enum PathElements {
        EDGES {
            @Override
            Iterable<?> elements(Path path) {
                return path.relationships();
            }
        },
        NODES {
            @Override
            Iterable<?> elements(Path path) {
                return path.nodes();
            }
        };

        abstract Iterable<?> elements(Path path);

        private static PathElements from(Object value) {
            if (!(value instanceof String rawElements) || rawElements.isBlank()) {
                throw new IllegalArgumentException("pathSpec.elements must be EDGES or NODES");
            }

            return switch (normalizeToken(rawElements)) {
                case "EDGES" -> EDGES;
                case "NODES" -> NODES;
                default -> throw new IllegalArgumentException("pathSpec.elements must be EDGES or NODES");
            };
        }
    }

    private record PathProjection(String property, String alias) {
    }

    private record WindowSpec(
            WindowFunction function,
            String outputAlias,
            String inputColumn,
            List<String> partitionBy,
            List<OrderSpec> orderBy,
            FrameSpec frame) {

        private static WindowSpec from(Map<String, Object> spec) {
            if (spec == null || spec.isEmpty()) {
                throw new IllegalArgumentException("spec must not be empty");
            }

            WindowFunction function = WindowFunction.from(spec.get("function"));
            String outputAlias = requiredString(spec, "as");
            String inputColumn = function == WindowFunction.SUM ? requiredString(spec, "input") : optionalString(spec, "input");
            List<String> partitionBy = stringList(spec.get("partitionBy"));
            List<OrderSpec> orderBy = orderSpecs(spec.get("orderBy"));
            FrameSpec frame = FrameSpec.from(spec.get("frame"), orderBy);

            return new WindowSpec(function, outputAlias, inputColumn, partitionBy, orderBy, frame);
        }

        private void validateEmptyRows(boolean includePartitionId) {
            if (includePartitionId && PARTITION_ID_COLUMN.equals(outputAlias)) {
                throw new IllegalArgumentException("Window output alias '" + PARTITION_ID_COLUMN + "' is reserved");
            }
        }

        private void validateAgainstColumns(List<String> columns, boolean includePartitionId, ColumnSource columnSource) {
            Set<String> availableColumns = new LinkedHashSet<>(columns);
            if (includePartitionId) {
                if (PARTITION_ID_COLUMN.equals(outputAlias)) {
                    throw new IllegalArgumentException("Window output alias '" + PARTITION_ID_COLUMN + "' is reserved");
                }
                if (availableColumns.contains(PARTITION_ID_COLUMN)) {
                    throw new IllegalArgumentException(
                            columnSource.label + " " + columnSource.reservedAliasVerb
                                    + " reserved alias '" + PARTITION_ID_COLUMN + "'");
                }
            }
            if (!availableColumns.add(outputAlias)) {
                throw new IllegalArgumentException(
                        "Window output alias '" + outputAlias + "' already exists in " + columnSource.label);
            }

            if (function == WindowFunction.SUM && !availableColumns.contains(inputColumn)) {
                throw unknownAlias("input", inputColumn, columnSource);
            }

            for (String column : partitionBy) {
                if (!availableColumns.contains(column)) {
                    throw unknownAlias("partitionBy", column, columnSource);
                }
            }

            for (OrderSpec order : orderBy) {
                if (!availableColumns.contains(order.column)) {
                    throw unknownAlias("orderBy", order.column, columnSource);
                }
            }
        }

        private IllegalArgumentException unknownAlias(String section, String alias, ColumnSource columnSource) {
            return new IllegalArgumentException(
                    "Unknown alias '" + alias + "' in " + section + "; " + columnSource.missingAliasHint);
        }
    }

    private enum WindowFunction {
        RANK,
        ROW_NUMBER,
        SUM;

        private static WindowFunction from(Object functionName) {
            if (!(functionName instanceof String name) || name.isBlank()) {
                throw new IllegalArgumentException("spec.function must be a non-empty string");
            }

            return switch (name.toLowerCase(Locale.ROOT)) {
                case "rank" -> RANK;
                case "row_number" -> ROW_NUMBER;
                case "sum" -> SUM;
                default -> throw new IllegalArgumentException("Unknown window function '" + name + "'");
            };
        }
    }

    private record OrderSpec(String column, SortDirection direction) {
    }

    private enum SortDirection {
        ASC,
        DESC;

        private static SortDirection from(Object value) {
            if (value == null) {
                return ASC;
            }
            if (!(value instanceof String direction) || direction.isBlank()) {
                throw new IllegalArgumentException("orderBy.direction must be ASC or DESC");
            }

            return switch (normalizeToken(direction)) {
                case "ASC" -> ASC;
                case "DESC" -> DESC;
                default -> throw new IllegalArgumentException("orderBy.direction must be ASC or DESC");
            };
        }
    }

    private record FrameSpec(
            FrameMode mode,
            FrameBoundary start,
            FrameBoundary end,
            FrameExclusion exclusion) {

        private static FrameSpec from(Object frameObject, List<OrderSpec> orderBy) {
            if (frameObject == null) {
                return defaultFrame(orderBy);
            }
            if (!(frameObject instanceof Map<?, ?> rawFrame)) {
                throw new IllegalArgumentException("spec.frame must be a map");
            }

            Map<String, Object> frame = castMap(rawFrame, "spec.frame");
            FrameSpec frameSpec = new FrameSpec(
                    FrameMode.from(optionalString(frame, "mode")),
                    FrameBoundary.from(frame.get("start"), FrameBoundary.defaultStart()),
                    FrameBoundary.from(frame.get("end"), FrameBoundary.defaultEnd()),
                    FrameExclusion.from(frame.get("exclude")));

            frameSpec.validate(orderBy);
            return frameSpec;
        }

        private static FrameSpec defaultFrame(List<OrderSpec> orderBy) {
            FrameSpec frameSpec = new FrameSpec(
                    FrameMode.RANGE,
                    FrameBoundary.defaultStart(),
                    FrameBoundary.defaultEnd(),
                    FrameExclusion.NO_OTHERS);
            frameSpec.validate(orderBy);
            return frameSpec;
        }

        private void validate(List<OrderSpec> orderBy) {
            if (start.type == BoundaryType.UNBOUNDED_FOLLOWING) {
                throw new IllegalArgumentException("frame.start cannot be UNBOUNDED FOLLOWING");
            }
            if (end.type == BoundaryType.UNBOUNDED_PRECEDING) {
                throw new IllegalArgumentException("frame.end cannot be UNBOUNDED PRECEDING");
            }
            if (end.type.precedence < start.type.precedence) {
                throw new IllegalArgumentException("frame.end cannot appear earlier than frame.start");
            }

            validateOffset(start, "start");
            validateOffset(end, "end");

            if (mode == FrameMode.RANGE && (start.usesOffset() || end.usesOffset()) && orderBy.size() != 1) {
                throw new IllegalArgumentException("RANGE offsets require exactly one orderBy column");
            }
        }

        private void validateOffset(FrameBoundary boundary, String label) {
            if (!boundary.usesOffset()) {
                return;
            }

            switch (mode) {
                case ROWS, GROUPS -> boundary.integerOffset(mode.name());
                case RANGE -> validateRangeOffset(boundary.value);
            }
        }
    }

    private enum FrameMode {
        RANGE,
        ROWS,
        GROUPS;

        private static FrameMode from(String rawMode) {
            if (rawMode == null || rawMode.isBlank()) {
                return RANGE;
            }

            return switch (normalizeToken(rawMode)) {
                case RANGE_MODE -> RANGE;
                case ROWS_MODE -> ROWS;
                case GROUPS_MODE -> GROUPS;
                default -> throw new IllegalArgumentException("frame.mode must be RANGE, ROWS, or GROUPS");
            };
        }
    }

    private record FrameBoundary(BoundaryType type, Object value) {

        private static FrameBoundary defaultStart() {
            return new FrameBoundary(BoundaryType.UNBOUNDED_PRECEDING, null);
        }

        private static FrameBoundary defaultEnd() {
            return new FrameBoundary(BoundaryType.CURRENT_ROW, null);
        }

        private static FrameBoundary from(Object rawBoundary, FrameBoundary defaultBoundary) {
            if (rawBoundary == null) {
                return defaultBoundary;
            }
            if (rawBoundary instanceof String keyword) {
                return switch (normalizeToken(keyword)) {
                    case UNBOUNDED_PRECEDING -> new FrameBoundary(BoundaryType.UNBOUNDED_PRECEDING, null);
                    case CURRENT_ROW -> new FrameBoundary(BoundaryType.CURRENT_ROW, null);
                    case UNBOUNDED_FOLLOWING -> new FrameBoundary(BoundaryType.UNBOUNDED_FOLLOWING, null);
                    default -> throw new IllegalArgumentException("Unsupported frame boundary '" + keyword + "'");
                };
            }
            if (!(rawBoundary instanceof Map<?, ?> rawMap)) {
                throw new IllegalArgumentException("Frame boundaries must be strings or maps");
            }

            Map<String, Object> boundary = castMap(rawMap, "frame boundary");
            String type = requiredString(boundary, "type");
            Object value = boundary.get("value");
            return switch (normalizeToken(type)) {
                case "PRECEDING" -> new FrameBoundary(BoundaryType.PRECEDING, value);
                case "FOLLOWING" -> new FrameBoundary(BoundaryType.FOLLOWING, value);
                default -> throw new IllegalArgumentException("Frame boundary maps must use type PRECEDING or FOLLOWING");
            };
        }

        private boolean usesOffset() {
            return type == BoundaryType.PRECEDING || type == BoundaryType.FOLLOWING;
        }

        private int integerOffset(String modeName) {
            if (!(value instanceof Number number)) {
                throw new IllegalArgumentException(modeName + " offsets must be non-negative integers");
            }

            BigDecimal offset = new BigDecimal(number.toString()).stripTrailingZeros();
            if (offset.signum() < 0) {
                throw new IllegalArgumentException(modeName + " offsets must be non-negative");
            }
            if (offset.scale() > 0) {
                throw new IllegalArgumentException(modeName + " offsets must be integers");
            }
            return offset.intValueExact();
        }
    }

    private static void validateRangeOffset(Object value) {
        if (value instanceof Number) {
            numericOffset(value);
            return;
        }
        if (value instanceof java.time.Duration duration) {
            if (duration.isNegative()) {
                throw new IllegalArgumentException("RANGE offsets must be non-negative");
            }
            return;
        }
        if (value instanceof java.time.Period period) {
            if (period.isNegative()) {
                throw new IllegalArgumentException("RANGE offsets must be non-negative");
            }
            return;
        }
        if (value instanceof TemporalAmount) {
            return;
        }
        throw new IllegalArgumentException("RANGE offsets must be non-negative numbers or temporal amounts");
    }

    private enum BoundaryType {
        UNBOUNDED_PRECEDING(0),
        PRECEDING(1),
        CURRENT_ROW(2),
        FOLLOWING(3),
        UNBOUNDED_FOLLOWING(4);

        private final int precedence;

        BoundaryType(int precedence) {
            this.precedence = precedence;
        }
    }

    private enum FrameExclusion {
        NO_OTHERS,
        CURRENT_ROW,
        GROUP,
        TIES;

        private static FrameExclusion from(Object rawExclusion) {
            if (rawExclusion == null) {
                return NO_OTHERS;
            }
            if (!(rawExclusion instanceof String exclusion) || exclusion.isBlank()) {
                throw new IllegalArgumentException("frame.exclude must be a string");
            }

            return switch (normalizeToken(exclusion)) {
                case "NO_OTHERS", "EXCLUDE_NO_OTHERS" -> NO_OTHERS;
                case "CURRENT_ROW", "EXCLUDE_CURRENT_ROW" -> CURRENT_ROW;
                case "GROUP", "EXCLUDE_GROUP" -> GROUP;
                case "TIES", "EXCLUDE_TIES" -> TIES;
                default -> throw new IllegalArgumentException(
                        "frame.exclude must be NO_OTHERS, CURRENT_ROW, GROUP, or TIES");
            };
        }
    }

    private enum BoundaryRole {
        START,
        END
    }

    private record PeerGroup(int startIndex, int endIndex) {
    }

    private record PartitionContext(
            List<RowState> orderedRows,
            List<OrderSpec> orderBy,
            List<PeerGroup> peerGroups,
            int[] rowToGroupIndex) {

        private static PartitionContext from(List<RowState> orderedRows, List<OrderSpec> orderBy) {
            List<PeerGroup> peerGroups = new ArrayList<>();
            int[] rowToGroupIndex = new int[orderedRows.size()];

            int index = 0;
            while (index < orderedRows.size()) {
                int startIndex = index;
                while (index + 1 < orderedRows.size() && sameOrderKey(orderedRows.get(index), orderedRows.get(index + 1), orderBy)) {
                    index++;
                }

                int endIndex = index;
                int groupIndex = peerGroups.size();
                peerGroups.add(new PeerGroup(startIndex, endIndex));
                for (int rowIndex = startIndex; rowIndex <= endIndex; rowIndex++) {
                    rowToGroupIndex[rowIndex] = groupIndex;
                }
                index++;
            }

            return new PartitionContext(orderedRows, orderBy, peerGroups, rowToGroupIndex);
        }

        private int groupIndexFor(int rowIndex) {
            return rowToGroupIndex[rowIndex];
        }

        private PeerGroup peerGroupFor(int rowIndex) {
            return peerGroups.get(groupIndexFor(rowIndex));
        }

        private OrderSpec singleRangeOrder() {
            return orderBy.getFirst();
        }
    }

    private record IndexRange(int startIndex, int endIndex) {
        private static IndexRange empty() {
            return new IndexRange(1, 0);
        }

        private boolean isEmpty() {
            return startIndex > endIndex;
        }
    }

    private static final class NumericAccumulator {
        private BigDecimal sum = BigDecimal.ZERO;
        private boolean hasFractionalComponent;

        private void add(Number number) {
            BigDecimal decimal = new BigDecimal(number.toString());
            sum = sum.add(decimal);
            hasFractionalComponent = hasFractionalComponent || decimal.stripTrailingZeros().scale() > 0;
        }

        private Object value() {
            BigDecimal normalized = sum.stripTrailingZeros();
            if (!hasFractionalComponent && normalized.scale() <= 0) {
                return normalized.longValueExact();
            }
            return sum.doubleValue();
        }
    }

    private static String requiredString(Map<String, Object> map, String key) {
        String value = optionalString(map, key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("spec." + key + " must be provided");
        }
        return value;
    }

    private static String optionalString(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (value == null) {
            return null;
        }
        if (!(value instanceof String stringValue)) {
            throw new IllegalArgumentException("spec." + key + " must be a string");
        }
        return stringValue;
    }

    private static String requiredPathString(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (!(value instanceof String stringValue) || stringValue.isBlank()) {
            throw new IllegalArgumentException("pathSpec." + key + " must be provided");
        }
        return stringValue;
    }

    private static List<String> stringList(Object value) {
        if (value == null) {
            return List.of();
        }
        if (!(value instanceof List<?> list)) {
            throw new IllegalArgumentException("spec.partitionBy must be a list of strings");
        }

        List<String> result = new ArrayList<>(list.size());
        for (Object item : list) {
            if (!(item instanceof String stringItem) || stringItem.isBlank()) {
                throw new IllegalArgumentException("spec.partitionBy must be a list of strings");
            }
            result.add(stringItem);
        }
        return List.copyOf(result);
    }

    private static List<PathProjection> pathProjections(Object value) {
        if (value == null) {
            return List.of();
        }
        if (!(value instanceof List<?> list)) {
            throw new IllegalArgumentException("pathSpec.project must be a list");
        }

        List<PathProjection> result = new ArrayList<>(list.size());
        for (Object entry : list) {
            if (!(entry instanceof Map<?, ?> rawProjection)) {
                throw new IllegalArgumentException("pathSpec.project entries must be maps");
            }
            Map<String, Object> projection = castMap(rawProjection, "pathSpec.project entry");
            result.add(new PathProjection(
                    requiredPathString(projection, "property"),
                    requiredPathString(projection, "as")));
        }
        return List.copyOf(result);
    }

    private static List<OrderSpec> orderSpecs(Object value) {
        if (value == null) {
            return List.of();
        }
        if (!(value instanceof List<?> list)) {
            throw new IllegalArgumentException("spec.orderBy must be a list");
        }

        List<OrderSpec> result = new ArrayList<>(list.size());
        for (Object entry : list) {
            if (!(entry instanceof Map<?, ?> rawOrder)) {
                throw new IllegalArgumentException("spec.orderBy entries must be maps");
            }
            Map<String, Object> order = castMap(rawOrder, "spec.orderBy entry");
            result.add(new OrderSpec(requiredString(order, "column"), SortDirection.from(order.get("direction"))));
        }
        return List.copyOf(result);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> rawMap, String label) {
        for (Object key : rawMap.keySet()) {
            if (!(key instanceof String)) {
                throw new IllegalArgumentException(label + " keys must be strings");
            }
        }
        return (Map<String, Object>) rawMap;
    }
}
