FROM node:24.22.2-trixie-slim AS build
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/host apps/host
COPY apps/web apps/web
COPY packages packages
RUN npm install --global pnpm@11.25.0 \
    && pnpm install --frozen-lockfile \
    && pnpm exec turbo run build --filter=@workspace/host --filter=web \
    && pnpm --filter @workspace/host --config.node-linker=hoisted --config.inject-workspace-packages=true deploy --prod /out/host \
    && test -f /out/host/dist/main.js

FROM node:24.22.2-trixie-slim
WORKDIR /opt/beluga
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates fd-find ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && fd --no-require-git --help >/dev/null \
    && install -d -o node -g node -m 0700 /data
COPY --from=build /out/host ./host
COPY --from=build /src/apps/web/dist ./web
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY --from=build /src/packages/client/node_modules/@flue/sdk/LICENSE ./FLUE-SDK-LICENSE.txt
USER node
EXPOSE 3001
ENTRYPOINT ["node", "/opt/beluga/host/dist/main.js"]
CMD ["serve", "--bind", "0.0.0.0", "--data-dir", "/data", "--web-dir", "/opt/beluga/web"]
