# Knowledge base SOLAR

Knowledge base berisi **aturan dan fakta milik Anda** dalam bentuk file Markdown: sistem, integrasi, standar
ArchiMate, aturan sequence diagram (PlantUML), aturan spesifikasi API, prinsip arsitektur, dan lainnya.
Agent membaca file yang relevan **sebelum** membuat opsi solusi, ArchiMate, sequence diagram, API spec, dan TSD,
dan isinya **mengalahkan** aturan umum bawaan maupun skill.

Kelola dari aplikasi: **Pengaturan → Knowledge** (buat, edit, impor banyak file sekaligus, hapus).
File Anda disimpan di `data/knowledge/` (atau folder `KNOWLEDGE_DIR` di `.env`), sehingga folder itu juga bisa
dijadikan repository Git sendiri.

## Struktur yang disarankan

```
LANDSCAPE.md                 katalog semua sistem (1 baris per sistem)
PRINCIPLES.md                prinsip arsitektur, teknologi yang boleh / dilarang / sunset
NAMING.md                    konvensi penamaan elemen, participant, endpoint, file
GLOSSARY.md                  istilah dan akronim
systems/<SISTEM>.md          satu file per sistem, mis. systems/AD1GATE.md, systems/ESB.md
integrations/<POLA>.md       satu file per pola integrasi, mis. integrations/API.md, integrations/OGG.md
standards/ARCHIMATE.md       aturan ArchiMate (viewpoint wajib, elemen per layer, layout)
standards/SEQUENCE-PLANTUML.md aturan sequence diagram
standards/api-specification.md aturan spesifikasi API
nfr/SECURITY.md              keamanan, zona jaringan, data sensitif
process/SOLUTION-OPTIONS.md  kolom & kriteria penilaian opsi solusi
process/BRD-ANALYSIS.md      penomoran requirement (BR/FR/NFR) dan traceability
documents/HLD.md, documents/TSD.md  struktur dokumen
decisions/ADR-0001-*.md      keputusan arsitektur terdahulu
```

Jenis file ditentukan dari front matter `type`, atau dari nama folder (`systems/` → system, `integrations/` →
integration, `standards/` → standard, dst.).

## Front matter

```yaml
---
id: AD1GATE              # nama yang dipakai di diagram dan dokumen
type: system             # system | integration | standard | principle | nfr | process | document | decision | glossary | landscape | reference
title: AD1GATE API Gateway
aliases: [AD1 Gateway, ADI Gate]   # nama lain yang mungkin muncul di BRD
tags: [gateway, channel]
---
```

`id` dan `aliases` dipakai untuk mencocokkan nama sistem di permintaan atau dokumen BRD, sehingga file yang tepat
otomatis disodorkan ke agent.

Contoh kerangka ada di folder `_templates/`. File dan folder yang diawali `_` serta `README.md` adalah panduan untuk
Anda dan **tidak** dibaca agent.
