#!/bin/sh
# Optional helper for the Codex cloud proxy. No proxy credentials/certificates enter image layers.
set -eu
cd "$(dirname "$0")/.."
export DOCKER_CONFIG="${DOCKER_CONFIG:-/tmp/hospital-kpi-docker}"
mkdir -p "$DOCKER_CONFIG"
if [ -n "${HTTPS_PROXY:-}" ] && [ -f "${CODEX_PROXY_CERT:-}" ]; then
  proxy_mapping=$(node -e 'const dns=require("node:dns");const h=new URL(process.env.HTTPS_PROXY).hostname;dns.lookup(h,{family:4},(e,r)=>{if(e)process.exit(1);console.log(h+":"+r)})')
  # Exact engine commit for pinned Prisma 6.19.3. Verify official compressed artifacts before reuse.
  engine_commit=c2990dca591cba766e3b7ef5d9e8a84796e47ab7
  engine_cache=/tmp/hospital-kpi-engines/$engine_commit
  mkdir -p "$engine_cache"
  for engine in schema-engine libquery_engine.so.node; do
    engine_url=https://binaries.prisma.sh/all_commits/$engine_commit/debian-openssl-3.0.x/$engine.gz
    curl -fsS --retry 2 --max-time 60 "$engine_url.sha256" -o "$engine_cache/$engine.gz.sha256"
    if [ ! -f "$engine_cache/$engine.gz" ]; then curl -fsS --retry 2 --max-time 60 "$engine_url" -o "$engine_cache/$engine.gz"; fi
    expected_hash=$(awk '{print $1}' "$engine_cache/$engine.gz.sha256")
    printf '%s  %s\n' "$expected_hash" "$engine_cache/$engine.gz" | sha256sum -c -
    gzip -dc "$engine_cache/$engine.gz" > "$engine_cache/$engine"
  done
  chmod 755 "$engine_cache/schema-engine"
  docker build --add-host "$proxy_mapping" --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg http_proxy --build-arg https_proxy --build-arg NO_PROXY --build-arg no_proxy --secret "id=cloud_ca,src=$CODEX_PROXY_CERT" --build-context "prisma_engines=$engine_cache" -t hospital-kpi:local -f docker/Dockerfile .
else
  docker build -t hospital-kpi:local -f docker/Dockerfile .
fi
