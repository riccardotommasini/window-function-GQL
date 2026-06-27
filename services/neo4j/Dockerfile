FROM eclipse-temurin:21-jdk AS plugin-builder

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip \
  && rm -rf /var/lib/apt/lists/*

COPY pom.xml mvnw ./
COPY .mvn .mvn
COPY src src

RUN ./mvnw -DskipTests clean package

FROM neo4j:2026.04.0

COPY --from=plugin-builder /workspace/target/procedure-template-1.0.0-SNAPSHOT.jar /plugins/apoc-window-run.jar
COPY examples /neo4j-init
COPY bin/start-with-examples.sh /start-with-examples.sh

RUN chmod 0644 /plugins/apoc-window-run.jar \
  && chmod 0755 /start-with-examples.sh

ENV NEO4J_AUTH=none

EXPOSE 7474 7687

ENTRYPOINT ["tini", "-g", "--", "/bin/bash", "/start-with-examples.sh"]
