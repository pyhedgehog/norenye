#!/bin/sh
#printf 'HTTP/1.0 200 OK\nServer\072 socat\n\n'
#exec testapictl.sh "$(timeout 0.1 dos2unix|tail -1)"
#!/bin/sh
read -r method url rest 
read -r input
while [ -n "$input" ] ; do
  read -r input
done
read -r cmd
if [ "$method" = "POST" ] && [ "$url" = "${TESTAPI_URI:-/testapictl}" ] && [ -n "$cmd" ] ; then
  printf 'HTTP/1.0 200 OK\nServer\072 socat\n\n\044 testapictl.sh %s\n' "$cmd"
  exec testapictl.sh "$cmd"
fi
printf 'HTTP/1.0 404 Not found\nServer\072 socat\n\n%s %s[%s]\n' "$method" "$url" "$cmd"
