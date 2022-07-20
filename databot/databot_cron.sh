#!/bin/bash

script_path=$(dirname "$(readlink -f "$0")")
source "${script_path}/.env.sh"
PATH=/usr/local/bin:$PATH
cd /app
pipenv run python3 /app/load.py && pipenv run python3 /app/render.py