#!/usr/bin/env bash

set -euo pipefail

neo4j_pid=""
cypher_shell_args=(-a bolt://localhost:7687)

if [[ "${NEO4J_AUTH:-none}" != "none" ]]; then
  neo4j_user="${NEO4J_AUTH%%/*}"
  neo4j_password="${NEO4J_AUTH#*/}"
  cypher_shell_args+=(-u "${neo4j_user}" -p "${neo4j_password}")
fi

cleanup() {
  if [[ -n "${neo4j_pid}" ]] && kill -0 "${neo4j_pid}" 2>/dev/null; then
    kill "${neo4j_pid}" 2>/dev/null || true
    wait "${neo4j_pid}" || true
  fi
}

wait_for_neo4j() {
  local attempts=90

  until cypher-shell "${cypher_shell_args[@]}" "RETURN 1;" >/dev/null 2>&1; do
    if [[ -n "${neo4j_pid}" ]] && ! kill -0 "${neo4j_pid}" 2>/dev/null; then
      echo "Neo4j exited before it became ready." >&2
      return 1
    fi

    attempts=$((attempts - 1))
    if (( attempts == 0 )); then
      echo "Timed out waiting for Neo4j to accept Cypher connections." >&2
      return 1
    fi

    sleep 2
  done
}

run_init_files() {
  local file=""
  shopt -s nullglob

  for file in /neo4j-init/*.cypher; do
    echo "Running ${file}"
    cypher-shell "${cypher_shell_args[@]}" --file "${file}"
  done
}

trap cleanup INT TERM

/startup/docker-entrypoint.sh neo4j &
neo4j_pid=$!

wait_for_neo4j
run_init_files

wait "${neo4j_pid}"
