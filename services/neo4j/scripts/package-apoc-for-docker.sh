#!/usr/bin/env bash

set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$SERVICE_ROOT/plugins"
TARGET_DIR="$SERVICE_ROOT/target"
PLUGIN_NAME="apoc-window-run.jar"

if [[ -x /usr/libexec/java_home ]]; then
  JAVA_21_HOME="$(
    /usr/libexec/java_home -v 21 2>/dev/null || true
  )"
  if [[ -n "${JAVA_21_HOME}" ]]; then
    export JAVA_HOME="${JAVA_21_HOME}"
    export PATH="${JAVA_HOME}/bin:${PATH}"
  fi
fi

if ! java -version 2>&1 | head -n 1 | grep -q '"21\.'; then
  echo "Java 21 is required to build this plugin. Set JAVA_HOME to a JDK 21 install and try again." >&2
  exit 1
fi

mkdir -p "${PLUGIN_DIR}"

(
  cd "${SERVICE_ROOT}"
  ./mvnw -DskipTests clean package
)

JAR_PATH="$(
  find "${TARGET_DIR}" -maxdepth 1 -type f -name '*.jar' ! -name 'original-*' | head -n 1
)"

if [[ -z "${JAR_PATH}" ]]; then
  echo "No packaged plugin jar was found in ${TARGET_DIR}." >&2
  exit 1
fi

cp "${JAR_PATH}" "${PLUGIN_DIR}/${PLUGIN_NAME}"
chmod 0644 "${PLUGIN_DIR}/${PLUGIN_NAME}"

echo "Packaged plugin installed for Docker:"
echo "  ${PLUGIN_DIR}/${PLUGIN_NAME}"
