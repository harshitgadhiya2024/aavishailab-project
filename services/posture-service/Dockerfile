# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -o /out/posture ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/posture /posture
EXPOSE 6230
USER nonroot:nonroot
ENTRYPOINT ["/posture"]
