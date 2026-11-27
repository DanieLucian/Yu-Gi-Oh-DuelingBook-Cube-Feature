FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY tools/stage.cjs tools/stage.cjs
COPY shared/cube-format.cjs shared/cube-format.cjs
COPY drafter/ drafter/
RUN node drafter/build.cjs

FROM node:24-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=10000 DATA_ROOT=/var/data
COPY --from=build /src/dist/drafter/ ./
EXPOSE 10000
CMD ["node", "start.cjs", "--public"]
