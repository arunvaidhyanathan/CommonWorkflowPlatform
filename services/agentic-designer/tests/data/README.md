Real Designer outputs, used to keep the Python contracts in step with the
Designer's adapters:

- `investigation_case.canvas.json`: `parseCmmnXml` (services/web-app/src/adapters/cmmnAdapter.ts)
  applied to `services/web-app/samples/investigation-case.cmmn`.
- `investigation_decisions.dmnmodel.json`: the `DmnModel` for
  `services/web-app/samples/investigation-decisions.dmn`, same fields as `parseDmnXml`.

Regenerate them if the adapters or samples change.
