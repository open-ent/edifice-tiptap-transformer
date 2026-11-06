FROM node:26-alpine AS builder

ENV HUSKY=0

# Install pnpm
RUN npm install -g pnpm@8.6.6

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json .npmrc ./

# Open ENT : @open-ent/tiptap-extensions vient de GitHub Packages, qui exige un jeton même
# en lecture. Passé en secret de construction, il ne reste dans aucune couche de l'image.
# Dépendances de dev incluses : le build appelle tsc, `pnpm prune --production` les retire.
RUN --mount=type=secret,id=node_auth_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" pnpm i --no-frozen-lockfile

COPY . .

RUN pnpm run build
RUN pnpm prune --production

FROM gcr.io/distroless/nodejs26-debian13 AS production


ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY package.json .

COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules

EXPOSE 3000

# Open ENT : distroless n'a pas d'utilisateur « node » (celui de node:alpine en 1.0.2).
USER nonroot
CMD [ "/usr/src/app/dist/index.js" ]