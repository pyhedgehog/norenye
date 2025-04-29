#!/bin/bash
#/docker-entrypoint.sh
nginx -g 'daemon off;'&ngxpid=$!
sleep 1
curl "$@"
echo
nginx -s quit
kill $ngxpid
