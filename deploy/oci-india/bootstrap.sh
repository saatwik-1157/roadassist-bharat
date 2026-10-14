#!/bin/bash
# First-boot setup for the RoadAssist OCI VM, run by cloud-init.yaml (which
# embeds this file as /usr/local/sbin/roadassist-bootstrap.sh). Idempotent:
#   sudo /usr/local/sbin/roadassist-bootstrap.sh
# Log: /var/log/roadassist-bootstrap.log
set -euo pipefail
exec >>/var/log/roadassist-bootstrap.log 2>&1
echo "=== roadassist bootstrap $(date -u +%FT%TZ) ==="

REPO_URL="https://github.com/saatwik-1157/roadassist-bharat.git"
DIR=/opt/roadassist

# shellcheck source=/dev/null
. /etc/os-release

# OCI's Ubuntu images keep their rules in /etc/iptables/rules.v4 (loaded at
# boot by netfilter-persistent) and end INPUT with a blanket REJECT, so a rule
# appended after it never matches. Insert 80/443 BEFORE the REJECT, live and in
# the saved file. The file is edited directly rather than re-saved with
# netfilter-persistent, so Docker's own chains are never frozen into it.
open_ports_iptables() {
  local rules=/etc/iptables/rules.v4 rule pos
  for rule in "-p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT" \
              "-p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT" \
              "-p udp -m state --state NEW -m udp --dport 443 -j ACCEPT"; do
    # shellcheck disable=SC2086  # $rule is deliberately split into words
    if ! iptables -C INPUT $rule 2>/dev/null; then
      pos=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')
      if [ -n "$pos" ]; then
        # shellcheck disable=SC2086
        iptables -I INPUT "$pos" $rule
      else
        # shellcheck disable=SC2086
        iptables -A INPUT $rule
      fi
    fi
    if [ -f "$rules" ] && ! grep -qF -- "-A INPUT $rule" "$rules"; then
      if awk -v line="-A INPUT $rule" '
          !done && /^-A INPUT -j REJECT/ { print line; done = 1 }
          { print }
          END { if (!done) exit 3 }' "$rules" >"$rules.new"; then
        mv "$rules.new" "$rules"
      else
        rm -f "$rules.new"
        echo "no REJECT line in $rules; the live rule is in place, the saved file unchanged"
      fi
    fi
  done
  echo "host firewall: 80/tcp, 443/tcp, 443/udp open (iptables)"
}

open_ports_firewalld() {
  if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --permanent --add-port=443/udp
    firewall-cmd --reload
    echo "host firewall: http, https, 443/udp open (firewalld)"
  else
    echo "firewalld is not running; using iptables"
    open_ports_iptables
  fi
}

install_docker_ubuntu() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker_oracle() {
  # Podman and its runc conflict with docker-ce's containerd.io.
  dnf remove -y podman buildah runc || true
  dnf install -y dnf-plugins-core git
  dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
  dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

# Ports first, Docker second: Docker inserts its own chains at the top of
# FORWARD when it starts, ahead of the image's REJECT.
case "${ID}" in
  ubuntu)
    open_ports_iptables
    command -v docker >/dev/null || install_docker_ubuntu
    ;;
  ol|rhel|centos|rocky|almalinux)
    open_ports_firewalld
    command -v docker >/dev/null || install_docker_oracle
    ;;
  *)
    echo "unsupported image: ${ID}. Use Ubuntu 24.04 or Oracle Linux 9 (aarch64)."
    exit 1
    ;;
esac

systemctl enable --now docker
docker version --format 'docker {{.Server.Version}} on {{.Server.Arch}}'
docker compose version

# The repository: least-privilege-role.sql and backup.sh are mounted from it
# (one copy of each, the reviewed one), and migrate-db.sh runs from it.
if [ -d "$DIR/repo/.git" ]; then
  git -C "$DIR/repo" pull --ff-only || echo "WARNING: git pull failed; keeping the existing clone"
else
  git clone --depth 1 "$REPO_URL" "$DIR/repo"
fi
for f in app/packages/db/sql/least-privilege-role.sql app/scripts/backup.sh deploy/oci-india/migrate-db.sh; do
  [ -f "$DIR/repo/$f" ] || { echo "ERROR: $DIR/repo/$f is missing - is deploy/oci-india pushed to main?"; exit 1; }
done

# Dumps hold personal data: root only.
install -d -m 0700 "$DIR/backups"

# The images, so the first `docker compose up -d` is quick. Not fatal: `up`
# pulls whatever is missing.
docker pull ghcr.io/saatwik-1157/roadassist-bharat:latest \
  || echo "WARNING: app image pull failed - is the arm64 build published yet? (README, before you start)"
docker pull imresamu/postgis:16-3.4 || true
docker pull caddy:2-alpine || true

touch "$DIR/BOOTSTRAP_DONE"
echo "=== done. Next: write $DIR/.env (README step c) ==="
