# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -o /out/threatintel ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/threatintel /threatintel
EXPOSE 6220
USER nonroot:nonroot
ENTRYPOINT ["/threatintel"]
