#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/../harmony" && pwd)"
if [[ -d '/Applications/DevEco-Studio.app' ]]; then
  deveco_dir='/Applications/DevEco-Studio.app/Contents'
  export NODE_HOME="${NODE_HOME:-$deveco_dir/tools/node}"
  export JAVA_HOME="${JAVA_HOME:-$deveco_dir/jbr/Contents/Home}"
  export DEVECO_SDK_HOME="${DEVECO_SDK_HOME:-$deveco_dir/sdk}"
  hvigor_command="$deveco_dir/tools/hvigor/bin/hvigorw"
else
  hvigor_command="${HVIGOR_COMMAND:-hvigorw}"
fi
cd "$project_dir"
"$hvigor_command" --mode module -p product=default -p module=entry@default assembleHap --no-daemon
