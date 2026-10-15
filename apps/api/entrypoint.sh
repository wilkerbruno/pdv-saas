#!/bin/sh
set -e
if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "Aplicando migrations..."
  npx prisma migrate deploy
else
  echo "ATENÇÃO: sem migrations versionadas; sincronizando com 'prisma db push'."
  echo "Gere a migration inicial com 'npx prisma migrate dev --name init' e faça commit."
  npx prisma db push --skip-generate
fi
npx ts-node --transpile-only prisma/seed.ts || true
exec node dist/main.js
