// Best-effort spec detection for imported files: extension first, then a
// content sniff of the root namespace/tag for ambiguous ".xml" files.
import type { SpecType } from '../store/useWorkbenchStore'

export function detectSpecType(fileName: string, xmlText: string): SpecType {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.dmn')) return 'DMN'
  if (lower.endsWith('.cmmn') || lower.endsWith('.cmmn11') || lower.endsWith('.cmmn.xml')) {
    return 'CMMN'
  }
  if (lower.endsWith('.bpmn') || lower.endsWith('.bpmn20.xml')) return 'BPMN'

  // Ambiguous ".xml" (or unrecognized) extension — sniff the namespace URIs
  // and root element names that each spec's XML schema requires.
  const head = xmlText.slice(0, 2000)
  if (/spec\/DMN|dmn:definitions|<definitions[^>]+xmlns:dmn/i.test(head)) return 'DMN'
  if (/spec\/CMMN|cmmn:definitions|<definitions[^>]+xmlns:cmmn|<case[ >]/i.test(head)) {
    return 'CMMN'
  }
  return 'BPMN'
}
