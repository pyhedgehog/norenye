#!/bin/bash
test -e /tmp/testapi.cmd && inotifywait -e delete --include '^/tmp/testapi\.cmd$' -t 1 -qq /tmp
echo "$1" > /tmp/testapi.cmd
test -e /tmp/testapi.out && inotifywait -e delete --include '^/tmp/testapi\.out$' -t 1 -qq /tmp
inotifywait -e close_write --include '^/tmp/testapi\.out' -t 1 -qq /tmp
cat /tmp/testapi.out
