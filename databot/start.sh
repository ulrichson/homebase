#!/bin/bash

script_path=$(dirname "$(readlink -f "$0")")

# Expose env vars so that `databot_cron.sh` can access it. Env vars are not available otherwise in a cron job
# See https://roboslang.blog/post/2017-12-06-cron-docker/ and https://unix.stackexchange.com/a/697140 to quote correctly
printenv | sed 's/\(^[^=]*\)=\(.*\)/export \1="\2"/' > "$script_path/.env.sh"
chmod +x ${script_path}/.env.sh

# Run `cron -f` in foreground 
cron -f