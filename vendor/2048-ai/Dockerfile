FROM ubuntu:22.04 AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY 2048.cc board.cc *.h makefile ./
RUN mkdir -p /out \
    && g++ -std=c++0x -pthread -O3 -o /out/2048 2048.cc board.cc

FROM ubuntu:22.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Lookup tables (tuple_moves.10a / tuple_moves.11a, several GB) are
# generated on first start and persisted through /data.
WORKDIR /data
COPY --from=build /out/2048 /app/2048
EXPOSE 8080
CMD ["/app/2048", "-S", "8080", "-d3"]
