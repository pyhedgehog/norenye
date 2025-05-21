#!/bin/bash
function getport()
{
  (nginx -T -q 2>/dev/null|sed -nre 's/^\s*\<listen\s+([0-9]+)\>.*$/\1/p;T;q'
  echo 80)|head -1
}
function do_start()
{
  nginx -t -q
  nginx -g 'daemon on;' </dev/null &>/proc/$$/fd/1 &
  inotifywait -e close_write --include '^/run/nginx\.pid$' -qq -t 1 /run
  stat --printf '' /run/nginx.pid&&kill -0 "$(</run/nginx.pid)"
}
function do_status()
{
  confok=Error
  pidok=Error
  procok=Error
  tcpok=Error
  port=$(getport)
  nginx -t -q&&confok=OK
  test -s /run/nginx.pid&&pidok=OK
  test -s /run/nginx.pid&&kill -0 "$(</run/nginx.pid)"&&procok=OK
  curl -sm1 -o /dev/null http://127.0.0.1:$port/&&tcpok=OK
  echo -e "Config check: $confok\nPid file exists: $pidok\nNginx process running: $procok\nNginx responding: $tcpok (port=$port)"
}
function do_info()
{
  confok=0
  pidok=0
  procok=0
  tcpok=0
  port=$(getport)
  nginx -t -q &>/dev/null&&confok=1
  test -s /run/nginx.pid&&pidok=1
  test -s /run/nginx.pid&&kill -0 "$(</run/nginx.pid)" -q &>/dev/null&&procok=1
  curl -sm1 -o /dev/null http://127.0.0.1:$port/&&tcpok=1
  echo -e "confok=$confok\npidok=$pidok\nprocok=$procok\ntcpok=$tcpok"
}

function exec()
{ true;}
. /docker-entrypoint.sh nginx -t -q
unset -f exec

if [ "$TESTAPI_START" ] && [ "$TESTAPI_START" != 0 ] ; then
  echo "testapid: Starting nginx on load..."
  do_start
fi

#socat tcp-l:80,fork,forever,crnl exec:testapi200.sh </dev/null &>/dev/null & disown

echo 'testapid: Listening for commands in for "echo CMD > /tmp/testapi.cmd"'
while true ; do
  [ -e /tmp/testapi.cmd ] && rm -f /tmp/testapi.cmd
  inotifywait -e close_write,moved_to --include '^/tmp/testapi\.cmd$' -qq /tmp
  rm -f /tmp/testapi.out
  cmd="$(</tmp/testapi.cmd)"
  rm -f /tmp/testapi.cmd
  echo "testapid: Got command '$cmd'"
  case "$cmd" in
    ""|ping)	echo "pong"|tee /tmp/testapi.out;;
    test)	nginx -t 2>&1|tee /tmp/testapi.out;;
    info)	do_info 2>&1|tee /tmp/testapi.out;;
    status)	do_status 2>&1|tee /tmp/testapi.out;;
    start)	do_start 2>&1|tee /tmp/testapi.out;;
    port)	getport 2>&1|tee /tmp/testapi.out;;
    stop)	nginx -s stop 2>&1|tee /tmp/testapi.out;;
    reload)	(nginx -t -q ; nginx -s reload) 2>&1|tee /tmp/testapi.out;;
    *)		echo "Unknown command $cmd"|tee /tmp/testapi.out;;
  esac
done
