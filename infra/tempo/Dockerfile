FROM grafana/tempo:2.6.1
COPY tempo.yaml /etc/tempo.yaml
ENTRYPOINT ["/tempo", "-config.file=/etc/tempo.yaml"]
