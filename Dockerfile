#FROM nginx:1.23.4-bullseye
FROM nginx:1.27.5-bookworm
COPY ./tests/nginx/nginx.conf /etc/nginx/nginx.conf
#COPY --chown=nginx:nginx --chmod=0644 ./tests/nginx/norenye.json /etc/nginx/norenye.json
#COPY --chmod=0755 ./tests/nginx/once.sh /usr/local/bin/
COPY ./tests/nginx/norenye.json /etc/nginx/norenye.json
COPY ./tests/nginx/once.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/once.sh \
 && chown nginx:nginx /etc/nginx/norenye.json \
 && chmod 0644 /etc/nginx/norenye.json
COPY ./tests/nginx/html/* /usr/share/nginx/html/
COPY ./tests/nginx/static/* /usr/share/nginx/html/_/static/
COPY ./norenye.ico /usr/share/nginx/html/_/static/favicon.ico
COPY ./js/* /etc/nginx/js/
EXPOSE 8080/tcp
#EXPOSE 8001/tcp
#EXPOSE 8002/tcp
#EXPOSE 8003/tcp
#COPY ./tests/nginx/docker-entrypoint.d/* /docker-entrypoint.d/
