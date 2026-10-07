---
id: NAMA-POLA
type: integration
title: Nama pola integrasi (mis. REST API via ESB, CDC Oracle GoldenGate)
aliases: []
pattern: sync-api        # sync-api | async-mq | cdc | file | batch | event
---

# Nama pola integrasi

## Kapan dipakai / kapan tidak boleh dipakai

## Sistem yang mendukung

## Alur standar (PlantUML)
```plantuml
@startuml
participant "Consumer" as C
participant "ESB" as E
participant "Provider" as P
C -> E: request
E -> P: request
P --> E: response
E --> C: response
@enduml
```

## Aturan teknis
- Format pesan, header wajib, timeout, retry, idempotency, monitoring.

## Notasi ArchiMate
- Elemen dan relasi yang dipakai untuk pola ini.

## Contoh
