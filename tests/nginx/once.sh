#!/bin/bash
#/docker-entrypoint.sh
export NORENYE_MODE=once
nginx -c /etc/nginx/${ONCE_NGINX_CONF:-nginx.conf} -g 'daemon off;'&ngxpid=$!
sleep ${ONCE_INIT_SLEEP:-0}
test ${ONCE_HEALTH:-0} == 0||curl -m ${ONCE_HEALTHCHECK_TIMEOUT:-3} http://127.0.0.1:8080/_/health
sleep ${ONCE_HEALTH_SLEEP:-0}
declare -a args
while [[ $# != 0 ]] ; do
  args=()
  while [[ $# != 0 ]] ; do
    if [[ "$1" == "--" ]] ; then
      shift
      break
    fi
    if [[ "$1" == "--+" ]] ; then
      args=("${args[@]}" --)
    else
      args=("${args[@]}" "$1")
    fi
    shift
  done
  curl -s "${args[@]}"|sponge
  echo
  [[ $# != 0 ]] && sleep ${ONCE_STEP_SLEEP:-2}
done
nginx -s quit
kill $ngxpid
