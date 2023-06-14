#!/bin/bash

script_path=$(dirname "$(readlink -f "$0")")
source "${script_path}/.env.sh"
PATH=/usr/local/bin:$PATH
cd /app
databot && python3 /app/render.py