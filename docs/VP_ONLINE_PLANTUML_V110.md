# SOLAR v1.0.10 — Visual Paradigm Online / PlantUML workflow

## Export from SOLAR

- `*.sequence.puml` — native PlantUML source for sequence diagrams (existing in previous versions).
- `*.archimate.puml` — one standalone, portable PlantUML source per ArchiMate view (new).
- `*.archimate.drawio` and `*.archimate.vp-online.xml` — editable mxGraph drawing with a definition appendix below the diagram. The appendix includes each element's name, type, documentation, properties, and relationship definitions.
- `*.archimate.xml` — Open Group Exchange XML for applications that need *semantic* ArchiMate model import rather than a graphical drawing.
- `*.svg` — visual preview.

## How to view .puml with Visual Paradigm

1. Download a `.puml` file from the SOLAR conversation's artifacts.
2. Open [Visual Paradigm PlantUML Editor / VPasCode](https://www.visual-paradigm.com/features/plantuml-editor/) and paste/open the text of the `.puml` file.
3. Review the live preview and adjust PlantUML source as needed. Export PNG, SVG, or PDF in the editor.
4. For an editable graphical drawing, use the separate `.drawio` or VP Online XML import option in the appropriate graphical diagram editor.

**Important:** PlantUML is a diagram-as-code representation. The exported ArchiMate PlantUML uses portable rectangle/node notation with explicit element-type labels. It does **not** carry the full ArchiMate semantic repository, nor does every VP editor automatically convert rendered PlantUML into native, draggable UML or ArchiMate elements. The Exchange XML remains the canonical semantic model.

## v1.0.10 behavior and QA

- Artifact preview is mounted above fullscreen Conversation rather than behind it.
- The draw.io diagrams retain routing from v1.0.9 while appending editable definition cards below the graph.
- The PlantUML sources should contain every included view element, relationship, and available documentation/properties.
- Check particularly BusinessRole, ApplicationInterface, ApplicationComponent, and long documentation.
- Regression unit tests are in `apps/server/test/drawio.test.ts`.
- Run `npm ci && npm run check`, then manually inspect actual imports in the organization's VP Online account. The importer may rearrange shapes and text independently of SOLAR.
