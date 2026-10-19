# A stand-in for the droplet: Ubuntu 20.04, systemd, Apache 2.4 (event MPM), Node 22.
FROM ubuntu:20.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv apache2 curl git iproute2 ca-certificates xz-utils procps \
 && a2enmod proxy proxy_http headers >/dev/null && apt-get clean
RUN arch=$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x64/') \
 && curl -fsSL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-$arch.tar.xz | tar -xJ -C /usr/local --strip-components=1
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
